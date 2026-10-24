const express = require('express');
const { z } = require('zod');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Department = require('../models/Department');
const Designation = require('../models/Designation');
const { authenticate, authorize, requirePasswordChanged } = require('../middleware/auth');
const { generateTempPassword } = require('../utils/helpers');
const AuditLog = require('../models/AuditLog');

const router = express.Router();

router.use(authenticate, requirePasswordChanged);

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not']).optional(),
  joiningDate: z.string(),
  department: z.string(),
  designation: z.string(),
  basicSalary: z.number().positive(),
  employeeCode: z.string().optional(),
});

router.get('/', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const filter = {};

    if (req.query.q) {
      filter.$or = [
        { firstName: new RegExp(req.query.q, 'i') },
        { lastName: new RegExp(req.query.q, 'i') },
        { email: new RegExp(req.query.q, 'i') },
        { employeeCode: new RegExp(req.query.q, 'i') },
      ];
    }
    if (req.query.department) filter.department = req.query.department;
    if (req.query.status) filter.employmentStatus = req.query.status;

    const [items, total] = await Promise.all([
      Employee.find(filter)
        .populate('department', 'name code')
        .populate('designation', 'title')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Employee.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);

    const dept = await Department.findById(body.department);
    const desig = await Designation.findById(body.designation);
    if (!dept || !desig) {
      return res.status(400).json({ success: false, message: 'Invalid department or designation' });
    }

    let code = body.employeeCode;
    if (!code) {
      const count = await Employee.countDocuments();
      code = `EMP${String(count + 1).padStart(5, '0')}`;
    }

    const tempPassword = generateTempPassword();

    const employee = await Employee.create({
      employeeCode: code.toUpperCase(),
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email.toLowerCase(),
      phone: body.phone,
      address: body.address,
      gender: body.gender,
      joiningDate: new Date(body.joiningDate),
      department: body.department,
      designation: body.designation,
      salaryStructure: { basic: body.basicSalary },
    });

    const user = await User.create({
      email: body.email.toLowerCase(),
      password: tempPassword,
      role: 'employee',
      employee: employee._id,
      mustChangePassword: true,
    });

    employee.user = user._id;
    await employee.save();

    await AuditLog.create({
      actor: req.user.id,
      action: 'CREATE_EMPLOYEE',
      entity: 'Employee',
      entityId: employee._id,
      after: { code, email: employee.email },
    });

    res.status(201).json({
      success: true,
      data: {
        employee,
        temporaryPassword: tempPassword, // only returned once at creation
      },
      message: 'Employee created. Share the temporary password securely.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const emp = await Employee.findById(req.params.id)
      .populate('department')
      .populate('designation')
      .populate('user', 'email role isActive lastLoginAt');
    if (!emp) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: emp });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const allowed = ['firstName', 'lastName', 'phone', 'address', 'gender', 'department', 'designation', 'employmentStatus'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (req.body.basicSalary) {
      updates.salaryStructure = { basic: req.body.basicSalary };
    }

    const before = await Employee.findById(req.params.id);
    const emp = await Employee.findByIdAndUpdate(req.params.id, updates, { new: true })
      .populate('department')
      .populate('designation');

    await AuditLog.create({
      actor: req.user.id,
      action: 'UPDATE_EMPLOYEE',
      entity: 'Employee',
      entityId: emp._id,
      before: before?.toObject(),
      after: emp.toObject(),
    });

    res.json({ success: true, data: emp });
  } catch (err) {
    next(err);
  }
});

// Self profile update (employee)
router.patch('/me/profile', authorize('employee'), async (req, res, next) => {
  try {
    if (!req.user.employee) {
      return res.status(400).json({ success: false, message: 'No employee profile' });
    }
    const updates = {};
    if (req.body.phone !== undefined) updates.phone = req.body.phone;
    if (req.body.address !== undefined) updates.address = req.body.address;

    const emp = await Employee.findByIdAndUpdate(req.user.employee, updates, { new: true });
    res.json({ success: true, data: emp });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

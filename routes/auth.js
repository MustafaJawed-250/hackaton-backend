const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
const Employee = require('../models/Employee');
const Department = require('../models/Department');
const Designation = require('../models/Designation');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd || process.env.COOKIE_SECURE === 'true',
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Database unavailable. Please try again shortly.',
      });
    }
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    setAuthCookie(res, token);

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          employee: user.employee,
          mustChangePassword: user.mustChangePassword,
        },
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out' });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    });
    const { currentPassword, newPassword } = schema.parse(req.body);
    const user = await User.findById(req.user.id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }
    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * HR self-registration — requires valid orgCode from an initialized company.
 * Cannot create admin. Role is always 'hr'.
 */
router.post('/register-hr', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Database unavailable' });
    }

    const schema = z.object({
      fullName: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
      orgCode: z.string().min(4).max(16),
    });
    const body = schema.parse(req.body);

    const company = await Company.findOne({
      orgCode: body.orgCode.toUpperCase(),
      isSetupComplete: true,
    });
    if (!company) {
      return res.status(400).json({
        success: false,
        message: 'Invalid organization code. Ask your admin for the correct code.',
      });
    }

    const existing = await User.findOne({ email: body.email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const user = await User.create({
      email: body.email.toLowerCase(),
      name: body.fullName.trim(),
      password: body.password,
      role: 'hr',
      mustChangePassword: false,
    });

    res.status(201).json({
      success: true,
      message: 'HR account created. You can now sign in.',
      data: { email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Employee self-registration — requires valid orgCode.
 * Creates a minimal Employee record + User with role employee.
 * Department/designation/salary should be completed later by HR.
 */
router.post('/register-employee', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Database unavailable' });
    }

    const schema = z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
      orgCode: z.string().min(4).max(16),
      inviteCode: z.string().optional(),
    });
    const body = schema.parse(req.body);

    const company = await Company.findOne({
      orgCode: body.orgCode.toUpperCase(),
      isSetupComplete: true,
    });
    if (!company) {
      return res.status(400).json({
        success: false,
        message: 'Invalid organization code. Ask your HR or admin for the correct code.',
      });
    }

    const existingUser = await User.findOne({ email: body.email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Default department / designation for self-registered employees
    let dept = await Department.findOne({ code: 'ENG' });
    if (!dept) dept = await Department.findOne();
    let desig = await Designation.findOne({ title: 'Employee' });
    if (!desig) desig = await Designation.findOne();

    if (!dept || !desig) {
      return res.status(400).json({
        success: false,
        message: 'Company is not fully configured. Contact your administrator.',
      });
    }

    const count = await Employee.countDocuments();
    const code = `EMP${String(count + 1).padStart(5, '0')}`;

    const employee = await Employee.create({
      employeeCode: code,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email.toLowerCase(),
      joiningDate: new Date(),
      department: dept._id,
      designation: desig._id,
      salaryStructure: { basic: 30000 }, // placeholder; HR should update
      employmentStatus: 'active',
    });

    const user = await User.create({
      email: body.email.toLowerCase(),
      name: `${body.firstName.trim()} ${body.lastName.trim()}`,
      password: body.password,
      role: 'employee',
      employee: employee._id,
      mustChangePassword: false,
    });

    employee.user = user._id;
    await employee.save();

    res.status(201).json({
      success: true,
      message: 'Employee account created. You can now sign in.',
      data: { email: user.email, role: user.role, employeeCode: code },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
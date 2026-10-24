const express = require('express');
const { z } = require('zod');
const mongoose = require('mongoose');
const { timingSafeEqual } = require('crypto');
const Company = require('../models/Company');
const User = require('../models/User');
const LeaveType = require('../models/LeaveType');
const Department = require('../models/Department');
const Designation = require('../models/Designation');

const router = express.Router();

router.get('/status', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected',
        data: { isSetupComplete: false, companyName: null },
      });
    }
    const company = await Company.findOne();
    res.json({
      success: true,
      data: {
        isSetupComplete: !!company?.isSetupComplete,
        companyName: company?.name || null,
        orgCode: company?.isSetupComplete ? company.orgCode : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/initialize', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Database is not connected. Check MONGODB_URI and Atlas network access.',
      });
    }

    const existing = await Company.findOne({ isSetupComplete: true });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Company already initialized. Use Admin sign-in instead.',
      });
    }

    const schema = z.object({
      companyName: z.string().min(2, 'Company name must be at least 2 characters'),
      adminEmail: z.string().email('Valid admin email required'),
      adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
      adminName: z.string().min(2).optional(),
      orgCode: z
        .string()
        .min(4, 'Organization code must be at least 4 characters')
        .max(16)
        .regex(/^[A-Za-z0-9_-]+$/, 'Org code: letters, numbers, _ or - only')
        .optional(),
    });

    const body = schema.parse(req.body);
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      return res.status(503).json({
        success: false,
        message: 'First-time setup is unavailable until ADMIN_EMAIL and ADMIN_PASSWORD are configured on the backend.',
      });
    }
    const submittedPassword = Buffer.from(body.adminPassword);
    const expectedPassword = Buffer.from(password);
    const passwordMatches = submittedPassword.length === expectedPassword.length
      && timingSafeEqual(submittedPassword, expectedPassword);
    if (body.adminEmail.trim().toLowerCase() !== email || !passwordMatches) {
      return res.status(403).json({
        success: false,
        message: 'Use the configured backend bootstrap administrator credentials.',
      });
    }

    let orgCode = (body.orgCode || (body.companyName.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) + String(new Date().getFullYear()))).toUpperCase();
    if (orgCode.length < 4) orgCode = 'ORG' + Date.now().toString().slice(-6);

    let admin = await User.findOne({ email }).select('+password');
    if (admin && (admin.role !== 'admin' || !(await admin.comparePassword(password)))) {
      return res.status(409).json({
        success: false,
        message: 'The configured bootstrap email is already assigned to a different account.',
      });
    }
    if (!admin) {
      admin = await User.create({
        email,
        name: body.adminName?.trim(),
        password,
        role: 'admin',
        mustChangePassword: false,
      });
    }

    const company = await Company.findOneAndUpdate(
      { isSetupComplete: { $ne: true } },
      {
        name: body.companyName,
        orgCode,
        isSetupComplete: false,
        officeStartTime: '09:00',
        gracePeriodMinutes: 15,
        halfDayThresholdHours: 5,
        weekendDays: [0, 6],
        geofenceRadiusMeters: 150,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const defaults = [
      { name: 'Annual', code: 'ANNUAL', annualQuota: 14, isPaid: true },
      { name: 'Sick', code: 'SICK', annualQuota: 8, isPaid: true },
      { name: 'Casual', code: 'CASUAL', annualQuota: 10, isPaid: true },
      { name: 'Unpaid', code: 'UNPAID', annualQuota: 0, isPaid: false },
    ];
    for (const d of defaults) {
      await LeaveType.findOneAndUpdate({ code: d.code }, d, { upsert: true });
    }

    await Department.findOneAndUpdate({ code: 'ENG' }, { name: 'Engineering', code: 'ENG' }, { upsert: true });
    await Department.findOneAndUpdate({ code: 'HR' }, { name: 'Human Resources', code: 'HR' }, { upsert: true });
    await Designation.findOneAndUpdate({ title: 'Software Engineer' }, { title: 'Software Engineer', level: 2 }, { upsert: true });
    await Designation.findOneAndUpdate({ title: 'HR Manager' }, { title: 'HR Manager', level: 3 }, { upsert: true });
    await Designation.findOneAndUpdate({ title: 'Employee' }, { title: 'Employee', level: 1 }, { upsert: true });

    company.isSetupComplete = true;
    await company.save();

    res.status(201).json({
      success: true,
      message: 'Company initialized successfully',
      data: {
        companyId: company._id,
        companyName: company.name,
        orgCode: company.orgCode,
        adminEmail: admin.email,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Organization code or email already in use. Try a different org code.',
      });
    }
    next(err);
  }
});

module.exports = router;
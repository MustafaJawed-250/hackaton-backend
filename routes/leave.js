const express = require('express');
const { z } = require('zod');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveType = require('../models/LeaveType');
const Notification = require('../models/Notification');
const { authenticate, authorize, requirePasswordChanged } = require('../middleware/auth');
const leaveService = require('../services/leaveService');

const router = express.Router();
router.use(authenticate, requirePasswordChanged);

router.get('/types', async (req, res, next) => {
  try {
    const types = await LeaveType.find({ isActive: true });
    res.json({ success: true, data: types });
  } catch (err) {
    next(err);
  }
});

router.get('/balance', authorize('employee'), async (req, res, next) => {
  try {
    const types = await LeaveType.find({ isActive: true });
    const balances = [];
    for (const t of types) {
      const b = await leaveService.getBalance(req.user.employee, t._id);
      balances.push({ leaveType: t, ...b });
    }
    res.json({ success: true, data: balances });
  } catch (err) {
    next(err);
  }
});

router.post('/apply', authorize('employee'), async (req, res, next) => {
  try {
    const schema = z.object({
      leaveTypeId: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      reason: z.string().min(3),
    });
    const body = schema.parse(req.body);
    const leave = await leaveService.applyLeave(req.user.employee, body);
    res.status(201).json({ success: true, data: leave });
  } catch (err) {
    next(err);
  }
});

router.get('/my', authorize('employee'), async (req, res, next) => {
  try {
    const leaves = await LeaveRequest.find({ employee: req.user.employee })
      .populate('leaveType')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', authorize('employee'), async (req, res, next) => {
  try {
    const leave = await LeaveRequest.findOne({
      _id: req.params.id,
      employee: req.user.employee,
      status: 'pending',
    });
    if (!leave) return res.status(404).json({ success: false, message: 'Not found or not cancellable' });
    leave.status = 'cancelled';
    await leave.save();
    res.json({ success: true, data: leave });
  } catch (err) {
    next(err);
  }
});

router.get('/pending', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const leaves = await LeaveRequest.find({ status: 'pending' })
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType')
      .sort({ createdAt: 1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/decide', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['approved', 'rejected']),
      comment: z.string().optional(),
    });
    const { status, comment } = schema.parse(req.body);
    const leave = await leaveService.decideLeave(req.params.id, req.user.id, status, comment);

    // Notify employee
    const emp = await require('../models/Employee').findById(leave.employee);
    if (emp?.user) {
      await Notification.create({
        user: emp.user,
        title: `Leave ${status}`,
        message: `Your leave request from ${leave.startDate.toDateString()} has been ${status}.${comment ? ' Comment: ' + comment : ''}`,
        type: 'leave',
      });
    }

    res.json({ success: true, data: leave });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

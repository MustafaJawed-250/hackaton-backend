const express = require('express');
const Attendance = require('../models/Attendance');
const { authenticate, authorize, requirePasswordChanged } = require('../middleware/auth');
const attendanceService = require('../services/attendanceService');
const { startOfDay } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requirePasswordChanged);

router.post('/check-in', authorize('employee'), async (req, res, next) => {
  try {
    if (!req.user.employee) {
      return res.status(400).json({ success: false, message: 'No employee profile' });
    }
    const record = await attendanceService.checkIn(req.user.employee, {
      lat: req.body.lat,
      lng: req.body.lng,
      accuracy: req.body.accuracy,
      source: req.body.source || 'web',
    });
    res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
});

router.post('/check-out', authorize('employee'), async (req, res, next) => {
  try {
    if (!req.user.employee) {
      return res.status(400).json({ success: false, message: 'No employee profile' });
    }
    const record = await attendanceService.checkOut(req.user.employee);
    res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
});

router.get('/today', authorize('employee'), async (req, res, next) => {
  try {
    const record = await attendanceService.getTodayStatus(req.user.employee);
    res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
});

router.get('/my', authorize('employee'), async (req, res, next) => {
  try {
    const from = req.query.from ? startOfDay(req.query.from) : startOfDay(new Date(Date.now() - 30 * 86400000));
    const to = req.query.to ? startOfDay(req.query.to) : startOfDay(new Date());
    const records = await Attendance.find({
      employee: req.user.employee,
      date: { $gte: from, $lte: to },
    }).sort({ date: -1 });
    res.json({ success: true, data: records });
  } catch (err) {
    next(err);
  }
});

router.get('/board', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const date = req.query.date ? startOfDay(req.query.date) : startOfDay(new Date());
    const records = await Attendance.find({ date })
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeCode department',
        populate: { path: 'department', select: 'name' },
      })
      .sort({ checkIn: 1 });
    res.json({ success: true, data: records });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Payroll = require('../models/Payroll');
const { authenticate, authorize, requirePasswordChanged } = require('../middleware/auth');
const { startOfDay } = require('../utils/helpers');

const router = express.Router();
router.use(authenticate, requirePasswordChanged);

router.get('/dashboard', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const activeHeadcount = await Employee.countDocuments({ employmentStatus: 'active' });
    const today = startOfDay(new Date());

    const todayAtt = await Attendance.aggregate([
      { $match: { date: today } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const statusMap = Object.fromEntries(todayAtt.map((s) => [s._id, s.count]));

    const onLeave = await LeaveRequest.countDocuments({
      status: 'approved',
      startDate: { $lte: today },
      endDate: { $gte: today },
    });

    const latestPayroll = await Payroll.findOne().sort({ year: -1, month: -1 });

    // Headcount by department
    const byDept = await Employee.aggregate([
      { $match: { employmentStatus: 'active' } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'departments',
          localField: '_id',
          foreignField: '_id',
          as: 'dept',
        },
      },
      { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
      { $project: { name: '$dept.name', count: 1 } },
    ]);

    // Average salary
    const avgSalary = await Employee.aggregate([
      { $match: { employmentStatus: 'active' } },
      { $group: { _id: null, avg: { $avg: '$salaryStructure.basic' } } },
    ]);

    res.json({
      success: true,
      data: {
        activeHeadcount,
        presentToday: (statusMap.present || 0) + (statusMap.late || 0) + (statusMap.missing_checkout || 0),
        lateToday: statusMap.late || 0,
        halfDayToday: statusMap.half_day || 0,
        onLeaveToday: onLeave,
        monthlyPayrollCost: latestPayroll?.totalNet || 0,
        averageBasicSalary: Math.round(avgSalary[0]?.avg || 0),
        headcountByDepartment: byDept,
        latestPayrollStatus: latestPayroll?.status || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/employee-dashboard', authorize('employee'), async (req, res, next) => {
  try {
    if (!req.user.employee) {
      return res.json({ success: true, data: {} });
    }
    const today = startOfDay(new Date());
    const weekStart = new Date(today);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() + 1);

    const todayAtt = await Attendance.findOne({ employee: req.user.employee, date: today });
    const weekAtt = await Attendance.find({
      employee: req.user.employee,
      date: { $gte: weekStart, $lte: today },
    });
    const weeklyHours = weekAtt.reduce((s, a) => s + (a.workingHours || 0), 0);

    const lateCount = await Attendance.countDocuments({
      employee: req.user.employee,
      isLate: true,
      date: { $gte: new Date(new Date().getFullYear(), 0, 1) },
    });

    res.json({
      success: true,
      data: {
        today: todayAtt,
        weeklyHours: Math.round(weeklyHours * 100) / 100,
        weeklyTarget: 40,
        lateCountYTD: lateCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

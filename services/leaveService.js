const LeaveRequest = require('../models/LeaveRequest');
const LeaveType = require('../models/LeaveType');
const Holiday = require('../models/Holiday');
const Company = require('../models/Company');
const { startOfDay, countWorkingDays } = require('../utils/helpers');

async function getWorkingDays(startDate, endDate) {
  const company = await Company.findOne();
  const holidays = await Holiday.find({
    date: { $gte: startOfDay(startDate), $lte: startOfDay(endDate) },
  });
  const holidayDates = holidays.map((h) => h.date);
  return countWorkingDays(
    startDate,
    endDate,
    company?.weekendDays || [0, 6],
    holidayDates
  );
}

async function getBalance(employeeId, leaveTypeId) {
  const leaveType = await LeaveType.findById(leaveTypeId);
  if (!leaveType) throw Object.assign(new Error('Leave type not found'), { statusCode: 404 });

  if (!leaveType.isPaid || leaveType.annualQuota === 0) {
    return { quota: null, used: 0, remaining: null }; // unlimited
  }

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const approved = await LeaveRequest.aggregate([
    {
      $match: {
        employee: employeeId,
        leaveType: leaveType._id,
        status: 'approved',
        startDate: { $gte: yearStart },
      },
    },
    { $group: { _id: null, total: { $sum: '$days' } } },
  ]);

  const used = approved[0]?.total || 0;
  return {
    quota: leaveType.annualQuota,
    used,
    remaining: Math.max(0, leaveType.annualQuota - used),
  };
}

async function applyLeave(employeeId, data) {
  const { leaveTypeId, startDate, endDate, reason } = data;
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  if (end < start) {
    const err = new Error('End date must be on or after start date');
    err.statusCode = 400;
    throw err;
  }

  const days = await getWorkingDays(start, end);
  if (days <= 0) {
    const err = new Error('No working days in the selected range');
    err.statusCode = 400;
    throw err;
  }

  // Overlap check
  const overlap = await LeaveRequest.findOne({
    employee: employeeId,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: end },
    endDate: { $gte: start },
  });
  if (overlap) {
    const err = new Error('Overlapping leave request exists');
    err.statusCode = 422;
    throw err;
  }

  const balance = await getBalance(employeeId, leaveTypeId);
  if (balance.remaining !== null && days > balance.remaining) {
    const err = new Error(`Insufficient balance. Remaining: ${balance.remaining} day(s)`);
    err.statusCode = 422;
    throw err;
  }

  const leave = await LeaveRequest.create({
    employee: employeeId,
    leaveType: leaveTypeId,
    startDate: start,
    endDate: end,
    days,
    reason,
    status: 'pending',
  });

  return leave.populate(['leaveType', 'employee']);
}

async function decideLeave(leaveId, reviewerId, status, comment) {
  const leave = await LeaveRequest.findById(leaveId);
  if (!leave) throw Object.assign(new Error('Leave not found'), { statusCode: 404 });
  if (leave.status !== 'pending') {
    const err = new Error('Leave is not pending');
    err.statusCode = 400;
    throw err;
  }

  leave.status = status;
  leave.reviewedBy = reviewerId;
  leave.reviewComment = comment || '';
  leave.reviewedAt = new Date();
  await leave.save();
  return leave;
}

module.exports = {
  getWorkingDays,
  getBalance,
  applyLeave,
  decideLeave,
};

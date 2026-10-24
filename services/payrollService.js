const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const Company = require('../models/Company');
const { startOfDay, countWorkingDays, calculateAnnualTax } = require('../utils/helpers');

async function calculateMonthWorkingDays(year, month) {
  const company = await Company.findOne();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
  return countWorkingDays(start, end, company?.weekendDays || [0, 6], holidays.map((h) => h.date));
}

async function preparePayroll(year, month, userId) {
  const existing = await Payroll.findOne({ year, month });
  if (existing && existing.status === 'finalized') {
    const err = new Error('Payroll already finalized for this month');
    err.statusCode = 400;
    throw err;
  }

  const workingDaysInMonth = await calculateMonthWorkingDays(year, month);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const employees = await Employee.find({ employmentStatus: 'active' }).populate('department');

  const items = [];
  let totalGross = 0;
  let totalNet = 0;
  let totalTax = 0;

  for (const emp of employees) {
    const basic = emp.salaryStructure.basic;
    const hra = basic * 0.4;
    const medical = basic * 0.1;
    const gross = basic * 1.5;
    const dailySalary = gross / workingDaysInMonth;

    // Attendance aggregation
    const attRecords = await Attendance.find({
      employee: emp._id,
      date: { $gte: monthStart, $lte: monthEnd },
    });

    let absentDays = 0;
    let halfDays = 0;
    let presentDays = 0;

    const attendanceDates = new Set();
    for (const a of attRecords) {
      attendanceDates.add(startOfDay(a.date).toISOString());
      if (a.status === 'half_day') halfDays += 1;
      else if (['present', 'late', 'missing_checkout'].includes(a.status)) presentDays += 1;
      else if (a.status === 'absent') absentDays += 1;
    }

    // Unpaid leave days
    const unpaidLeaves = await LeaveRequest.find({
      employee: emp._id,
      status: 'approved',
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
    }).populate('leaveType');

    let unpaidLeaveDays = 0;
    for (const lv of unpaidLeaves) {
      if (lv.leaveType && !lv.leaveType.isPaid) {
        unpaidLeaveDays += lv.days; // simplified; production would prorate
      }
    }

    // Days without attendance and without approved paid leave = absent
    // (simplified for hackathon)

    const deductions =
      absentDays * dailySalary +
      halfDays * 0.5 * dailySalary +
      unpaidLeaveDays * dailySalary;

    // Monthly tax = annual tax / 12 (demo rule)
    const annualGross = gross * 12;
    const annualTax = calculateAnnualTax(annualGross);
    const monthlyTax = annualTax / 12;

    const net = Math.max(0, gross - deductions - monthlyTax);

    items.push({
      employee: emp._id,
      basic,
      hra,
      medical,
      gross,
      absentDays,
      halfDays,
      unpaidLeaveDays,
      deductions: Math.round(deductions * 100) / 100,
      tax: Math.round(monthlyTax * 100) / 100,
      net: Math.round(net * 100) / 100,
      workingDaysInMonth,
      presentDays,
    });

    totalGross += gross;
    totalNet += net;
    totalTax += monthlyTax;
  }

  const payroll = await Payroll.findOneAndUpdate(
    { year, month },
    {
      year,
      month,
      status: 'draft',
      items,
      totalGross: Math.round(totalGross * 100) / 100,
      totalNet: Math.round(totalNet * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      preparedBy: userId,
    },
    { upsert: true, new: true }
  );

  return payroll.populate('items.employee');
}

async function finalizePayroll(year, month, userId) {
  const payroll = await Payroll.findOne({ year, month });
  if (!payroll) {
    const err = new Error('Payroll draft not found');
    err.statusCode = 404;
    throw err;
  }
  if (payroll.status === 'finalized') {
    const err = new Error('Already finalized');
    err.statusCode = 400;
    throw err;
  }

  payroll.status = 'finalized';
  payroll.finalizedBy = userId;
  payroll.finalizedAt = new Date();
  await payroll.save();
  return payroll;
}

module.exports = {
  preparePayroll,
  finalizePayroll,
  calculateMonthWorkingDays,
};

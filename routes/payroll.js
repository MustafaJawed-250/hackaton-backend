const express = require('express');
const PDFDocument = require('pdfkit');
const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const { authenticate, authorize, requirePasswordChanged } = require('../middleware/auth');
const payrollService = require('../services/payrollService');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');

const router = express.Router();
router.use(authenticate, requirePasswordChanged);

router.post('/prepare', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const year = parseInt(req.body.year) || new Date().getFullYear();
    const month = parseInt(req.body.month) || new Date().getMonth() + 1;
    const payroll = await payrollService.preparePayroll(year, month, req.user.id);
    res.json({ success: true, data: payroll });
  } catch (err) {
    next(err);
  }
});

router.post('/finalize', authorize('admin'), async (req, res, next) => {
  try {
    const year = parseInt(req.body.year);
    const month = parseInt(req.body.month);
    const payroll = await payrollService.finalizePayroll(year, month, req.user.id);

    await AuditLog.create({
      actor: req.user.id,
      action: 'FINALIZE_PAYROLL',
      entity: 'Payroll',
      entityId: payroll._id,
      after: { year, month, totalNet: payroll.totalNet },
    });

    // Notify employees
    for (const item of payroll.items) {
      const emp = await Employee.findById(item.employee);
      if (emp?.user) {
        await Notification.create({
          user: emp.user,
          title: 'Payslip Available',
          message: `Your payslip for ${month}/${year} is now available.`,
          type: 'payroll',
        });
      }
    }

    res.json({ success: true, data: payroll });
  } catch (err) {
    next(err);
  }
});

router.get('/', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const list = await Payroll.find().sort({ year: -1, month: -1 }).limit(24);
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

router.get('/:year/:month', authorize('admin', 'hr'), async (req, res, next) => {
  try {
    const payroll = await Payroll.findOne({
      year: parseInt(req.params.year),
      month: parseInt(req.params.month),
    }).populate('items.employee', 'firstName lastName employeeCode');
    if (!payroll) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: payroll });
  } catch (err) {
    next(err);
  }
});

// Employee downloads own payslip PDF
router.get('/payslip/:year/:month', authorize('employee'), async (req, res, next) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const payroll = await Payroll.findOne({ year, month, status: 'finalized' });
    if (!payroll) return res.status(404).json({ success: false, message: 'Payslip not available' });

    const item = payroll.items.find(
      (i) => i.employee.toString() === req.user.employee?.toString()
    );
    if (!item) return res.status(404).json({ success: false, message: 'No payslip for you' });

    const emp = await Employee.findById(req.user.employee);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=payslip-${emp.employeeCode}-${year}-${month}.pdf`
    );
    doc.pipe(res);

    doc.fontSize(20).text('HCM Lite - Payslip', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Employee: ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`);
    doc.text(`Period: ${month}/${year}`);
    doc.moveDown();
    doc.text(`Basic: PKR ${item.basic.toLocaleString()}`);
    doc.text(`HRA (40%): PKR ${item.hra.toLocaleString()}`);
    doc.text(`Medical (10%): PKR ${item.medical.toLocaleString()}`);
    doc.text(`Gross: PKR ${item.gross.toLocaleString()}`);
    doc.moveDown();
    doc.text(`Deductions: PKR ${item.deductions.toLocaleString()}`);
    doc.text(`Tax: PKR ${item.tax.toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(14).text(`Net Pay: PKR ${item.net.toLocaleString()}`, { underline: true });
    doc.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

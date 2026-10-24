const mongoose = require('mongoose');

const payrollItemSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    basic: Number,
    hra: Number,
    medical: Number,
    gross: Number,
    absentDays: Number,
    halfDays: Number,
    unpaidLeaveDays: Number,
    deductions: Number,
    tax: Number,
    net: Number,
    workingDaysInMonth: Number,
    presentDays: Number,
  },
  { _id: false }
);

const payrollSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    status: {
      type: String,
      enum: ['draft', 'finalized'],
      default: 'draft',
    },
    items: [payrollItemSchema],
    totalGross: { type: Number, default: 0 },
    totalNet: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    finalizedAt: Date,
  },
  { timestamps: true }
);

payrollSchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Payroll', payrollSchema);

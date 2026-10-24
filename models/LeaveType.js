const mongoose = require('mongoose');

const leaveTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    annualQuota: { type: Number, default: 0 }, // 0 or null = unlimited (unpaid)
    isPaid: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    description: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeaveType', leaveTypeSchema);

const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    date: { type: Date, required: true }, // normalized to start of day UTC
    checkIn: Date,
    checkOut: Date,
    status: {
      type: String,
      enum: ['present', 'late', 'half_day', 'absent', 'missing_checkout', 'on_leave'],
      default: 'present',
    },
    workingHours: { type: Number, default: 0 }, // decimal hours
    isLate: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    source: {
      type: String,
      enum: ['web', 'camera', 'correction', 'system'],
      default: 'web',
    },
    location: {
      lat: Number,
      lng: Number,
      accuracy: Number,
      distanceMeters: Number,
    },
    notes: String,
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);

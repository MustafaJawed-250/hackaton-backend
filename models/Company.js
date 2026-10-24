const mongoose = require('mongoose');

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    orgCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 4,
      maxlength: 16,
    },
    logoUrl: String,
    address: String,
    phone: String,
    email: String,
    officeStartTime: { type: String, default: '09:00' },
    gracePeriodMinutes: { type: Number, default: 15 },
    halfDayThresholdHours: { type: Number, default: 5 },
    weekendDays: { type: [Number], default: [0, 6] },
    officeLat: { type: Number, default: 24.8607 },
    officeLng: { type: Number, default: 67.0011 },
    geofenceRadiusMeters: { type: Number, default: 150 },
    isSetupComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Company', companySchema);
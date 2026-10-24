const mongoose = require('mongoose');

const designationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, unique: true, trim: true },
    level: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Designation', designationSchema);

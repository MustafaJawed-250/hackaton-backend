const mongoose = require('mongoose');

const salaryStructureSchema = new mongoose.Schema(
  {
    basic: { type: Number, required: true, min: 0 },
    // Derived: HRA 40%, Medical 10%, Gross = 1.5 * basic
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not'], default: 'prefer_not' },
    dateOfBirth: Date,
    joiningDate: { type: Date, required: true },
    exitDate: Date,
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation', required: true },
    employmentStatus: {
      type: String,
      enum: ['active', 'inactive', 'terminated', 'resigned'],
      default: 'active',
    },
    salaryStructure: { type: salaryStructureSchema, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

employeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

employeeSchema.index({ firstName: 'text', lastName: 'text', email: 'text', employeeCode: 'text' });

module.exports = mongoose.model('Employee', employeeSchema);

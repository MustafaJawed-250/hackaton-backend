const mongoose = require('mongoose');

const aiLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String,
    model: String,
    toolsCalled: [String],
    success: Boolean,
    durationMs: Number,
    error: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('AiLog', aiLogSchema);

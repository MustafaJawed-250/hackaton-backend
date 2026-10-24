

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function resetAdminPassword() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const email = 'bbgff@dgd.com';
    const newPassword = process.env.NEW_ADMIN_PASSWORD;

    if (!newPassword || newPassword.length < 12) {
      throw new Error(
        'Set NEW_ADMIN_PASSWORD to a password of at least 12 characters.'
      );
    }

    const admin = await User.findOne({ email }).select('+password');

    if (!admin || admin.role !== 'admin') {
      throw new Error('Admin account not found; no changes made.');
    }

    admin.password = newPassword;
    await admin.save();

    console.log('Admin password updated successfully.');
  } catch (error) {
    console.error('Password update failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

resetAdminPassword();

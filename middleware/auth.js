const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
  let decoded;
  try {
    let token = req.cookies?.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  try {
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid or inactive account' });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      employee: user.employee,
      mustChangePassword: user.mustChangePassword,
    };
  } catch (err) {
    return next(err);
  }
  return next();
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  next();
};

const requirePasswordChanged = (req, res, next) => {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      success: false,
      message: 'Password change required',
      code: 'MUST_CHANGE_PASSWORD',
    });
  }
  next();
};

module.exports = { authenticate, authorize, requirePasswordChanged };

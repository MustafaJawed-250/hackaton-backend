require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');

const app = express();
mongoose.set('bufferCommands', false);

// Validate critical env early
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.warn('⚠ JWT_SECRET is missing or too short. Set a strong secret in .env');
}
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const frontendUrl = (
  process.env.FRONTEND_URL || 'http://localhost:5173'
).replace(/\/+$/, '');

app.use(cors({
  origin: frontendUrl,
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/v1/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const mongo = states[mongoose.connection.readyState] || 'unknown';
  const isConnected = mongoose.connection.readyState === 1;
  res.status(isConnected ? 200 : 503).json({
    success: isConnected,
    status: isConnected ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    mongo,
  });
});

app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/setup', require('./routes/setup'));
app.use('/api/v1/employees', require('./routes/employees'));
app.use('/api/v1/attendance', require('./routes/attendance'));
app.use('/api/v1/leave', require('./routes/leave'));
app.use('/api/v1/payroll', require('./routes/payroll'));
app.use('/api/v1/analytics', require('./routes/analytics'));
app.use('/api/v1/ai', require('./routes/ai'));

app.get('/api/v1/departments', require('./middleware/auth').authenticate, async (req, res) => {
  const Department = require('./models/Department');
  const list = await Department.find({ isActive: true });
  res.json({ success: true, data: list });
});
app.get('/api/v1/designations', require('./middleware/auth').authenticate, async (req, res) => {
  const Designation = require('./models/Designation');
  const list = await Designation.find({ isActive: true });
  res.json({ success: true, data: list });
});

app.get('/api/v1/announcements', require('./middleware/auth').authenticate, async (req, res) => {
  const Announcement = require('./models/Announcement');
  const list = await Announcement.find()
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(20)
    .populate('postedBy', 'email role');
  res.json({ success: true, data: list });
});
app.post(
  '/api/v1/announcements',
  require('./middleware/auth').authenticate,
  require('./middleware/auth').authorize('admin', 'hr'),
  async (req, res, next) => {
    try {
      const Announcement = require('./models/Announcement');
      const a = await Announcement.create({
        title: req.body.title,
        body: req.body.body,
        postedBy: req.user.id,
        isPinned: !!req.body.isPinned,
      });
      res.status(201).json({ success: true, data: a });
    } catch (err) {
      next(err);
    }
  }
);

app.get('/api/v1/notifications', require('./middleware/auth').authenticate, async (req, res) => {
  const Notification = require('./models/Notification');
  const list = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: list });
});
app.post('/api/v1/notifications/read-all', require('./middleware/auth').authenticate, async (req, res) => {
  const Notification = require('./models/Notification');
  await Notification.updateMany({ user: req.user.id, isRead: false }, { isRead: true });
  res.json({ success: true });
});

app.get(
  '/api/v1/audit',
  require('./middleware/auth').authenticate,
  require('./middleware/auth').authorize('admin'),
  async (req, res) => {
    const AuditLog = require('./models/AuditLog');
    const page = parseInt(req.query.page) || 1;
    const limit = 30;
    const [items, total] = await Promise.all([
      AuditLog.find()
        .populate('actor', 'email role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      AuditLog.countDocuments(),
    ]);
    res.json({ success: true, data: items, pagination: { page, total } });
  }
);

app.get('/api/v1/settings', require('./middleware/auth').authenticate, async (req, res) => {
  const Company = require('./models/Company');
  const company = await Company.findOne();
  res.json({ success: true, data: company });
});
app.patch(
  '/api/v1/settings',
  require('./middleware/auth').authenticate,
  require('./middleware/auth').authorize('admin'),
  async (req, res, next) => {
    try {
      const Company = require('./models/Company');
      const allowed = [
        'name', 'address', 'phone', 'email', 'officeStartTime', 'gracePeriodMinutes',
        'halfDayThresholdHours', 'weekendDays', 'officeLat', 'officeLng', 'geofenceRadiusMeters',
      ];
      const updates = {};
      for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
      const company = await Company.findOneAndUpdate({}, updates, { new: true });
      res.json({ success: true, data: company });
    } catch (err) {
      next(err);
    }
  }
);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('✗ MONGODB_URI is required. Set it in backend/.env before starting the API.');
    process.exit(1);
  }
  const isAtlas = uri.includes('mongodb+srv://');
  let hostname = 'unknown';
  try {
    const parsedUri = new URL(uri);
    if (!['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol) || !parsedUri.hostname) {
      throw new Error('Unsupported or incomplete MongoDB URI');
    }
    hostname = parsedUri.hostname;
  } catch {
    console.error('✗ MONGODB_URI is not a valid MongoDB connection URI.');
    process.exit(1);
  }

  try {
    console.log(`Connecting to MongoDB${isAtlas ? ' Atlas' : ''} (${hostname})…`);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 12000,
    });
    console.log('✓ MongoDB connected');
  } catch (err) {
    const message = String(err.message || err).replace(/mongodb(?:\+srv)?:\/\/[^\s'"]+/gi, '[redacted MongoDB URI]');
    console.error(`✗ MongoDB connection failed (${err.name || 'Error'}): ${message}`);
    if (/querySrv|ETIMEOUT|ENOTFOUND|ESERVFAIL|DNS/i.test(`${err.name || ''} ${message}`)) {
      console.error('');
      console.error('  DNS lookup failed while reaching MongoDB Atlas.');
      console.error('  Checklist:');
      console.error('  1. Confirm MONGODB_URI in backend/.env matches the Atlas connection string');
      console.error('  2. Atlas → Network Access → allow your IP (or 0.0.0.0/0 for demo)');
      console.error('  3. Atlas cluster is not paused');
      console.error('  4. Local DNS can resolve _mongodb._tcp.<cluster>.mongodb.net');
      console.error('  This cannot be fixed from application code alone.');
      console.error('');
    }
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✓ HCM Lite API running on http://localhost:${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/api/v1/health`);
  });

  mongoose.connection.on('disconnected', () => {
    console.error('MongoDB connection lost. API requests requiring the database will return 503 until it reconnects.');
  });
  mongoose.connection.on('error', (err) => {
    const message = String(err.message || err).replace(/mongodb(?:\+srv)?:\/\/[^\s'"]+/gi, '[redacted MongoDB URI]');
    console.error(`MongoDB connection error (${err.name || 'Error'}): ${message}`);
  });
}

start();
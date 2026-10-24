const Attendance = require('../models/Attendance');
const Company = require('../models/Company');
const LeaveRequest = require('../models/LeaveRequest');
const { startOfDay, haversineMeters } = require('../utils/helpers');

async function getCompanyRules() {
  const company = await Company.findOne();
  if (!company) throw Object.assign(new Error('Company not configured'), { statusCode: 400 });
  return company;
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

async function checkIn(employeeId, options = {}) {
  const company = await getCompanyRules();
  const today = startOfDay(new Date());

  const existing = await Attendance.findOne({ employee: employeeId, date: today });
  if (existing && existing.checkIn) {
    const err = new Error('Already checked in today');
    err.statusCode = 409;
    throw err;
  }

  // Geofence check (server-side)
  if (options.lat != null && options.lng != null) {
    if (options.accuracy != null && options.accuracy > 100) {
      const err = new Error('GPS accuracy too low (must be ≤ 100m)');
      err.statusCode = 400;
      throw err;
    }
    const dist = haversineMeters(
      options.lat,
      options.lng,
      company.officeLat,
      company.officeLng
    );
    if (dist > company.geofenceRadiusMeters) {
      const err = new Error(`Outside geofence (${Math.round(dist)}m away)`);
      err.statusCode = 403;
      throw err;
    }
  }

  const now = new Date();
  const officeStartMins = parseTimeToMinutes(company.officeStartTime);
  const grace = company.gracePeriodMinutes;
  const checkInMins = now.getUTCHours() * 60 + now.getUTCMinutes(); // approximate; production should use local TZ
  // For demo we use server local; in real deploy use proper timezone
  const localNow = new Date();
  const localMins = localNow.getHours() * 60 + localNow.getMinutes();
  const isLate = localMins > officeStartMins + grace;
  const lateMinutes = isLate ? localMins - officeStartMins : 0;

  const status = isLate ? 'late' : 'present';

  const record = await Attendance.findOneAndUpdate(
    { employee: employeeId, date: today },
    {
      employee: employeeId,
      date: today,
      checkIn: now,
      status,
      isLate,
      lateMinutes,
      source: options.source || 'web',
      location: options.lat
        ? {
            lat: options.lat,
            lng: options.lng,
            accuracy: options.accuracy,
            distanceMeters: options.lat
              ? haversineMeters(options.lat, options.lng, company.officeLat, company.officeLng)
              : undefined,
          }
        : undefined,
    },
    { upsert: true, new: true }
  );

  return record;
}

async function checkOut(employeeId) {
  const company = await getCompanyRules();
  const today = startOfDay(new Date());
  const record = await Attendance.findOne({ employee: employeeId, date: today });

  if (!record || !record.checkIn) {
    const err = new Error('No check-in found for today');
    err.statusCode = 400;
    throw err;
  }
  if (record.checkOut) {
    const err = new Error('Already checked out');
    err.statusCode = 409;
    throw err;
  }

  const now = new Date();
  const workingMs = now - record.checkIn;
  const workingHours = workingMs / (1000 * 60 * 60);

  let status = record.status;
  if (workingHours < company.halfDayThresholdHours) {
    status = 'half_day';
  } else if (record.isLate) {
    status = 'late';
  } else {
    status = 'present';
  }

  record.checkOut = now;
  record.workingHours = Math.round(workingHours * 100) / 100;
  record.status = status;
  await record.save();
  return record;
}

async function getTodayStatus(employeeId) {
  const today = startOfDay(new Date());
  return Attendance.findOne({ employee: employeeId, date: today });
}

module.exports = {
  checkIn,
  checkOut,
  getTodayStatus,
  getCompanyRules,
};

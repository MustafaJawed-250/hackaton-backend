/**
 * Normalize date to UTC midnight
 */
function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Haversine distance in metres
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Count working days between two dates (inclusive), excluding weekends and holidays
 */
function countWorkingDays(start, end, weekendDays = [0, 6], holidayDates = []) {
  const holidaySet = new Set(holidayDates.map((d) => startOfDay(d).toISOString()));
  let count = 0;
  const cur = startOfDay(start);
  const last = startOfDay(end);
  while (cur <= last) {
    const day = cur.getUTCDay();
    if (!weekendDays.includes(day) && !holidaySet.has(cur.toISOString())) {
      count += 1;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * Pakistani-style progressive tax on annual gross (hackathon demo rules)
 */
function calculateAnnualTax(annualGross) {
  if (annualGross <= 600000) return 0;
  if (annualGross <= 1200000) return 0.05 * (annualGross - 600000);
  if (annualGross <= 2400000) return 30000 + 0.15 * (annualGross - 1200000);
  if (annualGross <= 3600000) return 210000 + 0.25 * (annualGross - 2400000);
  return 510000 + 0.35 * (annualGross - 3600000);
}

function generateEmployeeCode(seq) {
  return `EMP${String(seq).padStart(5, '0')}`;
}

function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}

module.exports = {
  startOfDay,
  haversineMeters,
  countWorkingDays,
  calculateAnnualTax,
  generateEmployeeCode,
  generateTempPassword,
};

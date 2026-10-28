/**
 * Clinic pack pure rules — embedded port of
 * backend-zapeera-v1-main/src/utils/clinic.util.ts.
 * Controllers own the database; this file owns the rules that must
 * never drift between them: the appointment status machine, the
 * per-doctor-per-day OPD token sequence, the doctor-share money math
 * (snapshotted at visit completion), and the settlement aggregation.
 */
const APPOINTMENT_STATUSES = ['BOOKED', 'CHECKED_IN', 'IN_VISIT', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

const APPOINTMENT_TRANSITIONS = {
  BOOKED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_VISIT', 'CANCELLED', 'NO_SHOW'],
  IN_VISIT: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
};

function isAppointmentStatus(value) {
  return typeof value === 'string' && APPOINTMENT_STATUSES.includes(value);
}

function canTransitionAppointment(from, to) {
  if (!isAppointmentStatus(from) || !isAppointmentStatus(to)) return false;
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

/** Normalize any date input to UTC midnight of its UTC calendar day. */
function normalizeAppointmentDate(input) {
  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString();
  }
  const date = input instanceof Date ? input : new Date(input);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function nextTokenNumber(existingTokens) {
  let max = 0;
  for (const token of existingTokens) {
    if (Number.isFinite(token) && token > max) max = token;
  }
  return max + 1;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function computeDoctorShare(feeCharged, sharePercent) {
  const fee = Math.max(0, round2(feeCharged));
  const pct = Math.min(100, Math.max(0, Number(sharePercent) || 0));
  const doctorShare = round2((fee * pct) / 100);
  return { doctorShare, clinicShare: round2(fee - doctorShare) };
}

const consultationProductName = (doctorName) => `Consultation — Dr ${String(doctorName || '').trim()}`;
const consultationProductSku = (doctorId) => `CONSULT-${String(doctorId || '').trim()}`;

/** Aggregate one doctor's settlement position for a period. */
function summarizeDoctorSettlement(doctorId, visits, payments) {
  let visitsCount = 0;
  let revenue = 0;
  let doctorShare = 0;
  for (const visit of visits) {
    if (visit.doctorId !== doctorId) continue;
    visitsCount += 1;
    revenue += Number(visit.feeCharged) || 0;
    doctorShare += Number(visit.doctorShareAmount) || 0;
  }
  let settled = 0;
  for (const payment of payments) {
    if (payment.doctorId !== doctorId) continue;
    settled += Number(payment.amount) || 0;
  }
  const doctorShareRounded = round2(doctorShare);
  const settledRounded = round2(settled);
  return {
    doctorId,
    visits: visitsCount,
    consultationRevenue: round2(revenue),
    doctorShare: doctorShareRounded,
    clinicShare: round2(revenue - doctorShare),
    settled: settledRounded,
    outstanding: round2(doctorShareRounded - settledRounded)
  };
}

module.exports = {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  isAppointmentStatus,
  canTransitionAppointment,
  normalizeAppointmentDate,
  nextTokenNumber,
  round2,
  computeDoctorShare,
  consultationProductName,
  consultationProductSku,
  summarizeDoctorSettlement
};

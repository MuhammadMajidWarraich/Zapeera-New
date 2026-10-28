/**
 * Hotel pack pure rules — embedded port of
 * backend-zapeera-v1-main/src/utils/hotel.util.ts.
 * Controllers own the database; this file owns the rules that must
 * never drift: stay-date math, room availability, the housekeeping
 * room-status machine, folio money (balance from rows, never stored),
 * and the checkout-invoice split of folio-native vs charged-to-room.
 */
const ROOM_STATUSES = ['AVAILABLE', 'OCCUPIED', 'DIRTY', 'MAINTENANCE'];
const RESERVATION_STATUSES = ['BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const BLOCKING_RESERVATION_STATUSES = ['BOOKED', 'CHECKED_IN'];
const FOLIO_CHARGE_KINDS = ['ROOM_NIGHT', 'SERVICE', 'MANUAL'];
const DAY_MS = 24 * 60 * 60 * 1000;

const isRoomStatus = (value) => typeof value === 'string' && ROOM_STATUSES.includes(value);
const isReservationStatus = (value) => typeof value === 'string' && RESERVATION_STATUSES.includes(value);

/** OCCUPIED is absent from every target list: only check-in/out move it. */
const ROOM_STATUS_TRANSITIONS = {
  AVAILABLE: ['DIRTY', 'MAINTENANCE'],
  OCCUPIED: [],
  DIRTY: ['AVAILABLE', 'MAINTENANCE'],
  MAINTENANCE: ['AVAILABLE', 'DIRTY']
};

function canTransitionRoomStatus(from, to) {
  if (!isRoomStatus(from) || !isRoomStatus(to)) return false;
  if (from === to) return false;
  return ROOM_STATUS_TRANSITIONS[from].includes(to);
}

/** Check-in/out are flows, not statuses — the status endpoint only cancels / no-shows. */
const RESERVATION_TRANSITIONS = {
  BOOKED: ['CANCELLED', 'NO_SHOW'],
  CHECKED_IN: [],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
};

function canTransitionReservation(from, to) {
  if (!isReservationStatus(from) || !isReservationStatus(to)) return false;
  return RESERVATION_TRANSITIONS[from].includes(to);
}

/** Normalize any date input to UTC midnight of its UTC calendar day. */
function normalizeHotelDate(input) {
  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const date = input instanceof Date ? input : new Date(input);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function nightsBetween(checkIn, checkOut) {
  return Math.round((normalizeHotelDate(checkOut).getTime() - normalizeHotelDate(checkIn).getTime()) / DAY_MS);
}

const isValidStayRange = (checkIn, checkOut) => nightsBetween(checkIn, checkOut) >= 1;

/** Half-open overlap [aStart, aEnd) vs [bStart, bEnd): same-day turnover is fine. */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const aS = normalizeHotelDate(aStart).getTime();
  const aE = normalizeHotelDate(aEnd).getTime();
  const bS = normalizeHotelDate(bStart).getTime();
  const bE = normalizeHotelDate(bEnd).getTime();
  return aS < bE && bS < aE;
}

function rangeIncludesDay(start, end, day) {
  const s = normalizeHotelDate(start).getTime();
  const e = normalizeHotelDate(end).getTime();
  const d = normalizeHotelDate(day).getTime();
  return d >= s && d < e;
}

const sameUtcDay = (a, b) => normalizeHotelDate(a).getTime() === normalizeHotelDate(b).getTime();

function isRoomBookable(input) {
  if (!input.isActive) return false;
  if (input.hasBlockingOverlap) return false;
  if (input.rangeIncludesToday && input.status === 'MAINTENANCE') return false;
  return true;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function folioBalance(charges, payments) {
  const charged = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return round2(charged - paid);
}

/** Split folio charges: native (nights + desk charges, no sale) vs charged-to-room (saleId set). */
function summarizeFolioCharges(charges, payments) {
  let roomNightCount = 0;
  let roomNightTotal = 0;
  let nativeTotal = 0;
  let chargedToRoomTotal = 0;
  for (const charge of charges) {
    const amount = Number(charge.amount) || 0;
    if (charge.saleId) {
      chargedToRoomTotal += amount;
      continue;
    }
    nativeTotal += amount;
    if (charge.kind === 'ROOM_NIGHT') {
      roomNightCount += 1;
      roomNightTotal += amount;
    }
  }
  const totalCharges = round2(nativeTotal + chargedToRoomTotal);
  const totalPayments = round2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  return {
    totalCharges,
    totalPayments,
    balance: round2(totalCharges - totalPayments),
    roomNightCount,
    roomNightTotal: round2(roomNightTotal),
    nativeTotal: round2(nativeTotal),
    chargedToRoomTotal: round2(chargedToRoomTotal)
  };
}

const roomNightProductName = (roomTypeName) => `Room Night — ${String(roomTypeName || '').trim()}`;
const roomNightProductSku = (roomTypeId) => `ROOMNIGHT-${String(roomTypeId || '').trim()}`;
const folioChargeProductName = (description) => String(description || '').trim();
const folioChargeProductSku = (chargeId) => `FOLIOCHG-${String(chargeId || '').trim()}`;

module.exports = {
  ROOM_STATUSES,
  RESERVATION_STATUSES,
  BLOCKING_RESERVATION_STATUSES,
  FOLIO_CHARGE_KINDS,
  DAY_MS,
  isRoomStatus,
  isReservationStatus,
  ROOM_STATUS_TRANSITIONS,
  canTransitionRoomStatus,
  RESERVATION_TRANSITIONS,
  canTransitionReservation,
  normalizeHotelDate,
  nightsBetween,
  isValidStayRange,
  rangesOverlap,
  rangeIncludesDay,
  sameUtcDay,
  isRoomBookable,
  round2,
  folioBalance,
  summarizeFolioCharges,
  roomNightProductName,
  roomNightProductSku,
  folioChargeProductName,
  folioChargeProductSku
};

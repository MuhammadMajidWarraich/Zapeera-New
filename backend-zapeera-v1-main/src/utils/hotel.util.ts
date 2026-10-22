// Hotel pack helpers (Wave C5) — pure functions, unit-checked by
// scripts/hotel-selfcheck.ts. The controllers own the database; this
// file owns the rules that must never drift between them:
//   · stay-date math (nights, overlap, "today" on normalized dates),
//   · room availability for a date range,
//   · the housekeeping room-status machine,
//   · folio money (balance from charge/payment rows, never stored),
//   · the checkout-invoice split of folio-native vs charged-to-room.

export const ROOM_STATUSES = ['AVAILABLE', 'OCCUPIED', 'DIRTY', 'MAINTENANCE'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const RESERVATION_STATUSES = [
  'BOOKED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Statuses that hold the room for their date range. */
export const BLOCKING_RESERVATION_STATUSES: readonly string[] = ['BOOKED', 'CHECKED_IN'];

export const FOLIO_CHARGE_KINDS = ['ROOM_NIGHT', 'SERVICE', 'MANUAL'] as const;
export type FolioChargeKind = (typeof FOLIO_CHARGE_KINDS)[number];

export const isRoomStatus = (value: unknown): value is RoomStatus =>
  typeof value === 'string' && (ROOM_STATUSES as readonly string[]).includes(value);

export const isReservationStatus = (value: unknown): value is ReservationStatus =>
  typeof value === 'string' && (RESERVATION_STATUSES as readonly string[]).includes(value);

/**
 * The housekeeping board machine. OCCUPIED is deliberately absent
 * from every target list and has no outgoing manual transitions:
 * only check-in puts a room into OCCUPIED and only check-out takes
 * it out (to DIRTY). Manual moves are the desk/housekeeping ones —
 * clean a dirty room, take a room out of service, bring it back.
 */
export const ROOM_STATUS_TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  AVAILABLE: ['DIRTY', 'MAINTENANCE'],
  OCCUPIED: [],
  DIRTY: ['AVAILABLE', 'MAINTENANCE'],
  MAINTENANCE: ['AVAILABLE', 'DIRTY']
};

export const canTransitionRoomStatus = (from: string, to: string): boolean => {
  if (!isRoomStatus(from) || !isRoomStatus(to)) return false;
  if (from === to) return false;
  return ROOM_STATUS_TRANSITIONS[from].includes(to);
};

/** Reservation moves the status endpoint may make (check-in/out are flows, not statuses). */
export const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  BOOKED: ['CANCELLED', 'NO_SHOW'],
  CHECKED_IN: [],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
};

export const canTransitionReservation = (from: string, to: string): boolean => {
  if (!isReservationStatus(from) || !isReservationStatus(to)) return false;
  return RESERVATION_TRANSITIONS[from].includes(to);
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize any date input to UTC midnight of its UTC calendar day
 * (the clinic pack's rule). checkInDate/checkOutDate are stored at
 * this normalized instant so overlap tests and day-range queries
 * agree exactly.
 */
export const normalizeHotelDate = (input: string | Date): Date => {
  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    }
  }
  const date = input instanceof Date ? input : new Date(input as any);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/** Whole nights between two normalized dates. checkOut − checkIn. */
export const nightsBetween = (checkIn: Date, checkOut: Date): number => {
  const start = normalizeHotelDate(checkIn).getTime();
  const end = normalizeHotelDate(checkOut).getTime();
  return Math.round((end - start) / DAY_MS);
};

/** A bookable stay is at least one night: check-out strictly after check-in. */
export const isValidStayRange = (checkIn: Date, checkOut: Date): boolean =>
  nightsBetween(checkIn, checkOut) >= 1;

/**
 * Half-open range overlap on normalized dates: [aStart, aEnd) vs
 * [bStart, bEnd). A guest checking out on the 12th and another
 * checking in on the 12th do NOT overlap — the room turns over.
 */
export const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean => {
  const aS = normalizeHotelDate(aStart).getTime();
  const aE = normalizeHotelDate(aEnd).getTime();
  const bS = normalizeHotelDate(bStart).getTime();
  const bE = normalizeHotelDate(bEnd).getTime();
  return aS < bE && bS < aE;
};

/** Does the (normalized) range cover the given day? */
export const rangeIncludesDay = (start: Date, end: Date, day: Date): boolean => {
  const s = normalizeHotelDate(start).getTime();
  const e = normalizeHotelDate(end).getTime();
  const d = normalizeHotelDate(day).getTime();
  return d >= s && d < e;
};

export const sameUtcDay = (a: Date, b: Date): boolean =>
  normalizeHotelDate(a).getTime() === normalizeHotelDate(b).getTime();

export interface RoomAvailabilityInput {
  status: string;
  isActive: boolean;
  /** Any BOOKED/CHECKED_IN reservation overlapping the range. */
  hasBlockingOverlap: boolean;
  /** The range includes today (the room's physical state matters). */
  rangeIncludesToday: boolean;
}

/**
 * A room is bookable for a range when it exists (active), no
 * blocking reservation overlaps, and — when the stay starts today —
 * the room is not out of service (MAINTENANCE). A DIRTY room stays
 * bookable for a future range (housekeeping will turn it over) and,
 * for tonight, is the desk's call — the board shows it dirty rather
 * than the API silently refusing the booking.
 */
export const isRoomBookable = (input: RoomAvailabilityInput): boolean => {
  if (!input.isActive) return false;
  if (input.hasBlockingOverlap) return false;
  if (input.rangeIncludesToday && input.status === 'MAINTENANCE') return false;
  return true;
};

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface FolioChargeRow {
  kind: string;
  amount: number;
  saleId?: string | null;
}

export interface FolioPaymentRow {
  amount: number;
}

/** The folio's money truth: Σ charges − Σ payments. Never stored. */
export const folioBalance = (charges: FolioChargeRow[], payments: FolioPaymentRow[]): number => {
  const charged = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return round2(charged - paid);
};

export interface FolioChargeSummary {
  totalCharges: number;
  totalPayments: number;
  balance: number;
  roomNightCount: number;
  roomNightTotal: number;
  /** Charges raised by the folio itself (nights + desk charges) — what the checkout invoice bills. */
  nativeTotal: number;
  /** POS sales charged to the room — already invoices in their own right, never re-billed. */
  chargedToRoomTotal: number;
}

/**
 * Split a folio's charges into the two populations check-out treats
 * differently: folio-NATIVE charges (room nights + desk-added
 * SERVICE/MANUAL rows with no sale behind them) are summarized onto
 * the checkout invoice; charges that CAME from a POS sale (saleId
 * set) are that sale's own bill and are never re-billed.
 */
export const summarizeFolioCharges = (
  charges: FolioChargeRow[],
  payments: FolioPaymentRow[]
): FolioChargeSummary => {
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
};

/** Display/SKU identity of the auto-ensured service products the checkout invoice rides on. */
export const roomNightProductName = (roomTypeName: string): string =>
  `Room Night — ${String(roomTypeName || '').trim()}`;

export const roomNightProductSku = (roomTypeId: string): string =>
  `ROOMNIGHT-${String(roomTypeId || '').trim()}`;

export const folioChargeProductName = (description: string): string =>
  String(description || '').trim();

export const folioChargeProductSku = (chargeId: string): string =>
  `FOLIOCHG-${String(chargeId || '').trim()}`;

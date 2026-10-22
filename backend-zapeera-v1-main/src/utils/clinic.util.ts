// Clinic pack helpers (Wave C4) — pure functions, unit-checked by
// scripts/clinic-selfcheck.ts. The controllers own the database; this
// file owns the rules that must never drift between them:
//   · the appointment status machine,
//   · the per-doctor-per-day OPD token sequence,
//   · the doctor-share money math (snapshotted at visit completion),
//   · the settlement report aggregation (earned − paid = outstanding).

export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'CHECKED_IN',
  'IN_VISIT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/**
 * The OPD flow. Forward path: BOOKED → CHECKED_IN → IN_VISIT →
 * COMPLETED (COMPLETED is reached only through complete-visit, which
 * bills the visit — the status endpoint refuses it). A booking that
 * never enters the visit can be cancelled or marked no-show from
 * BOOKED or CHECKED_IN. Terminal states have no outgoing transitions.
 */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_VISIT', 'CANCELLED', 'NO_SHOW'],
  IN_VISIT: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
};

export const isAppointmentStatus = (value: unknown): value is AppointmentStatus =>
  typeof value === 'string' && (APPOINTMENT_STATUSES as readonly string[]).includes(value);

export const canTransitionAppointment = (from: string, to: string): boolean => {
  if (!isAppointmentStatus(from) || !isAppointmentStatus(to)) return false;
  return APPOINTMENT_TRANSITIONS[from].includes(to);
};

/**
 * Normalize any date input to UTC midnight of its UTC calendar day.
 * appointmentDate is stored at this normalized instant so the
 * (doctorId, appointmentDate, tokenNumber) unique constraint and the
 * day-range queries agree exactly. Accepts 'YYYY-MM-DD' strings and
 * Date objects (their UTC date part wins).
 */
export const normalizeAppointmentDate = (input: string | Date): Date => {
  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    }
  }
  const date = input instanceof Date ? input : new Date(input as any);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/** The next token for a doctor's day queue: max(existing) + 1, else 1. */
export const nextTokenNumber = (existingTokens: number[]): number => {
  let max = 0;
  for (const token of existingTokens) {
    if (Number.isFinite(token) && token > max) max = token;
  }
  return max + 1;
};

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The money split of one completed visit. sharePercent is the
 * DOCTOR's share of the consultation fee (Doctor.sharePercent); the
 * clinic keeps the remainder. Computed once, at completion, from the
 * fee actually charged — the results are snapshotted onto the
 * Appointment and reports never recompute them.
 */
export const computeDoctorShare = (
  feeCharged: number,
  sharePercent: number
): { doctorShare: number; clinicShare: number } => {
  const fee = Math.max(0, round2(feeCharged));
  const pct = Math.min(100, Math.max(0, Number(sharePercent) || 0));
  const doctorShare = round2((fee * pct) / 100);
  return { doctorShare, clinicShare: round2(fee - doctorShare) };
};

/** Display name + SKU of a doctor's auto-ensured consultation product. */
export const consultationProductName = (doctorName: string): string =>
  `Consultation — Dr ${String(doctorName || '').trim()}`;

export const consultationProductSku = (doctorId: string): string =>
  `CONSULT-${String(doctorId || '').trim()}`;

export interface SettlementVisitRow {
  doctorId: string;
  feeCharged: number | null;
  doctorShareAmount: number | null;
}

export interface SettlementPaymentRow {
  doctorId: string;
  amount: number;
}

export interface DoctorSettlementSummary {
  doctorId: string;
  visits: number;
  consultationRevenue: number;
  doctorShare: number;
  clinicShare: number;
  settled: number;
  outstanding: number;
}

/**
 * Aggregate one doctor's settlement position for a period from
 * SNAPSHOT rows (completed appointments in the window) and settlement
 * payments made in the window. Semantics (deliberately simple, and
 * the same words the API returns):
 *   earned      = Σ doctorShareAmount over visits completed in window
 *   settled     = Σ settlement amounts paid in window (by payment date)
 *   outstanding = earned − settled (may go negative if a payout ran
 *                 ahead of the window's earnings — that is the
 *                 clinic's signal it overpaid for that window)
 */
export const summarizeDoctorSettlement = (
  doctorId: string,
  visits: SettlementVisitRow[],
  payments: SettlementPaymentRow[]
): DoctorSettlementSummary => {
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
};

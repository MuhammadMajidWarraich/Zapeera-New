// Numeric self-check for the Wave C4 clinic pack (src/utils/clinic.util.ts).
// Run: npx ts-node --transpile-only scripts/clinic-selfcheck.ts
// Exits non-zero on the first failed invariant.
//
// Cases:
//  1. Token sequencing — empty day starts at 1; sparse/unsorted existing
//     tokens continue from the max; cancelled tokens are NOT reused.
//  2. Status machine — the OPD forward path is allowed, skips and
//     backwards moves are refused, terminal states are closed.
//  3. Date normalization — strings and Date objects land on UTC midnight.
//  4. Doctor-share math — percent splits, rounding edges, clamping.
//  5. Settlement aggregation — earned/settled/outstanding per doctor,
//     including an overpaid window going negative.
import {
  APPOINTMENT_TRANSITIONS,
  canTransitionAppointment,
  computeDoctorShare,
  consultationProductName,
  consultationProductSku,
  nextTokenNumber,
  normalizeAppointmentDate,
  summarizeDoctorSettlement
} from '../src/utils/clinic.util';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('1. Token sequencing');
check('empty day → 1', nextTokenNumber([]) === 1);
check('after [1] → 2', nextTokenNumber([1]) === 2);
check('unsorted [3,1,2] → 4', nextTokenNumber([3, 1, 2]) === 4);
check('gap [1,2,5] → 6 (no reuse)', nextTokenNumber([1, 2, 5]) === 6);
check('junk ignored [0,-2] → 1', nextTokenNumber([0, -2]) === 1);

console.log('2. Status machine');
check('BOOKED→CHECKED_IN', canTransitionAppointment('BOOKED', 'CHECKED_IN'));
check('CHECKED_IN→IN_VISIT', canTransitionAppointment('CHECKED_IN', 'IN_VISIT'));
check('IN_VISIT→COMPLETED', canTransitionAppointment('IN_VISIT', 'COMPLETED'));
check('BOOKED→CANCELLED', canTransitionAppointment('BOOKED', 'CANCELLED'));
check('CHECKED_IN→NO_SHOW', canTransitionAppointment('CHECKED_IN', 'NO_SHOW'));
check('BOOKED→IN_VISIT refused (skip)', !canTransitionAppointment('BOOKED', 'IN_VISIT'));
check('BOOKED→COMPLETED refused (skip)', !canTransitionAppointment('BOOKED', 'COMPLETED'));
check('IN_VISIT→CANCELLED refused', !canTransitionAppointment('IN_VISIT', 'CANCELLED'));
check('COMPLETED→CHECKED_IN refused (terminal)', !canTransitionAppointment('COMPLETED', 'CHECKED_IN'));
check('CANCELLED→BOOKED refused (terminal)', !canTransitionAppointment('CANCELLED', 'BOOKED'));
check('unknown status refused', !canTransitionAppointment('BOOKED', 'BOGUS'));
check(
  'every status has a transitions entry',
  Object.keys(APPOINTMENT_TRANSITIONS).length === 6
);

console.log('3. Date normalization');
const fromString = normalizeAppointmentDate('2026-10-23');
check("'2026-10-23' → UTC midnight", fromString.toISOString() === '2026-10-23T00:00:00.000Z');
const fromDate = normalizeAppointmentDate(new Date('2026-10-23T17:45:00.000Z'));
check('Date with time → same UTC day midnight', fromDate.toISOString() === '2026-10-23T00:00:00.000Z');
const fromDateStringWithTime = normalizeAppointmentDate('2026-10-23T09:30:00');
check('datetime string → its date part', fromDateStringWithTime.toISOString() === '2026-10-23T00:00:00.000Z');

console.log('4. Doctor-share math');
check('fee 1000 @ 60% → doctor 600 / clinic 400', eq(computeDoctorShare(1000, 60), { doctorShare: 600, clinicShare: 400 }));
check('fee 1500 @ 0% → doctor 0 / clinic 1500', eq(computeDoctorShare(1500, 0), { doctorShare: 0, clinicShare: 1500 }));
check('fee 800 @ 100% → doctor 800 / clinic 0', eq(computeDoctorShare(800, 100), { doctorShare: 800, clinicShare: 0 }));
check('fee 999 @ 33% → doctor 329.67 / clinic 669.33', eq(computeDoctorShare(999, 33), { doctorShare: 329.67, clinicShare: 669.33 }));
check('fee 0 → both 0', eq(computeDoctorShare(0, 60), { doctorShare: 0, clinicShare: 0 }));
check('share >100 clamped → doctor takes all', eq(computeDoctorShare(500, 140), { doctorShare: 500, clinicShare: 0 }));
check('parts sum to the fee', (() => { const s = computeDoctorShare(1234.56, 37); return Math.abs(s.doctorShare + s.clinicShare - 1234.56) < 0.001; })());

console.log('5. Settlement aggregation');
const visits = [
  { doctorId: 'doc-a', feeCharged: 1000, doctorShareAmount: 600 },
  { doctorId: 'doc-a', feeCharged: 1000, doctorShareAmount: 600 },
  { doctorId: 'doc-a', feeCharged: 500, doctorShareAmount: 300 },
  { doctorId: 'doc-b', feeCharged: 2000, doctorShareAmount: 1000 }
];
const payments = [
  { doctorId: 'doc-a', amount: 1000 },
  { doctorId: 'doc-b', amount: 1200 }
];
const a = summarizeDoctorSettlement('doc-a', visits, payments);
check('doc-a visits = 3', a.visits === 3);
check('doc-a revenue = 2500', a.consultationRevenue === 2500);
check('doc-a share = 1500', a.doctorShare === 1500);
check('doc-a clinic share = 1000', a.clinicShare === 1000);
check('doc-a settled = 1000', a.settled === 1000);
check('doc-a outstanding = 500', a.outstanding === 500);
const b = summarizeDoctorSettlement('doc-b', visits, payments);
check('doc-b outstanding goes negative when overpaid (−200)', b.outstanding === -200);
const none = summarizeDoctorSettlement('doc-none', visits, payments);
check('unknown doctor → all zeros', none.visits === 0 && none.outstanding === 0);

console.log('6. Service product identity');
check('name', consultationProductName('Ahmed Raza') === 'Consultation — Dr Ahmed Raza');
check('sku', consultationProductSku('cm123') === 'CONSULT-cm123');

if (failures > 0) {
  console.error(`\nclinic-selfcheck: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nclinic-selfcheck: all checks passed');

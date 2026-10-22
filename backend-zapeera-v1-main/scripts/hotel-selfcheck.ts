// Numeric self-check for the Wave C5 hotel pack (src/utils/hotel.util.ts).
// Run: npx ts-node --transpile-only scripts/hotel-selfcheck.ts
// Exits non-zero on the first failed invariant.
//
// Cases:
//  1. Nights — whole days between normalized dates; a same-day
//     "stay" is 0 nights and invalid; ranges need ≥ 1 night.
//  2. Overlap — half-open ranges: back-to-back stays (out 12th, in
//     12th) do NOT overlap; any shared night does.
//  3. Availability — inactive/overlap always refuse; MAINTENANCE
//     refuses only when the range includes today; DIRTY bookable.
//  4. Room status machine — housekeeping moves allowed; OCCUPIED
//     can neither be set nor cleared by hand.
//  5. Folio money — balance = charges − payments; the native vs
//     charged-to-room split the checkout invoice is built from.
import {
  canTransitionReservation,
  canTransitionRoomStatus,
  folioBalance,
  isRoomBookable,
  isValidStayRange,
  nightsBetween,
  normalizeHotelDate,
  rangeIncludesDay,
  rangesOverlap,
  sameUtcDay,
  summarizeFolioCharges
} from '../src/utils/hotel.util';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const d = (s: string) => normalizeHotelDate(s);

console.log('1. Nights and stay ranges');
check('2026-10-22 → 2026-10-25 = 3 nights', nightsBetween(d('2026-10-22'), d('2026-10-25')) === 3);
check('same day = 0 nights', nightsBetween(d('2026-10-22'), d('2026-10-22')) === 0);
check('reversed range is negative', nightsBetween(d('2026-10-25'), d('2026-10-22')) === -3);
check('1 night is a valid stay', isValidStayRange(d('2026-10-22'), d('2026-10-23')));
check('0 nights is not a valid stay', !isValidStayRange(d('2026-10-22'), d('2026-10-22')));
check('time-of-day is normalized away', nightsBetween(new Date('2026-10-22T18:45:00Z'), new Date('2026-10-24T09:15:00Z')) === 2);
check('sameUtcDay across times', sameUtcDay(new Date('2026-10-22T01:00:00Z'), new Date('2026-10-22T23:00:00Z')));

console.log('2. Range overlap (half-open)');
check('back-to-back stays do not overlap', !rangesOverlap(d('2026-10-20'), d('2026-10-22'), d('2026-10-22'), d('2026-10-24')));
check('one shared night overlaps', rangesOverlap(d('2026-10-20'), d('2026-10-23'), d('2026-10-22'), d('2026-10-24')));
check('contained range overlaps', rangesOverlap(d('2026-10-20'), d('2026-10-25'), d('2026-10-21'), d('2026-10-22')));
check('disjoint ranges do not overlap', !rangesOverlap(d('2026-10-20'), d('2026-10-21'), d('2026-10-23'), d('2026-10-24')));
check('range includes its first day', rangeIncludesDay(d('2026-10-22'), d('2026-10-25'), d('2026-10-22')));
check('range excludes its checkout day', !rangeIncludesDay(d('2026-10-22'), d('2026-10-25'), d('2026-10-25')));

console.log('3. Room availability');
const base = { status: 'AVAILABLE', isActive: true, hasBlockingOverlap: false, rangeIncludesToday: false };
check('plain available room is bookable', isRoomBookable(base));
check('inactive room is not bookable', !isRoomBookable({ ...base, isActive: false }));
check('blocking overlap refuses', !isRoomBookable({ ...base, hasBlockingOverlap: true }));
check('MAINTENANCE refuses a tonight range', !isRoomBookable({ ...base, status: 'MAINTENANCE', rangeIncludesToday: true }));
check('MAINTENANCE bookable for a future range', isRoomBookable({ ...base, status: 'MAINTENANCE', rangeIncludesToday: false }));
check('DIRTY stays bookable (desk decides)', isRoomBookable({ ...base, status: 'DIRTY', rangeIncludesToday: true }));

console.log('4. Status machines');
check('DIRTY→AVAILABLE (cleaned)', canTransitionRoomStatus('DIRTY', 'AVAILABLE'));
check('AVAILABLE→MAINTENANCE', canTransitionRoomStatus('AVAILABLE', 'MAINTENANCE'));
check('MAINTENANCE→AVAILABLE', canTransitionRoomStatus('MAINTENANCE', 'AVAILABLE'));
check('AVAILABLE→OCCUPIED refused (check-in only)', !canTransitionRoomStatus('AVAILABLE', 'OCCUPIED'));
check('OCCUPIED→DIRTY refused (check-out only)', !canTransitionRoomStatus('OCCUPIED', 'DIRTY'));
check('OCCUPIED→AVAILABLE refused', !canTransitionRoomStatus('OCCUPIED', 'AVAILABLE'));
check('same-state refused', !canTransitionRoomStatus('AVAILABLE', 'AVAILABLE'));
check('BOOKED→CANCELLED', canTransitionReservation('BOOKED', 'CANCELLED'));
check('BOOKED→NO_SHOW', canTransitionReservation('BOOKED', 'NO_SHOW'));
check('BOOKED→CHECKED_IN refused here (check-in flow)', !canTransitionReservation('BOOKED', 'CHECKED_IN'));
check('CHECKED_IN→COMPLETED refused here (check-out flow)', !canTransitionReservation('CHECKED_IN', 'COMPLETED'));

console.log('5. Folio money');
const charges = [
  { kind: 'ROOM_NIGHT', amount: 8000, saleId: null },
  { kind: 'ROOM_NIGHT', amount: 8000, saleId: null },
  { kind: 'SERVICE', amount: 1500, saleId: 'sale-pos-1' }, // charged to room at the POS
  { kind: 'MANUAL', amount: 500, saleId: null },          // desk charge (laundry)
  { kind: 'SERVICE', amount: 1200, saleId: null }          // desk-added service (airport pickup)
];
const payments = [{ amount: 5000 }, { amount: 2000 }];
check('balance = 19200 − 7000 = 12200', folioBalance(charges, payments) === 12200);
const summary = summarizeFolioCharges(charges, payments);
check('total charges 19200', summary.totalCharges === 19200);
check('total payments 7000', summary.totalPayments === 7000);
check('summary balance 12200', summary.balance === 12200);
check('2 room nights posted', summary.roomNightCount === 2);
check('room-night total 16000', summary.roomNightTotal === 16000);
check('charged-to-room total 1500 (never re-billed)', summary.chargedToRoomTotal === 1500);
check('native total 17700 (the checkout invoice)', summary.nativeTotal === 17700);
check('empty folio balances to 0', folioBalance([], []) === 0);
check('advance-only folio is in credit', folioBalance([], [{ amount: 3000 }]) === -3000);

if (failures > 0) {
  console.error(`\nHotel self-check: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nHotel self-check: all checks passed');

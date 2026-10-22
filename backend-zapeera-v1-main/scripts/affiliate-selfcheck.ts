// Self-check for the Affiliate Program (src/utils/affiliate.util.ts).
// Run: npx ts-node --transpile-only scripts/affiliate-selfcheck.ts
// Exits non-zero on the first failed invariant.
//
// Cases:
//  1. Code generation — 8 chars from the unambiguous alphabet; a batch
//     of candidates is (overwhelmingly) unique; normalization strips the
//     ZAP- prefix, case and junk.
//  2. Rate resolution — override wins (including an explicit 0), null /
//     undefined / negative / NaN overrides fall back to the default.
//  3. Accrual math — percent-of-basis, half-up 2dp rounding edges,
//     zero/negative basis or rate accrue nothing.
//  4. Balance summary — VOID excluded; REQUESTED payouts reserve their
//     amount; REJECTED payouts free it back; PAID payouts settle.
//  5. Accrual dedupe — with a fake Prisma whose create throws P2002 on
//     a repeated sourceRef (what the UNIQUE index does), calling
//     accrueAffiliateCommission twice for the same money-in event
//     creates exactly ONE commission; a different event creates a
//     second. Also: no referral → no accrual; suspended affiliate →
//     no accrual; 20% of PKR 5,000 = 1,000 end to end.
import {
  accrueAffiliateCommission,
  computeCommissionAmount,
  generateAffiliateCodeCandidate,
  isPlausibleAffiliateCode,
  normalizeAffiliateCode,
  resolveCommissionRate,
  summarizeAffiliateBalance,
  AFFILIATE_CODE_ALPHABET,
  AFFILIATE_CODE_LENGTH
} from '../src/utils/affiliate.util';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('1. Code generation + normalization');
const codes = new Set<string>();
for (let i = 0; i < 500; i++) codes.add(generateAffiliateCodeCandidate());
check('500 candidates are unique', codes.size === 500, `got ${codes.size}`);
const sample = [...codes][0];
check('length is 8', sample.length === AFFILIATE_CODE_LENGTH);
check('alphabet only', [...sample].every((ch) => AFFILIATE_CODE_ALPHABET.includes(ch)));
check('normalize strips ZAP- prefix + case', normalizeAffiliateCode('zap-ab3f9k2q') === 'AB3F9K2Q');
check('normalize non-string → null', normalizeAffiliateCode(42) === null);
check('plausibility window', isPlausibleAffiliateCode('AB3F9K2Q') && !isPlausibleAffiliateCode('AB') && !isPlausibleAffiliateCode(null));

console.log('2. Rate resolution');
check('override wins', resolveCommissionRate(35, 20) === 35);
check('explicit 0 override wins', resolveCommissionRate(0, 20) === 0);
check('null → default', resolveCommissionRate(null, 20) === 20);
check('undefined → default', resolveCommissionRate(undefined, 20) === 20);
check('negative → default', resolveCommissionRate(-5, 20) === 20);
check('NaN → default', resolveCommissionRate(NaN, 20) === 20);

console.log('3. Accrual math');
check('20% of 5000 = 1000', computeCommissionAmount(5000, 20) === 1000);
check('20% of 2500 = 500', computeCommissionAmount(2500, 20) === 500);
check('33% of 999 = 329.67', computeCommissionAmount(999, 33) === 329.67);
check('half-up: 10% of 0.05 → 0.01', computeCommissionAmount(0.05, 10) === 0.01);
check('zero basis → 0', computeCommissionAmount(0, 20) === 0);
check('zero rate → 0', computeCommissionAmount(5000, 0) === 0);

console.log('4. Balance summary');
const summary = summarizeAffiliateBalance(
  [
    { amount: 1000, status: 'PENDING' },
    { amount: 500, status: 'APPROVED' },
    { amount: 2000, status: 'PAID' },
    { amount: 9999, status: 'VOID' }
  ],
  [
    { amount: 2000, status: 'PAID' },
    { amount: 700, status: 'REQUESTED' },
    { amount: 300, status: 'REJECTED' }
  ]
);
check('totalEarned excludes VOID', summary.totalEarned === 3500, `${summary.totalEarned}`);
check('pendingApproval', summary.pendingApproval === 1000);
check('approvedUnpaid', summary.approvedUnpaid === 500);
check('paidCommissions', summary.paidCommissions === 2000);
check('available = earned − paid − requested', summary.availableBalance === 800, `${summary.availableBalance}`);

// ── Fake Prisma honoring the UNIQUE(sourceRef) contract ────────────────
function makeFakePrisma(opts: { referral?: any }) {
  const commissions: any[] = [];
  const settingsRows: any[] = [];
  return {
    _commissions: commissions,
    settings: {
      findMany: async () => settingsRows
    },
    affiliateReferral: {
      findUnique: async () => opts.referral ?? null
    },
    affiliateCommission: {
      create: async ({ data }: any) => {
        if (commissions.some((c) => c.sourceRef === data.sourceRef)) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const row = { id: `c${commissions.length + 1}`, ...data };
        commissions.push(row);
        return row;
      }
    }
  };
}

async function main() {
  console.log('5. Accrual dedupe (fake Prisma, UNIQUE sourceRef)');
  const affiliate = { id: 'aff1', userId: 'u1', code: 'AB3F9K2Q', status: 'ACTIVE', commissionRate: null };
  const prisma = makeFakePrisma({ referral: { affiliateId: 'aff1', affiliate } });

  const first = await accrueAffiliateCommission(prisma, {
    businessId: 'biz1',
    sourceRef: 'payment_proof:proof1',
    basisAmount: 5000
  });
  check('first accrual created', first.created === true && first.amount === 1000 && first.rateApplied === 20, JSON.stringify(first));

  const replay = await accrueAffiliateCommission(prisma, {
    businessId: 'biz1',
    sourceRef: 'payment_proof:proof1',
    basisAmount: 5000
  });
  check('replayed sourceRef does NOT double-accrue', replay.created === false && replay.reason === 'DUPLICATE_SOURCE', JSON.stringify(replay));
  check('exactly one commission row exists', prisma._commissions.length === 1);

  const secondEvent = await accrueAffiliateCommission(prisma, {
    businessId: 'biz1',
    sourceRef: 'payment_proof:proof2',
    basisAmount: 2500
  });
  check('a different money-in event accrues again', secondEvent.created === true && prisma._commissions.length === 2);

  const noReferral = await accrueAffiliateCommission(makeFakePrisma({ referral: null }), {
    businessId: 'bizX',
    sourceRef: 'payment_proof:proof9',
    basisAmount: 5000
  });
  check('no referral → no accrual', noReferral.created === false && noReferral.reason === 'NO_REFERRAL');

  const suspended = await accrueAffiliateCommission(
    makeFakePrisma({ referral: { affiliateId: 'aff1', affiliate: { ...affiliate, status: 'SUSPENDED' } } }),
    { businessId: 'biz1', sourceRef: 'payment_proof:proof3', basisAmount: 5000 }
  );
  check('suspended affiliate → no accrual', suspended.created === false && suspended.reason === 'AFFILIATE_NOT_ACTIVE');

  const override = await accrueAffiliateCommission(
    makeFakePrisma({ referral: { affiliateId: 'aff1', affiliate: { ...affiliate, commissionRate: 30 } } }),
    { businessId: 'biz1', sourceRef: 'subscription_assign:sub1:2026-11-21', basisAmount: 10000 }
  );
  check('override rate applies (30% of 10000 = 3000)', override.created === true && override.amount === 3000 && override.rateApplied === 30);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

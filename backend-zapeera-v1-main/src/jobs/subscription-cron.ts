import { getPrisma } from '../utils/db.util';

const isLocalDev =
  process.env.NODE_ENV === 'development' &&
  process.env.SHORT_TRIAL_DURATIONS === 'true';

// Local dev: 2-minute grace; production: 3 days grace
const GRACE_DURATION_MS = isLocalDev ? 2 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;

async function runSubscriptionCron(): Promise<void> {
  try {
    const prisma = await getPrisma();
    const now = new Date();

    // 1. TRIAL → GRACE: trialEndsAt has passed and status is still TRIAL
    const trialExpiredRows = await prisma.businessSubscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { not: null, lt: now }
      },
      select: { id: true, businessId: true }
    });

    for (const row of trialExpiredRows) {
      const graceEndsAt = new Date(Date.now() + GRACE_DURATION_MS);
      await prisma.businessSubscription.update({
        where: { id: row.id },
        data: { status: 'GRACE', currentPeriodEnd: graceEndsAt, updatedAt: now }
      });
      console.log(`[SubscriptionCron] TRIAL→GRACE  business=${row.businessId}  graceEndsAt=${graceEndsAt.toISOString()}`);
    }

    // 2. GRACE → SUSPENDED: currentPeriodEnd (used as graceEndsAt) has passed and status is GRACE
    const graceExpiredRows = await prisma.businessSubscription.findMany({
      where: {
        status: 'GRACE',
        currentPeriodEnd: { not: null, lt: now }
      },
      select: { id: true, businessId: true }
    });

    for (const row of graceExpiredRows) {
      await prisma.businessSubscription.update({
        where: { id: row.id },
        data: { status: 'SUSPENDED', updatedAt: now }
      });
      console.log(`[SubscriptionCron] GRACE→SUSPENDED  business=${row.businessId}`);
    }

    if (trialExpiredRows.length === 0 && graceExpiredRows.length === 0) {
      return;
    }
    console.log(
      `[SubscriptionCron] ✅ Ran at ${now.toISOString()} | ` +
      `TRIAL→GRACE: ${trialExpiredRows.length} | GRACE→SUSPENDED: ${graceExpiredRows.length}`
    );
  } catch (err: any) {
    console.error('[SubscriptionCron] Error:', err.message);
  }
}

export function startSubscriptionCron(): void {
  const intervalMs = isLocalDev ? 60_000 : 5 * 60_000;

  runSubscriptionCron();
  setInterval(runSubscriptionCron, intervalMs);

  console.log(
    `[SubscriptionCron] Started (interval=${intervalMs / 1000}s, ` +
    `mode=${isLocalDev ? 'LOCAL-SHORT' : 'PRODUCTION'})`
  );
}

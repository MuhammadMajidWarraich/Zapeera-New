// Nightly stock reconciliation job (R7, 2026-10-26).
//
// Sweeps every active business on an hourly tick and runs the ledger
// reconciliation (services/stock-reconciliation.service.ts) when the
// business has had no run in the last 20 hours — the "nightly" cadence
// without a cron daemon (same setInterval pattern as
// jobs/subscription-cron.ts). A run never writes stock: it only records
// variances for the review UI. Manual runs go through
// POST /api/sync/reconciliations/run. The job never throws out of the
// tick — a failed business is logged and retried on the next tick.

import { getPrisma } from '../utils/db.util';
import { runReconciliation } from '../services/stock-reconciliation.service';

const TICK_MS = 60 * 60 * 1000; // hourly
const MIN_RUN_GAP_MS = 20 * 60 * 60 * 1000; // at most one run / 20h / business

async function runStockReconciliationCron(): Promise<void> {
  try {
    const prisma = await getPrisma();
    const businesses = await prisma.business.findMany({
      where: { isActive: true },
      select: { id: true }
    });
    for (const business of businesses) {
      try {
        const lastRun = await prisma.stockReconciliation.findFirst({
          where: { companyId: business.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        });
        if (lastRun && Date.now() - new Date(lastRun.createdAt).getTime() < MIN_RUN_GAP_MS) continue;
        const result = await runReconciliation(prisma, business.id, 'NIGHTLY');
        console.log(
          `[StockReconciliation] business=${business.id} checked=${result.batchesChecked} ` +
          `variances=${result.varianceCount} unverifiable=${result.unverifiableCount}`
        );
      } catch (err: any) {
        console.error(`[StockReconciliation] business=${business.id} failed:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[StockReconciliation] Error:', err.message);
  }
}

export function startStockReconciliationCron(): void {
  runStockReconciliationCron();
  setInterval(runStockReconciliationCron, TICK_MS);
  console.log('[StockReconciliation] Started (hourly tick, at most one run per business per 20h)');
}

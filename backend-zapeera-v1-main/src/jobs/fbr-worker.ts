// ─── FBR POS fiscal integration (Wave B7): queue worker ────────────────
// Mirrors jobs/subscription-cron.ts: a plain in-process interval, no
// new infrastructure. Every 30s it drains due FbrInvoiceQueue rows
// (services/fbr.service.ts). Sales also kick an immediate attempt at
// enqueue time, so in the healthy path the number lands within a
// second or two and this tick is only the retry/safety net — FBR
// being down never blocks the POS, rows simply wait here.

import { processDueFbrJobs } from '../services/fbr.service';

const TICK_MS = 30_000;
let running = false;

async function runFbrWorker(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await processDueFbrJobs();
  } catch (err: any) {
    console.error('[FBRWorker] Error:', err.message);
  } finally {
    running = false;
  }
}

export function startFbrWorker(): void {
  runFbrWorker();
  setInterval(runFbrWorker, TICK_MS);
  console.log(`[FBRWorker] Started (interval=${TICK_MS / 1000}s)`);
}

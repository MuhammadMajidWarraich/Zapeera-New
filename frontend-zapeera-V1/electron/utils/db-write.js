/**
 * db-write.js — throwing write wrapper for the embedded SQLite layer.
 *
 * WHY THIS EXISTS (2026-10-28): `run()` in services/database.service.js
 * NEVER throws — on SQL failure it logs and returns `false`. Every
 * multi-write handler in this codebase that wraps `run()` calls in
 * try/catch with a "compensating rollback" therefore has dead rollback
 * code: the catch can only fire on a JS exception (a bad query() result,
 * an explicit throw), never on the write failure it was written for.
 * A failed write mid-sequence would leave a half-applied operation
 * (half-moved transfer, half-posted stock-take, sale without its
 * controlled-register rows) and return success.
 *
 * `mustRun(run, sql, params)` throws on `false`, so the existing
 * try/catch + compensation in the ported routes actually fires. Use it
 * for every write inside a compensated sequence; single writes can
 * keep plain run() (the handler's 500 + lastDbError reporting covers
 * them). The detailed SQL error is already logged by run() itself.
 */
function mustRun(run, sql, params) {
  const ok = run(sql, params);
  if (ok === false) {
    throw new Error('Database write failed: ' + String(sql).substring(0, 120));
  }
  return ok;
}

module.exports = { mustRun };

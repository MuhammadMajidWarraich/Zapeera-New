/**
 * License Gate — the single place where the signed license meets the
 * legacy entitlement path (2026-10-28, Muhammad's decisions).
 *
 * SHADOW MODE (current): SHADOW_MODE = true. Every check evaluates the
 * stored license token AND the legacy verdict, LOGS both (including a
 * mismatch line when they disagree), and returns the LEGACY verdict —
 * nothing is denied by a license yet. This is the one-release shadow
 * run the audit prescribed before enforcement.
 *
 * ENFORCEMENT (later, one flip): set SHADOW_MODE = false. Then the
 * license verdict decides. At hard expiry the behaviour is
 * HARD_EXPIRY_MODE from license.service.js — 'READ_ONLY_EXPORT_ONLY'
 * by default (writes stop, reads + export/backup stay available).
 * Full lock is a one-word change of that constant, never the default.
 *
 * Write gating: gateWrite(action) is called at the top of the embedded
 * write paths (sale / purchase / refund creation). In shadow mode it
 * always allows (and logs what enforcement would have done); in
 * enforce mode it denies the BLOCKED_WRITE_ACTIONS when the license
 * does not entitle. Reads, exports and backups are never blocked by
 * this gate under READ_ONLY_EXPORT_ONLY.
 *
 * Mismatch hook: setMismatchHook(fn) registers a listener called on
 * every shadow mismatch ({ kind, licenseReason, legacyEntitled, ... });
 * the default listener logs to the console. Stats are kept in memory
 * (getShadowStats / resetShadowStats) for the deploy-phase review of
 * the shadow release — a high mismatch rate is the signal to stay in
 * shadow mode.
 *
 * The gate never throws: any failure inside evaluation degrades to the
 * legacy verdict with a log line (fail-open in shadow; in enforce mode
 * a license that cannot be evaluated is NOT entitled, except when the
 * public key is not configured yet — then the legacy path still
 * decides, because no real tokens exist before rollout step 3).
 */
const licenseService = require('./license.service');
const { planFor, planLimitsFor } = require('./plan-catalog');

/** Flip to false to enforce (only after a clean shadow release). */
const SHADOW_MODE = true;

/** Writes blocked at hard expiry under READ_ONLY_EXPORT_ONLY. */
const BLOCKED_WRITE_ACTIONS = [
  'sale.create',
  'invoice.create',
  'purchase.create',
  'refund.create',
  'stock.edit'
];

/** Reads / exports / backups — never blocked under READ_ONLY_EXPORT_ONLY. */
const ALLOWED_WHEN_EXPIRED_ACTIONS = [
  'read',
  'export',
  'backup'
];

const stats = {
  evaluated: 0,
  mismatches: 0,
  licenseDeniedLegacyEntitled: 0,
  licenseEntitledLegacyDenied: 0,
  reasons: {}
};

let mismatchHook = null;

function setMismatchHook(fn) {
  mismatchHook = typeof fn === 'function' ? fn : null;
}

function getShadowStats() {
  return JSON.parse(JSON.stringify(stats));
}

function resetShadowStats() {
  stats.evaluated = 0;
  stats.mismatches = 0;
  stats.licenseDeniedLegacyEntitled = 0;
  stats.licenseEntitledLegacyDenied = 0;
  stats.reasons = {};
}

function logLicenseEvent(line) {
  console.log(`[License][${SHADOW_MODE ? 'shadow' : 'enforce'}] ${line}`);
}

/**
 * Evaluate the license for one entitlement check.
 * @param {object} args
 *   token: stored license token (may be null)
 *   legacyEntitled: the legacy path's verdict (membership rows)
 *   legacyPlanId: the legacy path's plan (for the mismatch log)
 *   deviceId, installId, businessId, stateDir, publicKeyPem, publicKeys
 * @returns {{ entitled: boolean, mode: string, reason: string,
 *   licenseEntitled: boolean|null, licenseReason: string,
 *   licensePlanId: string|null, legacyEntitled: boolean,
 *   mismatch: boolean, hardExpiryMode: string, warnings: string[],
 *   inGrace: boolean }}
 */
function checkEntitlement(args = {}) {
  const { token, legacyEntitled, legacyPlanId } = args;
  const verdict = licenseService.evaluate(token, {
    deviceId: args.deviceId,
    installId: args.installId,
    businessId: args.businessId,
    stateDir: args.stateDir,
    publicKeyPem: args.publicKeyPem,
    publicKeys: args.publicKeys,
    enforceBinding: true
  });

  stats.evaluated += 1;
  stats.reasons[verdict.reason] = (stats.reasons[verdict.reason] || 0) + 1;

  const licensePlanId = verdict.payload ? verdict.payload.planId || null : null;
  const mismatch = Boolean(verdict.configured && verdict.valid !== false)
    ? (verdict.entitled !== Boolean(legacyEntitled))
    : false;

  if (verdict.configured && mismatch) {
    stats.mismatches += 1;
    if (!verdict.entitled && legacyEntitled) stats.licenseDeniedLegacyEntitled += 1;
    if (verdict.entitled && !legacyEntitled) stats.licenseEntitledLegacyDenied += 1;
    const event = {
      kind: 'mismatch',
      businessId: args.businessId || null,
      licenseEntitled: verdict.entitled,
      licenseReason: verdict.reason,
      licensePlanId,
      legacyEntitled: Boolean(legacyEntitled),
      legacyPlanId: legacyPlanId || null,
      warnings: verdict.warnings
    };
    logLicenseEvent(`MISMATCH ${JSON.stringify(event)}`);
    if (mismatchHook) {
      try { mismatchHook(event); } catch (e) { /* never break the gate */ }
    }
  } else if (verdict.configured) {
    logLicenseEvent(`verdict business=${args.businessId || '-'} license=${verdict.entitled ? 'entitled' : 'denied'}(${verdict.reason}) legacy=${legacyEntitled ? 'entitled' : 'denied'} plan=${licensePlanId || '-'}`);
  } else {
    logLicenseEvent(`unconfigured (${verdict.reason}) business=${args.businessId || '-'} legacy=${legacyEntitled ? 'entitled' : 'denied'}`);
  }

  if (SHADOW_MODE) {
    return {
      entitled: Boolean(legacyEntitled),
      mode: 'shadow',
      reason: verdict.reason,
      licenseEntitled: verdict.configured ? verdict.entitled : null,
      licenseReason: verdict.reason,
      licensePlanId,
      legacyEntitled: Boolean(legacyEntitled),
      mismatch,
      hardExpiryMode: verdict.hardExpiryMode,
      warnings: verdict.warnings,
      inGrace: verdict.inGrace
    };
  }

  // Enforce mode: the license decides — except while the public key is
  // not configured (no real tokens exist yet), when the legacy path
  // still decides so a key-less build never bricks a paying customer.
  const entitled = verdict.configured ? verdict.entitled : Boolean(legacyEntitled);
  return {
    entitled,
    mode: 'enforce',
    reason: verdict.reason,
    licenseEntitled: verdict.configured ? verdict.entitled : null,
    licenseReason: verdict.reason,
    licensePlanId,
    legacyEntitled: Boolean(legacyEntitled),
    mismatch,
    hardExpiryMode: verdict.hardExpiryMode,
    warnings: verdict.warnings,
    inGrace: verdict.inGrace
  };
}

/**
 * Gate a write action (sale / purchase / refund creation, stock edits).
 * In shadow mode always allows, logging what enforcement would do.
 * In enforce mode denies BLOCKED_WRITE_ACTIONS when the license does
 * not entitle under READ_ONLY_EXPORT_ONLY; under FULL_LOCK denies every
 * action except read/export/backup (the UI's read-only banner is a
 * separate step — this gate is the server-side backstop).
 * @param {string} action e.g. 'sale.create'
 * @param {object} check result of checkEntitlement()
 * @returns {{ allowed: boolean, reason: string }}
 */
function gateWrite(action, check) {
  const mode = check && check.mode ? check.mode : (SHADOW_MODE ? 'shadow' : 'enforce');
  if (mode === 'shadow') {
    if (check && check.licenseEntitled === false) {
      logLicenseEvent(`write ${action} would be BLOCKED under enforcement (license: ${check.licenseReason}); allowed in shadow mode`);
    }
    return { allowed: true, reason: 'shadow-mode' };
  }
  if (check && check.entitled) return { allowed: true, reason: 'ok' };
  if (check && check.hardExpiryMode === 'FULL_LOCK') {
    if (ALLOWED_WHEN_EXPIRED_ACTIONS.includes(action)) return { allowed: true, reason: 'full-lock-read-only' };
    return { allowed: false, reason: check.licenseReason || 'license-not-entitled' };
  }
  // READ_ONLY_EXPORT_ONLY: only the listed write actions are blocked.
  if (BLOCKED_WRITE_ACTIONS.includes(action)) {
    return { allowed: false, reason: check ? (check.licenseReason || 'license-not-entitled') : 'license-not-entitled' };
  }
  return { allowed: true, reason: 'read-only-mode-allows' };
}

/**
 * Plan → limits mapping driven by the LICENSE payload's planId (the
 * server is the authority for which plan the token carries). Falls back
 * to the legacy planId when no license plan exists (shadow mode / no
 * token yet). A token carrying an unknown planId maps to null limits —
 * never to a silent default.
 */
function resolvePlanLimits(check, legacyPlanId) {
  const planId = (check && check.licensePlanId) || legacyPlanId || null;
  return {
    planId,
    plan: planFor(planId),
    limits: planLimitsFor(planId)
  };
}

/**
 * One-call write gate for the embedded write paths (sale / purchase /
 * refund creation). Reads the stored token, evaluates it with full
 * fail-closed binding, runs gateWrite, and returns the decision.
 * `legacyEntitled` defaults to true: the write already passed every
 * existing check, so the shadow comparison is "what would the license
 * have said about this write". Never throws: on an unexpected error it
 * fails OPEN in shadow mode (log loudly) and CLOSED in enforce mode.
 */
function checkWriteAllowed(action, opts = {}) {
  try {
    const licenseClient = require('./license-client');
    const token = opts.token !== undefined ? opts.token : licenseClient.getStoredToken();
    const check = checkEntitlement({
      token,
      legacyEntitled: opts.legacyEntitled !== undefined ? opts.legacyEntitled : true,
      legacyPlanId: opts.legacyPlanId || null,
      businessId: opts.businessId || null,
      deviceId: opts.deviceId || licenseClient.getDeviceId(),
      installId: opts.installId || licenseClient.getInstallId(),
      stateDir: opts.stateDir,
      publicKeyPem: opts.publicKeyPem,
      publicKeys: opts.publicKeys
    });
    const gate = gateWrite(action, check);
    return { allowed: gate.allowed, reason: gate.reason, check };
  } catch (e) {
    console.error(`[License] write-gate error for ${action}:`, e.message);
    if (SHADOW_MODE) return { allowed: true, reason: 'gate-error-fail-open-shadow', check: null };
    return { allowed: false, reason: 'gate-error', check: null };
  }
}

module.exports = {
  SHADOW_MODE,
  BLOCKED_WRITE_ACTIONS,
  ALLOWED_WHEN_EXPIRED_ACTIONS,
  checkEntitlement,
  gateWrite,
  checkWriteAllowed,
  resolvePlanLimits,
  setMismatchHook,
  getShadowStats,
  resetShadowStats
};

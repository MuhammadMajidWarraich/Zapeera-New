// Service-charge math (v1.0.22) — pure, so the rules can be verified
// on fixtures without a database (tests/v1022-calculations.test.ts).
//
// DEFINITIONS (kept in lockstep with sale.controller.ts):
//   · The charge is computed on the POST-DISCOUNT base — the same base
//     tax uses (subtotal − sale discount − promotion discount −
//     loyalty discount). It is added to the total AFTER tax, and tax
//     is never computed on it, so taxAmount / SaleTaxLine rows (and
//     therefore FBR payloads) stay byte-identical with or without it.
//   · PERCENT takes `percentage` of the base; FIXED takes
//     `fixedAmount`. The amount is ALWAYS computed server-side from
//     the stored config — a client may only toggle the charge on/off
//     for one sale, never send an amount (same rule as promotions).
//   · applyByDefault + no opt-out → applied. applyByDefault off →
//     applied only when the sale explicitly opts in. optOut always
//     wins. A missing/disabled config → no charge, ever.

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export type ServiceChargeType = 'PERCENT' | 'FIXED';

export interface ServiceChargeConfigInput {
  enabled: boolean;
  chargeType: string;
  percentage?: number | null;
  fixedAmount?: number | null;
  applyByDefault: boolean;
}

export interface ServiceChargeRequest {
  /** Explicit per-sale opt-in (used when the config does not auto-apply). */
  applied?: boolean;
  /** Explicit per-sale opt-out (always wins over the config). */
  optOut?: boolean;
}

export interface ServiceChargeResult {
  amount: number;
  type: ServiceChargeType | null;
  percentage: number | null;
}

const NO_CHARGE: ServiceChargeResult = { amount: 0, type: null, percentage: null };

export function computeServiceCharge(
  base: number,
  config: ServiceChargeConfigInput | null | undefined,
  request: ServiceChargeRequest = {}
): ServiceChargeResult {
  if (!config || !config.enabled) return NO_CHARGE;
  if (request.optOut) return NO_CHARGE;
  if (!config.applyByDefault && !request.applied) return NO_CHARGE;

  const safeBase = Math.max(0, Number(base) || 0);
  if (config.chargeType === 'FIXED') {
    const fixed = Number(config.fixedAmount) || 0;
    if (fixed <= 0) return NO_CHARGE;
    return { amount: round2(fixed), type: 'FIXED', percentage: null };
  }
  // PERCENT (any unknown chargeType falls through to no charge — a
  // misconfigured rule must never invent a charge).
  if (config.chargeType !== 'PERCENT') return NO_CHARGE;
  const pct = Number(config.percentage) || 0;
  if (pct <= 0) return NO_CHARGE;
  return { amount: round2((safeBase * pct) / 100), type: 'PERCENT', percentage: pct };
}

/**
 * Resolve the effective config for a scope: the branch row wins, else
 * the business-wide row (branchId null), else null. Rows are the raw
 * ServiceChargeConfig rows for the company.
 */
export function resolveServiceChargeConfig<T extends { branchId: string | null }>(
  configs: T[],
  branchId: string | null | undefined
): T | null {
  if (!configs || configs.length === 0) return null;
  if (branchId) {
    const branchRow = configs.find((c) => c.branchId === branchId);
    if (branchRow) return branchRow;
  }
  return configs.find((c) => c.branchId === null) || null;
}

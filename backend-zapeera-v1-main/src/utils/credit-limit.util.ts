// ─── Customer credit limits (gap item 7) ────────────────────────────
// Shared by POS sale-create and the manual khata ADJUSTMENT endpoint so
// both enforce the same rule the same way.
//
// Rule: Customer.creditLimit (nullable) is the maximum outstanding
// udhaar a customer may carry. Null = no limit — the historical
// behaviour, unchanged. The balance is the SUM of the customer's
// CustomerLedgerEntry rows (never stored) — see the schema comment on
// CustomerLedgerEntry. A new charge is allowed only while
//   balance + additionalDue <= creditLimit
// Otherwise the caller must block (HTTP 402 CREDIT_LIMIT_EXCEEDED)
// unless the request carries an explicit owner/manager override flag —
// over-limit credit is never granted silently.
//
// The helpers take a Prisma client OR a transaction client (`tx`):
// sale-create calls them inside its $transaction so the balance read
// and the SALE_DUE write are atomic.

export const CREDIT_LIMIT_EXCEEDED = 'CREDIT_LIMIT_EXCEEDED';

// Roles allowed to explicitly override a credit limit. Same vocabulary
// the khata adjustment guard uses (OWNER / MANAGER / ADMIN).
export const CREDIT_LIMIT_OVERRIDE_ROLES = ['OWNER', 'MANAGER', 'ADMIN'] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

// The customer's current outstanding khata balance (SUM of ledger rows).
export const getCustomerKhataBalance = async (
  client: any,
  customerId: string,
  companyId: string
): Promise<number> => {
  const agg = await client.customerLedgerEntry.aggregate({
    where: { customerId, companyId },
    _sum: { amount: true }
  });
  return round2(agg._sum.amount || 0);
};

// The customer's credit limit, or null when none is set (unlimited).
export const getCustomerCreditLimit = async (
  client: any,
  customerId: string,
  companyId: string
): Promise<number | null> => {
  const customer = await client.customer.findFirst({
    where: { id: customerId, companyId },
    select: { creditLimit: true }
  });
  if (!customer) return null;
  const limit = customer.creditLimit;
  return typeof limit === 'number' && limit >= 0 ? limit : null;
};

export interface CreditLimitCheck {
  // True when the charge fits the limit (or no limit is set).
  allowed: boolean;
  // Current outstanding balance before this charge.
  balance: number;
  // The limit, or null when none is set.
  creditLimit: number | null;
  // balance + additionalDue — what the customer would owe after.
  projectedBalance: number;
  // How far over the limit the charge would go (0 when allowed).
  overBy: number;
}

// Checks whether charging `additionalDue` more udhaar to the customer
// stays within their credit limit. Returns null when the customer has
// no limit set (or does not exist) — the caller then proceeds exactly
// as before, with no behaviour change.
export const checkCreditLimit = async (
  client: any,
  customerId: string,
  companyId: string,
  additionalDue: number
): Promise<CreditLimitCheck | null> => {
  const creditLimit = await getCustomerCreditLimit(client, customerId, companyId);
  if (creditLimit === null) return null;
  const balance = await getCustomerKhataBalance(client, customerId, companyId);
  const projectedBalance = round2(balance + additionalDue);
  const overBy = round2(Math.max(0, projectedBalance - creditLimit));
  return {
    allowed: projectedBalance <= creditLimit,
    balance,
    creditLimit,
    projectedBalance,
    overBy
  };
};

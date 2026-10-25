import '../config/database.init';
// NOTE (Item 8): the sandbox cannot regenerate the Prisma client —
// `node scripts/generate-client.js postgresql` fails with ECONNRESET
// (the Prisma CLI's own fetch is reset at the egress proxy; curl to
// binaries.prisma.sh through the same proxy works, so this is a
// CLI-fetch limitation, not a schema problem). The committed schemas
// are the source of truth (scripts/check-schema-sync.js GREEN) and
// the deploy pipeline regenerates the client via `npm run setup:web`.
// Until that regeneration lands, the four NEW delegates are accessed
// through `db` (typed any) so `tsc --noEmit` passes against the
// currently generated (pre-Item-8) client. Existing delegates keep
// their generated types. Remove the casts after regenerating.
import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import { round2 } from '../utils/accounting.util';
import {
  autoMatchLines,
  summarizeReconciliation,
  parseStatementCsv,
  LedgerCandidate,
  LedgerKind,
} from '../utils/reconciliation.util';

// Bank reconciliation (Wave B — Item 8): accounts, statements, matching
// and per-period reconciliation state. Matching links a statement line
// to a ledger row that already exists (sale payment, expense, refund,
// khata payment) — it never creates or edits ledger rows, and it never
// touches FBR invoicing, FEFO, khata balances or offline sync.
//
// Sign convention (bank perspective): + money in, − money out.
//   SalePayment (bank-settled tender) → +amount
//   Khata PAYMENT (customer settled a due) → +|amount|
//   Expense (bank/cheque/card) → −amount
//   Refund (bank tender) → −refundAmount
//
// Amount equality to the cent is the anchor: a manual match whose
// amounts differ is rejected (400), and the auto-matcher only scores
// equal-amount pairs. A ledger row can be matched to at most one
// statement line, company-wide — a duplicated bank line can never
// silently consume the same sale twice.

/** Tender methods that settle through a bank account / wallet. */
const BANK_SETTLED_METHODS = ['BANK_TRANSFER', 'CARD', 'JAZZCASH', 'EASYPAISA', 'MOBILE'];
/** Expense payment methods that clear through the bank. */
const EXPENSE_BANK_METHODS = ['BANK_TRANSFER', 'CARD', 'CHEQUE'];

const LEDGER_KINDS: LedgerKind[] = ['SALE_PAYMENT', 'EXPENSE', 'REFUND', 'KHATA_PAYMENT'];

function parseDateStart(dateLike: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLike);
  if (m) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0, 0);
  }
  return new Date(dateLike);
}
function parseDateEnd(dateLike: string): Date {
  const d = parseDateStart(dateLike);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Tenant scope: company is mandatory for writes; branch is the effective branch when set. */
function resolveScope(req: AuthRequest): { companyId: string; branchId?: string } {
  const scope = buildBranchWhereClause(req, {});
  const companyId = scope.companyId as string;
  const branchId = (req.query.branchId as string) || (scope.branchId as string) || undefined;
  return { companyId, branchId };
}

function hasCompany(scope: { companyId: string }): boolean {
  return !!scope.companyId && scope.companyId !== 'no-business-context';
}

async function loadAccount(prisma: any, scope: { companyId: string; branchId?: string }, accountId: string) {
  const db: any = prisma;
  const account = await db.bankAccount.findUnique({
    where: { id: accountId },
    include: { branch: { select: { id: true, name: true } } },
  });
  if (!account || account.companyId !== scope.companyId) return null;
  if (scope.branchId && account.branchId && account.branchId !== scope.branchId) return null;
  return account;
}

async function loadStatement(prisma: any, scope: { companyId: string; branchId?: string }, statementId: string) {
  const db: any = prisma;
  const statement = await db.bankStatement.findUnique({
    where: { id: statementId },
    include: {
      bankAccount: { select: { id: true, name: true, bankName: true } },
      lines: { orderBy: [{ txnDate: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!statement || statement.companyId !== scope.companyId) return null;
  if (scope.branchId && statement.branchId && statement.branchId !== scope.branchId) return null;
  return statement;
}

function reconSummaryFor(statement: any) {
  return summarizeReconciliation({
    statementOpening: statement.openingBalance || 0,
    statementClosing: statement.closingBalance || 0,
    lines: (statement.lines || []).map((l: any) => ({ status: l.status, amount: l.amount || 0 })),
  });
}

/** Ledger rows already consumed by a MATCHED line anywhere in the company. */
async function matchedLedgerKeys(prisma: any, companyId: string): Promise<Set<string>> {
  const db: any = prisma;
  const rows = await db.bankStatementLine.findMany({
    where: {
      status: 'MATCHED',
      matchedLedgerId: { not: null },
      statement: { companyId },
    },
    select: { matchedLedgerKind: true, matchedLedgerId: true },
  });
  return new Set(rows.map((r: any) => `${r.matchedLedgerKind}::${r.matchedLedgerId}`));
}

/** Fetch matchable ledger rows (bank perspective) in a date window. */
async function fetchCandidates(
  prisma: any,
  scope: { companyId: string; branchId?: string },
  from: Date,
  to: Date
): Promise<LedgerCandidate[]> {
  const saleWhere: any = { createdAt: { gte: from, lte: to }, method: { in: BANK_SETTLED_METHODS } };
  const khataWhere: any = {
    type: 'PAYMENT',
    createdAt: { gte: from, lte: to },
    method: { in: BANK_SETTLED_METHODS },
    companyId: scope.companyId,
  };
  const expenseWhere: any = {
    expenseDate: { gte: from, lte: to },
    paymentMethod: { in: EXPENSE_BANK_METHODS },
    companyId: scope.companyId,
  };
  const refundWhere: any = {
    createdAt: { gte: from, lte: to },
    refundMethod: { in: BANK_SETTLED_METHODS },
  };
  if (scope.companyId) {
    saleWhere.sale = { companyId: scope.companyId };
    refundWhere.originalSale = { companyId: scope.companyId };
  }
  if (scope.branchId) {
    saleWhere.sale = { ...(saleWhere.sale || {}), branchId: scope.branchId };
    refundWhere.originalSale = { ...(refundWhere.originalSale || {}), branchId: scope.branchId };
    expenseWhere.branchId = scope.branchId;
    khataWhere.customer = { branchId: scope.branchId };
  }

  const [salePayments, expenses, refunds, khataPayments] = await Promise.all([
    prisma.salePayment.findMany({
      where: saleWhere,
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        createdAt: true,
        sale: { select: { invoiceNumber: true } },
      },
    }),
    prisma.expense.findMany({
      where: expenseWhere,
      select: { id: true, amount: true, title: true, reference: true, expenseDate: true },
    }),
    prisma.refund.findMany({
      where: refundWhere,
      select: {
        id: true,
        refundAmount: true,
        refundReference: true,
        createdAt: true,
        originalSale: { select: { invoiceNumber: true } },
      },
    }),
    prisma.customerLedgerEntry.findMany({
      where: khataWhere,
      select: { id: true, amount: true, method: true, reference: true, createdAt: true, customerId: true },
    }),
  ]);

  const candidates: LedgerCandidate[] = [];
  for (const p of salePayments as any[]) {
    candidates.push({
      kind: 'SALE_PAYMENT',
      id: p.id,
      amount: round2(p.amount || 0),
      date: p.createdAt,
      reference: p.reference || null,
      description: `Sale ${p.sale?.invoiceNumber || ''} via ${p.method}`.trim(),
    });
  }
  for (const e of expenses as any[]) {
    candidates.push({
      kind: 'EXPENSE',
      id: e.id,
      amount: round2(-(e.amount || 0)),
      date: e.expenseDate,
      reference: e.reference || null,
      description: e.title || 'Expense',
    });
  }
  for (const r of refunds as any[]) {
    candidates.push({
      kind: 'REFUND',
      id: r.id,
      amount: round2(-(r.refundAmount || 0)),
      date: r.createdAt,
      reference: r.refundReference || null,
      description: `Refund for sale ${r.originalSale?.invoiceNumber || ''}`.trim(),
    });
  }
  for (const k of khataPayments as any[]) {
    candidates.push({
      kind: 'KHATA_PAYMENT',
      id: k.id,
      amount: round2(Math.abs(k.amount || 0)),
      date: k.createdAt,
      reference: k.reference || null,
      description: `Khata payment via ${k.method || ''}`.trim(),
    });
  }
  return candidates;
}

/** Resolve one ledger row for a manual match, with its bank-perspective amount. */
async function resolveLedgerRow(
  prisma: any,
  scope: { companyId: string; branchId?: string },
  kind: LedgerKind,
  ledgerId: string
): Promise<{ amount: number; description: string } | null> {
  if (kind === 'SALE_PAYMENT') {
    const row = await prisma.salePayment.findUnique({
      where: { id: ledgerId },
      include: { sale: { select: { companyId: true, branchId: true, invoiceNumber: true } } },
    });
    if (!row || row.sale?.companyId !== scope.companyId) return null;
    if (scope.branchId && row.sale.branchId !== scope.branchId) return null;
    if (!BANK_SETTLED_METHODS.includes(row.method)) return null;
    return { amount: round2(row.amount || 0), description: `Sale ${row.sale.invoiceNumber || ''}`.trim() };
  }
  if (kind === 'EXPENSE') {
    const row = await prisma.expense.findUnique({ where: { id: ledgerId } });
    if (!row || row.companyId !== scope.companyId) return null;
    if (scope.branchId && row.branchId && row.branchId !== scope.branchId) return null;
    if (!EXPENSE_BANK_METHODS.includes(row.paymentMethod)) return null;
    return { amount: round2(-(row.amount || 0)), description: row.title || 'Expense' };
  }
  if (kind === 'REFUND') {
    const row = await prisma.refund.findUnique({
      where: { id: ledgerId },
      include: { originalSale: { select: { companyId: true, branchId: true, invoiceNumber: true } } },
    });
    if (!row || row.originalSale?.companyId !== scope.companyId) return null;
    if (scope.branchId && row.originalSale.branchId !== scope.branchId) return null;
    if (!row.refundMethod || !BANK_SETTLED_METHODS.includes(row.refundMethod)) return null;
    return { amount: round2(-(row.refundAmount || 0)), description: `Refund for sale ${row.originalSale.invoiceNumber || ''}`.trim() };
  }
  const row = await prisma.customerLedgerEntry.findUnique({
    where: { id: ledgerId },
    include: { customer: { select: { branchId: true } } },
  });
  if (!row || row.companyId !== scope.companyId || row.type !== 'PAYMENT') return null;
  if (scope.branchId && row.customer?.branchId !== scope.branchId) return null;
  if (!row.method || !BANK_SETTLED_METHODS.includes(row.method)) return null;
  return { amount: round2(Math.abs(row.amount || 0)), description: `Khata payment via ${row.method}`.trim() };
}

// ─── GET /reports/accounting/bank-accounts ───────────────────────────

export const listBankAccounts = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const where: any = { companyId: scope.companyId };
    if (scope.branchId) where.branchId = scope.branchId;
    if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';
    const accounts = await db.bankAccount.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        branch: { select: { id: true, name: true } },
        _count: { select: { statements: true, reconciliations: true } },
      },
    });
    return res.json({ success: true, data: accounts });
  } catch (error: any) {
    console.error('List bank accounts error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/bank-accounts ──────────────────────────

export const createBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const { name, bankName, accountNumber, accountType, openingBalance, branchId } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    if (accountType && !['CURRENT', 'SAVINGS', 'WALLET'].includes(accountType)) {
      return res.status(400).json({ success: false, message: 'accountType must be CURRENT, SAVINGS or WALLET' });
    }
    const effectiveBranchId = branchId || scope.branchId || null;
    if (effectiveBranchId) {
      const branch = await prisma.branch.findUnique({ where: { id: effectiveBranchId } });
      if (!branch || branch.companyId !== scope.companyId) {
        return res.status(400).json({ success: false, message: 'branchId does not belong to this business' });
      }
    }
    const account = await db.bankAccount.create({
      data: {
        companyId: scope.companyId,
        branchId: effectiveBranchId,
        name: name.trim(),
        bankName: bankName?.trim() || null,
        accountNumber: accountNumber?.trim() || null,
        accountType: accountType || 'CURRENT',
        openingBalance: Number(openingBalance || 0),
        createdBy: (req as any).user?.id || null,
      },
    });
    return res.status(201).json({ success: true, data: account });
  } catch (error: any) {
    console.error('Create bank account error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── PATCH /reports/accounting/bank-accounts/:id ─────────────────────

export const updateBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const account = await loadAccount(prisma, scope, req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Bank account not found' });
    const { name, bankName, accountNumber, accountType, isActive } = req.body || {};
    if (accountType && !['CURRENT', 'SAVINGS', 'WALLET'].includes(accountType)) {
      return res.status(400).json({ success: false, message: 'accountType must be CURRENT, SAVINGS or WALLET' });
    }
    const updated = await db.bankAccount.update({
      where: { id: account.id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(bankName !== undefined ? { bankName: bankName?.trim() || null } : {}),
        ...(accountNumber !== undefined ? { accountNumber: accountNumber?.trim() || null } : {}),
        ...(accountType !== undefined ? { accountType } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Update bank account error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/accounting/statements ──────────────────────────────

export const listStatements = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const where: any = { companyId: scope.companyId };
    if (req.query.bankAccountId) where.bankAccountId = req.query.bankAccountId;
    if (scope.branchId) where.branchId = scope.branchId;
    if (req.query.status) where.status = req.query.status;
    const statements = await db.bankStatement.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      include: {
        bankAccount: { select: { id: true, name: true, bankName: true } },
        lines: { select: { id: true, status: true, amount: true } },
      },
    });
    const data = statements.map((s: any) => {
      const summary = summarizeReconciliation({
        statementOpening: s.openingBalance || 0,
        statementClosing: s.closingBalance || 0,
        lines: s.lines,
      });
      const { lines, ...rest } = s;
      return { ...rest, lineCount: lines.length, summary };
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('List statements error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/statements ─────────────────────────────

export const createStatement = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const { bankAccountId, periodStart, periodEnd, openingBalance, closingBalance, source, fileName, lines, csvText } = req.body || {};
    if (!bankAccountId || !periodStart || !periodEnd) {
      return res.status(400).json({ success: false, message: 'bankAccountId, periodStart and periodEnd are required' });
    }
    const account = await loadAccount(prisma, scope, bankAccountId);
    if (!account) return res.status(404).json({ success: false, message: 'Bank account not found' });

    let parsedLines: Array<{ txnDate: string; description: string; reference: string | null; amount: number }> = [];
    if (csvText) {
      const parsed = parseStatementCsv(String(csvText));
      if (parsed.errors.length > 0) {
        return res.status(400).json({ success: false, message: 'CSV has unparseable rows', errors: parsed.errors });
      }
      parsedLines = parsed.lines.map((l) => ({ txnDate: l.date, description: l.description, reference: l.reference, amount: l.amount }));
    } else if (Array.isArray(lines)) {
      for (const [i, l] of lines.entries()) {
        if (!l || !l.txnDate || !l.description || l.amount === undefined || l.amount === null || Number.isNaN(Number(l.amount))) {
          return res.status(400).json({ success: false, message: `lines[${i}] needs txnDate, description and a numeric amount` });
        }
        parsedLines.push({
          txnDate: l.txnDate,
          description: String(l.description),
          reference: l.reference ? String(l.reference) : null,
          amount: round2(Number(l.amount)),
        });
      }
    }
    if (parsedLines.length === 0) {
      return res.status(400).json({ success: false, message: 'A statement needs at least one line (lines[] or csvText)' });
    }

    const statement = await db.bankStatement.create({
      data: {
        bankAccountId: account.id,
        companyId: scope.companyId,
        branchId: account.branchId || scope.branchId || null,
        periodStart: parseDateStart(periodStart),
        periodEnd: parseDateEnd(periodEnd),
        openingBalance: Number(openingBalance || 0),
        closingBalance: Number(closingBalance || 0),
        source: csvText ? 'CSV_IMPORT' : source === 'CSV_IMPORT' ? 'CSV_IMPORT' : 'MANUAL',
        fileName: fileName || null,
        status: 'OPEN',
        createdBy: (req as any).user?.id || null,
        lines: { create: parsedLines.map((l) => ({ ...l, txnDate: parseDateStart(l.txnDate), status: 'UNMATCHED' })) },
      },
      include: { lines: { orderBy: [{ txnDate: 'asc' }, { id: 'asc' }] } },
    });
    return res.status(201).json({ success: true, data: statement });
  } catch (error: any) {
    console.error('Create statement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/accounting/statements/:id ──────────────────────────

export const getStatement = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const statement = await loadStatement(prisma, scope, req.params.id);
    if (!statement) return res.status(404).json({ success: false, message: 'Statement not found' });
    return res.json({ success: true, data: { ...statement, summary: reconSummaryFor(statement) } });
  } catch (error: any) {
    console.error('Get statement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/statements/:id/auto-match ──────────────

export const autoMatchStatement = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const statement = await loadStatement(prisma, scope, req.params.id);
    if (!statement) return res.status(404).json({ success: false, message: 'Statement not found' });

    const unmatched = (statement.lines || []).filter((l: any) => l.status === 'UNMATCHED');
    if (unmatched.length === 0) {
      return res.json({ success: true, data: { matched: [], unmatchedLineIds: [], summary: reconSummaryFor(statement) } });
    }

    // ±7 days around the statement period: a bank line can clear a few
    // days after the ledger date (and vice versa).
    const windowStart = new Date(statement.periodStart);
    windowStart.setDate(windowStart.getDate() - 7);
    const windowEnd = new Date(statement.periodEnd);
    windowEnd.setDate(windowEnd.getDate() + 7);
    windowEnd.setHours(23, 59, 59, 999);

    const [candidates, alreadyMatched] = await Promise.all([
      fetchCandidates(prisma, scope, windowStart, windowEnd),
      matchedLedgerKeys(prisma, scope.companyId),
    ]);
    const free = candidates.filter((c) => !alreadyMatched.has(`${c.kind}::${c.id}`));
    const result = autoMatchLines(
      unmatched.map((l: any) => ({ id: l.id, amount: l.amount, date: l.txnDate, reference: l.reference, description: l.description })),
      free
    );

    if (result.matches.length > 0) {
      await prisma.$transaction(
        result.matches.map((m) =>
          db.bankStatementLine.update({
            where: { id: m.lineId },
            data: {
              status: 'MATCHED',
              matchedLedgerKind: m.candidateKind,
              matchedLedgerId: m.candidateId,
              matchConfidence: m.confidence,
              matchMethod: m.method,
            },
          })
        )
      );
    }

    const refreshed = await loadStatement(prisma, scope, req.params.id);
    return res.json({
      success: true,
      data: {
        matched: result.matches,
        unmatchedLineIds: result.unmatchedLineIds,
        summary: reconSummaryFor(refreshed),
      },
    });
  } catch (error: any) {
    console.error('Auto-match statement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/statements/:id/lines/:lineId/match ─────

export const matchStatementLine = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const statement = await loadStatement(prisma, scope, req.params.id);
    if (!statement) return res.status(404).json({ success: false, message: 'Statement not found' });
    const line = (statement.lines || []).find((l: any) => l.id === req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Statement line not found' });

    const { kind, ledgerId, notes } = req.body || {};
    if (!kind || !LEDGER_KINDS.includes(kind) || !ledgerId) {
      return res.status(400).json({ success: false, message: 'kind (SALE_PAYMENT | EXPENSE | REFUND | KHATA_PAYMENT) and ledgerId are required' });
    }
    const ledger = await resolveLedgerRow(prisma, scope, kind, ledgerId);
    if (!ledger) return res.status(404).json({ success: false, message: 'Ledger entry not found, out of scope, or not a bank-settled tender' });
    if (round2(Number(line.amount || 0)) !== round2(ledger.amount)) {
      return res.status(400).json({
        success: false,
        message: `Amount mismatch: statement line is ${line.amount} but the ledger entry is ${ledger.amount}. A match must be to the cent.`,
      });
    }
    const alreadyMatched = await matchedLedgerKeys(prisma, scope.companyId);
    if (line.status !== 'MATCHED' && alreadyMatched.has(`${kind}::${ledgerId}`)) {
      return res.status(409).json({ success: false, message: 'That ledger entry is already matched to another statement line' });
    }

    const updated = await db.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'MATCHED',
        matchedLedgerKind: kind,
        matchedLedgerId: ledgerId,
        matchConfidence: null,
        matchMethod: 'MANUAL',
        ...(notes !== undefined ? { notes: String(notes) } : {}),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Match statement line error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/statements/:id/lines/:lineId/unmatch ───

export const unmatchStatementLine = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const statement = await loadStatement(prisma, scope, req.params.id);
    if (!statement) return res.status(404).json({ success: false, message: 'Statement not found' });
    const line = (statement.lines || []).find((l: any) => l.id === req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Statement line not found' });
    const updated = await db.bankStatementLine.update({
      where: { id: line.id },
      data: { status: 'UNMATCHED', matchedLedgerKind: null, matchedLedgerId: null, matchConfidence: null, matchMethod: null },
    });
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Unmatch statement line error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/statements/:id/lines/:lineId/ignore ────

export const ignoreStatementLine = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const statement = await loadStatement(prisma, scope, req.params.id);
    if (!statement) return res.status(404).json({ success: false, message: 'Statement not found' });
    const line = (statement.lines || []).find((l: any) => l.id === req.params.lineId);
    if (!line) return res.status(404).json({ success: false, message: 'Statement line not found' });
    const { notes } = req.body || {};
    const updated = await db.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'IGNORED',
        matchedLedgerKind: null,
        matchedLedgerId: null,
        matchConfidence: null,
        matchMethod: null,
        ...(notes !== undefined ? { notes: String(notes) } : {}),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Ignore statement line error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/accounting/reconciliations ─────────────────────────

export const listReconciliations = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const where: any = { companyId: scope.companyId };
    if (req.query.bankAccountId) where.bankAccountId = req.query.bankAccountId;
    if (scope.branchId) where.branchId = scope.branchId;
    if (req.query.status) where.status = req.query.status;
    const rows = await db.bankReconciliation.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      include: { bankAccount: { select: { id: true, name: true, bankName: true } } },
    });
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('List reconciliations error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/reconciliations ────────────────────────

export const createReconciliation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const { bankAccountId, statementId, periodStart, periodEnd } = req.body || {};
    if (!bankAccountId || !periodStart || !periodEnd) {
      return res.status(400).json({ success: false, message: 'bankAccountId, periodStart and periodEnd are required' });
    }
    const account = await loadAccount(prisma, scope, bankAccountId);
    if (!account) return res.status(404).json({ success: false, message: 'Bank account not found' });

    let statement: any = null;
    if (statementId) {
      statement = await loadStatement(prisma, scope, statementId);
      if (!statement) return res.status(404).json({ success: false, message: 'Statement not found' });
      if (statement.bankAccountId !== account.id) {
        return res.status(400).json({ success: false, message: 'Statement does not belong to this bank account' });
      }
    }

    const start = parseDateStart(periodStart);
    const end = parseDateEnd(periodEnd);
    const summary = statement
      ? reconSummaryFor(statement)
      : { matchedCount: 0, unmatchedCount: 0, ignoredCount: 0, ledgerClosingBalance: 0, difference: 0 };

    const data = {
      bankAccountId: account.id,
      statementId: statement ? statement.id : null,
      companyId: scope.companyId,
      branchId: account.branchId || scope.branchId || null,
      periodStart: start,
      periodEnd: end,
      statementOpeningBalance: statement ? statement.openingBalance || 0 : 0,
      statementClosingBalance: statement ? statement.closingBalance || 0 : 0,
      ledgerClosingBalance: summary.ledgerClosingBalance,
      matchedCount: summary.matchedCount,
      unmatchedCount: summary.unmatchedCount,
      ignoredCount: summary.ignoredCount,
      difference: summary.difference,
      createdBy: (req as any).user?.id || null,
    };
    const record = await db.bankReconciliation.upsert({
      where: {
        bank_recon_account_period: { bankAccountId: account.id, periodStart: start, periodEnd: end },
      },
      update: { ...data, status: undefined },
      create: { ...data, status: 'OPEN' },
    });
    return res.status(201).json({ success: true, data: { ...record, summary } });
  } catch (error: any) {
    console.error('Create reconciliation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /reports/accounting/reconciliations/:id/complete ───────────

export const completeReconciliation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const db: any = prisma;
    const scope = resolveScope(req);
    if (!hasCompany(scope)) return res.status(400).json({ success: false, message: 'No business context' });
    const record = await db.bankReconciliation.findUnique({ where: { id: req.params.id } });
    if (!record || record.companyId !== scope.companyId) {
      return res.status(404).json({ success: false, message: 'Reconciliation not found' });
    }
    if (record.status === 'COMPLETED') {
      return res.status(409).json({ success: false, message: 'Reconciliation is already completed' });
    }
    if (!record.statementId) {
      return res.status(400).json({ success: false, message: 'This reconciliation has no statement to close against' });
    }
    const statement = await loadStatement(prisma, scope, record.statementId);
    if (!statement) return res.status(404).json({ success: false, message: 'Linked statement not found' });
    const summary = reconSummaryFor(statement);

    const updated = await prisma.$transaction(async (tx: any) => {
      const recon = await tx.bankReconciliation.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          statementOpeningBalance: statement.openingBalance || 0,
          statementClosingBalance: statement.closingBalance || 0,
          ledgerClosingBalance: summary.ledgerClosingBalance,
          matchedCount: summary.matchedCount,
          unmatchedCount: summary.unmatchedCount,
          ignoredCount: summary.ignoredCount,
          difference: summary.difference,
          completedAt: new Date(),
          completedBy: (req as any).user?.id || null,
        },
      });
      // The statement is RECONCILED only when the books actually agree;
      // a completed reconciliation with a difference leaves the
      // statement OPEN so the unmatched lines stay visible work.
      if (summary.isBalanced) {
        await tx.bankStatement.update({ where: { id: statement.id }, data: { status: 'RECONCILED' } });
      }
      return recon;
    });
    return res.json({ success: true, data: { ...updated, summary, statementBalanced: summary.isBalanced } });
  } catch (error: any) {
    console.error('Complete reconciliation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

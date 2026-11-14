/**
 * Ledger reports (v1.0.22): trial balance + balance sheet from the
 * double-entry journals, the posting-exceptions list, and the
 * idempotent opening-balances routine.
 *
 * Routes live under /reports/accounting/*, so the Finance Pack /
 * Growth+ gate in report.routes.ts applies — same as the derived
 * /position endpoint. No plan gate beyond that.
 *
 * Reads NEVER mutate: the trial balance and balance sheet only read
 * journals (no lazy account creation on read — the chart is created
 * by posting paths and by the opening routine).
 */
import '../config/database.init';
import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import {
  getBalanceSheet,
  getLedgerExceptions,
  getTrialBalance,
  postOpeningBalances,
} from '../services/ledger.service';

/** Tenant scope: company + effective branch (query branchId wins, else the context branch). Same semantics as accounting-report.controller. */
function resolveScope(req: AuthRequest): { companyId?: string; branchId?: string } {
  const scope = buildBranchWhereClause(req, {});
  const { branchId } = req.query as any;
  const out: { companyId?: string; branchId?: string } = {};
  if (scope.companyId) out.companyId = scope.companyId;
  if (branchId) out.branchId = branchId;
  else if (scope.branchId) out.branchId = scope.branchId;
  return out;
}

/** As-of date: `asOf` query param (YYYY-MM-DD → end of day), default now. */
function resolveAsOf(req: AuthRequest): Date {
  const raw = (req.query as any)?.asOf;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export const getLedgerTrialBalance = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    if (!scope.companyId) {
      return res.status(400).json({ success: false, message: 'Business context required' });
    }
    const asOf = resolveAsOf(req);
    const [tb, exceptions] = await Promise.all([
      getTrialBalance(prisma, scope.companyId, scope.branchId || null, asOf),
      getLedgerExceptions(prisma, scope.companyId, scope.branchId || null),
    ]);
    return res.json({
      success: true,
      data: {
        asOf: asOf.toISOString(),
        ledger: true,
        scope: { companyId: scope.companyId, branchId: scope.branchId || null },
        ...tb,
        exceptions,
      },
    });
  } catch (error: any) {
    console.error('Ledger trial balance error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getLedgerBalanceSheet = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    if (!scope.companyId) {
      return res.status(400).json({ success: false, message: 'Business context required' });
    }
    const asOf = resolveAsOf(req);
    const bs = await getBalanceSheet(prisma, scope.companyId, scope.branchId || null, asOf);
    return res.json({
      success: true,
      data: {
        asOf: asOf.toISOString(),
        ledger: true,
        scope: { companyId: scope.companyId, branchId: scope.branchId || null },
        ...bs,
      },
    });
  } catch (error: any) {
    console.error('Ledger balance sheet error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getLedgerExceptionList = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    if (!scope.companyId) {
      return res.status(400).json({ success: false, message: 'Business context required' });
    }
    const exceptions = await getLedgerExceptions(prisma, scope.companyId, scope.branchId || null);
    return res.json({
      success: true,
      data: {
        scope: { companyId: scope.companyId, branchId: scope.branchId || null },
        ...exceptions,
      },
    });
  } catch (error: any) {
    console.error('Ledger exceptions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Run the opening-balances routine for one branch (body `branchId`)
 * or for every scope of the business (no branchId). Idempotent —
 * scopes with an existing opening entry are skipped, never
 * duplicated — and never rewrites existing data.
 */
export const postLedgerOpeningBalances = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    if (!scope.companyId) {
      return res.status(400).json({ success: false, message: 'Business context required' });
    }
    const bodyBranchId =
      typeof req.body?.branchId === 'string' && req.body.branchId.trim() !== ''
        ? String(req.body.branchId).trim()
        : null;
    const branchId = bodyBranchId || scope.branchId || null;
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, companyId: scope.companyId },
        select: { id: true },
      });
      if (!branch) {
        return res.status(400).json({ success: false, message: 'Branch was not found in this business' });
      }
    }
    const results = await prisma.$transaction(async (tx: any) =>
      postOpeningBalances(tx, scope.companyId as string, branchId, req.user?.id || null),
    );
    return res.status(201).json({ success: true, data: { results } });
  } catch (error: any) {
    console.error('Ledger opening balances error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

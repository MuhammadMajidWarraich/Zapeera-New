import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';

// ─── Audit trail (v1.0.22) — read-only ───────────────────────────────
// The AuditLog table is append-only: there are deliberately no
// create/update/delete endpoints. Rows are written by the audit-log
// service from the key mutations (sale create/delete, refunds,
// stock adjustments, role changes, settings changes, quotation
// conversions). Filters: staff member (userId), action, date range,
// branch. Branch-selector rule: no branchId = all branches.

const resolveAuditCompanyId = (req: AuthRequest): string =>
  req.membership?.business_id ||
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const auditInclude = {
  branch: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} as const;

// A bare YYYY-MM-DD `to` means the whole day, not its first instant:
// date pickers send bare dates, and `lte: new Date("2026-11-14")` is
// midnight at the START of the 14th, which would drop that day's rows.
// Full datetimes pass through unchanged.
const endOfDayOrAsIs = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999`) : new Date(v);

export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveAuditCompanyId(req);
    const { branchId, userId, action, entityType, search, from, to } = req.query as any;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));

    const where: any = { companyId };
    if (branchId) where.branchId = branchId;
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = endOfDayOrAsIs(to);
    }
    if (search) {
      where.OR = [
        { description: { contains: String(search), mode: 'insensitive' } },
        { userName: { contains: String(search), mode: 'insensitive' } },
        { entityId: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, include: auditInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.auditLog.count({ where }),
    ]);
    return res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error: any) {
    console.error('Get audit logs error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAuditLog = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const row = await prisma.auditLog.findFirst({
      where: { id: req.params.id, companyId: resolveAuditCompanyId(req) },
      include: auditInclude,
    });
    if (!row) return res.status(404).json({ success: false, message: 'Audit entry not found' });
    return res.json({ success: true, data: row });
  } catch (error: any) {
    console.error('Get audit log error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

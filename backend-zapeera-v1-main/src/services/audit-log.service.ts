// Audit trail writer (v1.0.22) — append-only activity log for KEY
// mutations only: sale create/delete, refunds, stock adjustments,
// staff/role changes, settings changes.
//
// The writer NEVER fails the mutation it logs: every failure is
// caught and warned, and callers fire it without awaiting
// (`void logAuditEvent(...)`). Rows are never updated or deleted.
// metadata is a small detail bag (ids, before/after values) — never
// credentials, never full request payloads.

import { getPrisma } from '../utils/db.util';

export type AuditAction =
  | 'SALE_CREATE'
  | 'SALE_DELETE'
  | 'SALE_UPDATE'
  | 'REFUND_CREATE'
  | 'STOCK_ADJUST'
  | 'WASTAGE_RECORD'
  | 'ROLE_CHANGE'
  | 'SETTINGS_CHANGE'
  | 'QUOTATION_CONVERT';

export interface AuditEventInput {
  companyId: string;
  branchId?: string | null;
  userId?: string | null;
  userName?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    if (!event.companyId) return;
    const prisma = await getPrisma();
    await prisma.auditLog.create({
      data: {
        companyId: event.companyId,
        branchId: event.branchId || null,
        userId: event.userId || null,
        userName: event.userName || null,
        action: event.action,
        entityType: event.entityType || null,
        entityId: event.entityId || null,
        description: event.description || null,
        metadata: event.metadata ? JSON.parse(JSON.stringify(event.metadata)) : undefined,
      },
    });
  } catch (error) {
    // The audit trail must never break the business operation.
    console.warn('[audit-log] failed to record event:', (error as any)?.message || error);
  }
}

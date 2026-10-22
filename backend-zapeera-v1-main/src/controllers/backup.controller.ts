// ─── Backup & Restore endpoints ──────────────────────────────────────
//   GET  /api/backup/export          — download one business (owner)
//   GET  /api/backup/export-account  — download every business the
//                                      caller owns, in one file
//   POST /api/backup/restore         — create NEW restored business(es)
//                                      from an uploaded backup file
//
// All three are OWNER-only. A backup contains the business's entire
// dataset, so export is gated as strictly as ownership transfer; the
// restore always lands under the CALLER as owner, whatever account
// the file came from. Secrets never leave in a backup (see
// utils/backup.util.ts for the exclusion list).

import { Response } from 'express';
import fs from 'fs';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  assertBusinessOwner,
  buildAccountBackup,
  buildBusinessBackup,
  findOwnedBusinesses,
  getSafetySnapshotForDownload,
  listSafetySnapshots,
  previewRestoreUpdate,
  restoreBackupFile,
  restoreBackupFileUpdate
} from '../services/backup.service';

const resolveBusinessId = (req: AuthRequest): string | undefined =>
  req.business_id ||
  (req.headers['x-business-id'] as string) ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  req.user?.selectedCompanyId ||
  req.user?.companyId;

const sendDownload = (res: Response, payload: any, filename: string) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(JSON.stringify(payload, null, 2));
};

const dateStamp = () => new Date().toISOString().slice(0, 10);

export const exportBusinessBackupHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context is required (X-Business-ID).' });
    }
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }
    if (!(await assertBusinessOwner(prisma, req.user!.id, business))) {
      return res.status(403).json({
        success: false,
        message: 'Only the business owner can export a backup',
        code: 'BACKUP_OWNER_ONLY'
      });
    }
    const payload = await buildBusinessBackup(prisma, business);
    const slug = (business.name || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return sendDownload(res, payload, `zapeera-backup-${slug}-${dateStamp()}.json`);
  } catch (error: any) {
    console.error('Export business backup error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to export backup' });
  }
};

export const exportAccountBackupHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businesses = await findOwnedBusinesses(prisma, req.user!.id);
    if (!businesses.length) {
      return res.status(404).json({ success: false, message: 'You do not own any business to back up' });
    }
    const payload = await buildAccountBackup(prisma, businesses);
    return sendDownload(res, payload, `zapeera-account-backup-${dateStamp()}.json`);
  } catch (error: any) {
    console.error('Export account backup error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to export account backup' });
  }
};

export const restoreBackupHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const caller = {
      id: req.user!.id,
      email: req.user!.email || '',
      name: req.user!.name
    };
    // Update mode: body { mode: 'update', backup: <payload>, targets:
    // { <sourceBusinessId>: <targetBusinessId> } } — updates the data
    // WITHIN the selected business(es) instead of creating new ones.
    // A safety backup of each target's current state is stored first.
    if (req.body && req.body.mode === 'update') {
      const result = await restoreBackupFileUpdate(prisma, caller, req.body.backup, req.body.targets || {});
      return res.status(200).json({
        success: true,
        message: result.updated.length === 1
          ? `Business "${result.updated[0].name}" updated from backup`
          : `${result.updated.length} businesses updated from backup`,
        data: result
      });
    }
    const result = await restoreBackupFile(prisma, caller, req.body);
    return res.status(201).json({
      success: true,
      message: result.restored.length === 1
        ? `Business restored as "${result.restored[0].name}"`
        : `${result.restored.length} businesses restored`,
      data: result
    });
  } catch (error: any) {
    if (error?.code === 'BACKUP_FORMAT_INVALID') {
      return res.status(400).json({ success: false, message: error.message, code: 'BACKUP_FORMAT_INVALID' });
    }
    if (error?.status && error?.code) {
      return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    }
    console.error('Restore backup error:', error.message);
    return res.status(500).json({
      success: false,
      message: error?.message?.startsWith('Restore failed at table') || error?.message?.startsWith('Restore update failed at table')
        ? error.message
        : 'Failed to restore backup'
    });
  }
};

/** Dry-run diff for the update mode — writes nothing. */
export const previewRestoreUpdateHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const caller = {
      id: req.user!.id,
      email: req.user!.email || '',
      name: req.user!.name
    };
    const backup = req.body?.backup ?? req.body;
    const targets = req.body?.targets || {};
    const result = await previewRestoreUpdate(prisma, caller, backup, targets);
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    if (error?.code === 'BACKUP_FORMAT_INVALID') {
      return res.status(400).json({ success: false, message: error.message, code: 'BACKUP_FORMAT_INVALID' });
    }
    if (error?.status && error?.code) {
      return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    }
    console.error('Restore preview error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to preview restore' });
  }
};

/** Safety backups stored before updates (owner-scoped). */
export const listSafetySnapshotsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const caller = {
      id: req.user!.id,
      email: req.user!.email || '',
      name: req.user!.name
    };
    const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined;
    const snapshots = await listSafetySnapshots(prisma, caller, businessId);
    return res.status(200).json({ success: true, data: { snapshots } });
  } catch (error: any) {
    if (error?.status && error?.code) {
      return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    }
    console.error('List safety backups error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to list safety backups' });
  }
};

export const downloadSafetySnapshotHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const caller = {
      id: req.user!.id,
      email: req.user!.email || '',
      name: req.user!.name
    };
    const { filePath, downloadName } = await getSafetySnapshotForDownload(prisma, caller, req.params.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    if (error?.status && error?.code) {
      return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    }
    console.error('Download safety backup error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to download safety backup' });
  }
};

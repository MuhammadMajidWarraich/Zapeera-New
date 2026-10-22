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
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  assertBusinessOwner,
  buildAccountBackup,
  buildBusinessBackup,
  findOwnedBusinesses,
  restoreBackupFile
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
    console.error('Restore backup error:', error.message);
    return res.status(500).json({
      success: false,
      message: error?.message?.startsWith('Restore failed at table')
        ? error.message
        : 'Failed to restore backup'
    });
  }
};

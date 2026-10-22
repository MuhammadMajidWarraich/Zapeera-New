import { Router } from 'express';
import {
  downloadSafetySnapshotHandler,
  exportAccountBackupHandler,
  exportBusinessBackupHandler,
  listSafetySnapshotsHandler,
  previewRestoreUpdateHandler,
  restoreBackupHandler
} from '../controllers/backup.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Backup & Restore is account-level infrastructure (like /api/companies
// and /api/subscription): the route-policy registry classifies
// /api/backup as 'auth-core', and ownership is enforced inside the
// controller — export requires owning the business in context, and a
// restore always creates the new business under the caller (it must
// therefore NOT require membership in any existing business).
//
// MOUNT (server.ts, both prefixes):
//   import backupRoutes from './routes/backup.routes';
//   app.use('/api/v1/backup', backupRoutes);
//   app.use('/api/backup', backupRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());

router.get('/export', exportBusinessBackupHandler);
router.get('/export-account', exportAccountBackupHandler);
router.post('/restore', restoreBackupHandler);
router.post('/restore-preview', previewRestoreUpdateHandler);
router.get('/safety-backups', listSafetySnapshotsHandler);
router.get('/safety-backups/:id/download', downloadSafetySnapshotHandler);

export default router;

import { Router } from 'express';
import { getAuditLogs, getAuditLog } from '../controllers/audit-log.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, checkPermission, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Audit trail (v1.0.22) — READ-ONLY by design: the table is
// append-only and there are deliberately no write endpoints. Reports
// module + reports.read.
//
// MOUNT (server.ts, both prefixes):
//   import auditLogRoutes from './routes/audit-log.routes';
//   app.use('/api/v1/audit-logs', auditLogRoutes);
//   app.use('/api/audit-logs', auditLogRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('reports'));

router.get('/', checkPermission('reports.read'), getAuditLogs);
router.get('/:id', checkPermission('reports.read'), getAuditLog);

export default router;

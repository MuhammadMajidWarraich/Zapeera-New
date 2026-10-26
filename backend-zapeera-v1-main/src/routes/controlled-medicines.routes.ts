import { Router } from 'express';
import {
  getControlledRegister,
  getControlledRegisterEntry,
  getControlledStaffAudit,
  getInspectionPack,
  createControlledReversal,
} from '../controllers/controlled-medicines.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, checkPermission, requireBusinessTypes, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Controlled / narcotics register (Gap item 2) — APPEND-ONLY dispense
// log. All routes require authentication + the reports module.
// Viewing is restricted by checkPermission('reports.read'): the
// reports page is OWNER/MANAGER-only in MODULE_HIERARCHY, so cashiers
// never see the register. There is deliberately NO PUT / DELETE route
// for log rows — corrections are REVERSAL rows via POST /reversals.
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('reports'));
// L-1 fix (2026-10-26): the controlled / narcotics register is PHARMACY-only.
// The reports module itself is type-neutral, so without this gate every
// business type could read (and reverse) controlled-medicine rows.
router.use(requireBusinessTypes(['PHARMACY']));

// Static subpaths BEFORE /:id so they are never captured as an id.
router.get('/', checkPermission('reports.read'), getControlledRegister);
router.get('/audit/staff', checkPermission('reports.read'), getControlledStaffAudit);
router.get('/inspection-pack', checkPermission('reports.read'), getInspectionPack);
router.post('/reversals', checkPermission('reports.read'), createControlledReversal);
router.get('/:id', checkPermission('reports.read'), getControlledRegisterEntry);

export default router;

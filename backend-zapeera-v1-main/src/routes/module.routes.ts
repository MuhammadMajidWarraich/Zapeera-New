import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getEnabledModules, getModuleHierarchy } from '../controllers/module.controller';
import { resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());

router.get('/enabled', getEnabledModules);
router.get('/hierarchy', getModuleHierarchy);

export default router;

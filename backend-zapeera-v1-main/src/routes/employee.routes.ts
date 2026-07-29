import express from 'express';
import {
  getEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeStats
} from '../controllers/employee.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = express.Router();

// All employee routes require authentication and membership
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('business_management'));

// Employee CRUD operations (permission guarded)
router.get('/', checkPermission('read_employee'), getEmployees);
router.get('/stats', checkPermission('read_employee'), getEmployeeStats);
router.get('/:id', checkPermission('read_employee'), getEmployee);
router.post('/', checkPermission('create_employee'), createEmployee);
router.put('/:id', checkPermission('update_employee'), updateEmployee);
router.delete('/:id', checkPermission('delete_employee'), deleteEmployee);

export default router;

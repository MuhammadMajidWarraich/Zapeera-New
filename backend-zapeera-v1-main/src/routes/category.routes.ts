import { Router } from 'express';
import {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory
} from '../controllers/category.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(checkModule('inventory'));

// Get categories (permission guarded)
router.get('/', checkPermission('read_category'), getCategories);
router.get('/:id', checkPermission('read_category'), getCategory);

// Category management (permission guarded)
router.post('/', checkPermission('create_category'), createCategory);
router.put('/:id', checkPermission('update_category'), updateCategory);
router.delete('/:id', checkPermission('delete_category'), deleteCategory);

export default router;

import { Router } from 'express';
import { getExpenses } from '../controllers/expense.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All expense routes require authentication
router.use(authenticate);

/**
 * GET /api/expenses
 * Get expenses for a branch or company
 */
router.get('/', getExpenses);

export default router;

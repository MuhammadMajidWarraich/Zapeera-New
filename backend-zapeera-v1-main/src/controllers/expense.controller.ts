// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';

/**
 * GET /api/expenses
 * Get expenses for a branch or company
 */
export const getExpenses = async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, branchId, companyId } = req.query;
    const prisma = await getPrisma();

    console.log('Expenses request:', { startDate, endDate, branchId, companyId });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    if (branchId) {
      where.branchId = branchId;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    // Return empty array for now - expenses feature not yet implemented
    res.json({
      success: true,
      data: [],
      message: 'Expenses feature not yet implemented'
    });
  } catch (error: any) {
    console.error('[Expenses] getExpenses error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { adminAuthenticate, adminRoleGuard, logAdminAction, AdminAuthRequest } from '../middleware/admin-auth.middleware';

/**
 * Get all pricing plans
 */
export const getAllPlans = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' }
    });

    return res.json({
      success: true,
      data: plans
    });
  } catch (error: any) {
    console.error('Get all plans error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get plan by ID
 */
export const getPlanById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = await getPrisma();
    
    const plan = await prisma.plan.findUnique({
      where: { id }
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    return res.json({
      success: true,
      data: plan
    });
  } catch (error: any) {
    console.error('Get plan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Create new pricing plan
 */
export const createPlan = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { name, price, durationDays, isTrial, maxBranches, maxUsers, maxCounters, trialLimitPerUser, features } = req.body;

    if (!name || price === undefined || !durationDays) {
      return res.status(400).json({
        success: false,
        message: 'Name, price, and durationDays are required'
      });
    }

    const prisma = await getPrisma();

    const plan = await prisma.plan.create({
      data: {
        name,
        price: parseFloat(price),
        durationDays: parseInt(durationDays),
        isTrial: isTrial || false,
        maxBranches: maxBranches ? parseInt(maxBranches) : null,
        maxUsers: maxUsers ? parseInt(maxUsers) : null,
        maxCounters: maxCounters ? parseInt(maxCounters) : null,
        trialLimitPerUser: trialLimitPerUser ? parseInt(trialLimitPerUser) : 1,
        features: features || null
      } as any
    });

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'CREATE_PLAN',
      'Plan',
      plan.id,
      { planName: name }
    );

    return res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      data: plan
    });
  } catch (error: any) {
    console.error('Create plan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Update pricing plan
 */
export const updatePlan = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, price, durationDays, isTrial, maxBranches, maxUsers, maxCounters, trialLimitPerUser, features, isActive } = req.body;

    const prisma = await getPrisma();

    const existingPlan = await prisma.plan.findUnique({
      where: { id }
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(durationDays !== undefined && { durationDays: parseInt(durationDays) }),
        ...(isTrial !== undefined && { isTrial }),
        ...(maxBranches !== undefined && { maxBranches: maxBranches ? parseInt(maxBranches) : null }),
        ...(maxUsers !== undefined && { maxUsers: maxUsers ? parseInt(maxUsers) : null }),
        ...(maxCounters !== undefined && { maxCounters: maxCounters ? parseInt(maxCounters) : null }),
        ...(trialLimitPerUser !== undefined && { trialLimitPerUser: parseInt(trialLimitPerUser) }),
        ...(features !== undefined && { features }),
        ...(isActive !== undefined && { isActive })
      }
    });

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'UPDATE_PLAN',
      'Plan',
      plan.id,
      { planName: name || existingPlan.name }
    );

    return res.json({
      success: true,
      message: 'Plan updated successfully',
      data: plan
    });
  } catch (error: any) {
    console.error('Update plan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Delete pricing plan (soft delete by setting isActive to false)
 */
export const deletePlan = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = await getPrisma();

    const existingPlan = await prisma.plan.findUnique({
      where: { id }
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    await prisma.plan.update({
      where: { id },
      data: { isActive: false }
    });

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'DELETE_PLAN',
      'Plan',
      id,
      { planName: existingPlan.name }
    );

    return res.json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (error: any) {
    console.error('Delete plan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';

const isRecordNotFound = (error: any): boolean => error?.code === 'P2025';
const isUniqueViolation = (error: any): boolean => error?.code === 'P2002';

/**
 * GET /backoffice/feature-flags
 * List all feature flags.
 */
export const getFeatureFlags = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const flags = await prisma.featureFlag.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: flags });
  } catch (error: any) {
    console.error('[FeatureFlags] getFeatureFlags error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /backoffice/feature-flags
 * Create a new feature flag.
 *
 * Uses the Prisma model rather than raw SQL: the previous $executeRawUnsafe
 * insert passed `new Date().toISOString()` TEXT into the "createdAt"/
 * "updatedAt" timestamp columns, which Postgres rejects (error 42804) — the
 * create endpoint returned 500 on the live Postgres stack.
 */
export const createFeatureFlag = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { key, name, description, enabled } = req.body;
    const adminId = req.admin!.id;

    if (!key || !name) {
      res.status(400).json({ success: false, message: 'Key and name are required' });
      return;
    }

    let flag;
    try {
      flag = await prisma.featureFlag.create({
        data: {
          key,
          name,
          description: description || '',
          enabled: enabled ?? false
        }
      });
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ success: false, message: `A feature flag with key '${key}' already exists` });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'CREATE_FEATURE_FLAG', 'FeatureFlag', flag.id, { key, name, enabled: flag.enabled });

    res.status(201).json({ success: true, data: flag });
  } catch (error: any) {
    console.error('[FeatureFlags] createFeatureFlag error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PATCH /backoffice/feature-flags/:id
 * Update a feature flag (toggle enabled, change name, etc.)
 * The toggle field is `enabled` (the model field), not `isEnabled`.
 */
export const updateFeatureFlag = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { key, name, description, enabled } = req.body;
    const adminId = req.admin!.id;

    const data: { key?: string; name?: string; description?: string; enabled?: boolean } = {};
    if (key !== undefined) data.key = key;
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (enabled !== undefined) data.enabled = Boolean(enabled);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, message: 'No fields to update' });
      return;
    }

    let flag;
    try {
      flag = await prisma.featureFlag.update({
        where: { id },
        data
      });
    } catch (error: any) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ success: false, message: 'Feature flag not found' });
        return;
      }
      if (isUniqueViolation(error)) {
        res.status(409).json({ success: false, message: `A feature flag with key '${key}' already exists` });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'UPDATE_FEATURE_FLAG', 'FeatureFlag', id, req.body);

    res.json({ success: true, data: flag });
  } catch (error: any) {
    console.error('[FeatureFlags] updateFeatureFlag error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * DELETE /backoffice/feature-flags/:id
 */
export const deleteFeatureFlag = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const adminId = req.admin!.id;

    try {
      await prisma.featureFlag.delete({ where: { id } });
    } catch (error: any) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ success: false, message: 'Feature flag not found' });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'DELETE_FEATURE_FLAG', 'FeatureFlag', id);

    res.json({ success: true, data: null });
  } catch (error: any) {
    console.error('[FeatureFlags] deleteFeatureFlag error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

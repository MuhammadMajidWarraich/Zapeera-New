import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';

/**
 * GET /backoffice/feature-flags
 * List all feature flags.
 */
export const getFeatureFlags = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    let flags: any[] = [];
    try {
      flags = await prisma.$queryRaw<any[]>`
        SELECT id, key, name, description, enabled, "createdAt", "updatedAt"
        FROM feature_flags
        ORDER BY "createdAt" DESC
      `;
    } catch {
      // Table doesn't exist yet
    }
    res.json({ success: true, data: flags });
  } catch (error: any) {
    console.error('[FeatureFlags] getFeatureFlags error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /backoffice/feature-flags
 * Create a new feature flag.
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

    const id = `ff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO feature_flags (id, key, name, description, enabled, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        id, key, name, description || '', enabled ?? false, now, now
      );
    } catch {
      res.status(500).json({ success: false, message: 'Feature flags table not available' });
      return;
    }

    await logAdminAction(adminId, 'CREATE_FEATURE_FLAG', 'FeatureFlag', id, { key, name, enabled: enabled ?? false });

    res.status(201).json({
      success: true,
      data: { id, key, name, description: description || '', enabled: enabled ?? false, createdAt: now },
    });
  } catch (error: any) {
    console.error('[FeatureFlags] createFeatureFlag error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PATCH /backoffice/feature-flags/:id
 * Update a feature flag (toggle enabled, change name, etc.)
 */
export const updateFeatureFlag = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { key, name, description, enabled } = req.body;
    const adminId = req.admin!.id;

    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (key !== undefined)         { sets.push(`key = $${paramIdx++}`);         params.push(key); }
    if (name !== undefined)        { sets.push(`name = $${paramIdx++}`);        params.push(name); }
    if (description !== undefined) { sets.push(`description = $${paramIdx++}`); params.push(description); }
    if (enabled !== undefined)     { sets.push(`enabled = $${paramIdx++}`);     params.push(enabled); }
    sets.push(`"updatedAt" = $${paramIdx++}`);
    params.push(now);

    if (sets.length === 1) {
      res.status(400).json({ success: false, message: 'No fields to update' });
      return;
    }

    params.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE feature_flags SET ${sets.join(', ')} WHERE id = $${paramIdx}`,
      ...params
    );

    await logAdminAction(adminId, 'UPDATE_FEATURE_FLAG', 'FeatureFlag', id, req.body);

    res.json({ success: true, data: { id, ...req.body, updatedAt: now } });
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

    await prisma.$executeRawUnsafe(`DELETE FROM feature_flags WHERE id = $1`, id);

    await logAdminAction(adminId, 'DELETE_FEATURE_FLAG', 'FeatureFlag', id);

    res.json({ success: true, data: null });
  } catch (error: any) {
    console.error('[FeatureFlags] deleteFeatureFlag error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

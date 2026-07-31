import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';

/**
 * GET /backoffice/support/tickets
 * List all support tickets (placeholder – no DB model yet).
 * Returns an empty array until a SupportTicket model is added.
 */
export const getSupportTickets = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    // Attempt to query a raw table if it exists; fall back to empty
    let tickets: any[] = [];
    try {
      tickets = await prisma.$queryRaw<any[]>`
        SELECT id, "businessId", "userId", subject, description, status, priority,
               "assignedTo", "createdAt", "updatedAt"
        FROM support_tickets
        ORDER BY "createdAt" DESC
      `;
    } catch {
      // Table doesn't exist yet – return empty
    }

    res.json({ success: true, data: tickets });
  } catch (error: any) {
    console.error('[Support] getSupportTickets error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /backoffice/announcements
 * List all platform announcements.
 */
export const getAnnouncements = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    let announcements: any[] = [];
    try {
      announcements = await prisma.$queryRaw<any[]>`
        SELECT id, title, content, type, status, "createdBy", "createdAt", "updatedAt"
        FROM announcements
        ORDER BY "createdAt" DESC
      `;
    } catch {
      // Table doesn't exist yet – return empty
    }

    res.json({ success: true, data: announcements });
  } catch (error: any) {
    console.error('[Support] getAnnouncements error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /backoffice/announcements
 * Create a new announcement.
 */
export const createAnnouncement = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { title, content, type, status } = req.body;
    const adminId = req.admin!.id;

    if (!title || !content) {
      res.status(400).json({ success: false, message: 'Title and content are required' });
      return;
    }

    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO announcements (id, title, content, type, status, "createdBy", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        id, title, content, type || 'INFO', status || 'ACTIVE', adminId, now, now
      );
    } catch {
      res.status(500).json({ success: false, message: 'Announcements table not available' });
      return;
    }

    await logAdminAction(adminId, 'CREATE_ANNOUNCEMENT', 'Announcement', id, {
      title,
      type: type || 'INFO',
    });

    res.status(201).json({
      success: true,
      data: { id, title, content, type: type || 'INFO', status: status || 'ACTIVE', createdBy: adminId, createdAt: now },
    });
  } catch (error: any) {
    console.error('[Support] createAnnouncement error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PATCH /backoffice/announcements/:id
 * Update an announcement.
 */
export const updateAnnouncement = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { title, content, type, status } = req.body;
    const adminId = req.admin!.id;

    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (title !== undefined)  { sets.push(`title = $${paramIdx++}`);  params.push(title); }
    if (content !== undefined) { sets.push(`content = $${paramIdx++}`); params.push(content); }
    if (type !== undefined)   { sets.push(`type = $${paramIdx++}`);   params.push(type); }
    if (status !== undefined) { sets.push(`status = $${paramIdx++}`); params.push(status); }
    sets.push(`"updatedAt" = $${paramIdx++}`);
    params.push(now);

    if (sets.length === 1) {
      res.status(400).json({ success: false, message: 'No fields to update' });
      return;
    }

    params.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE announcements SET ${sets.join(', ')} WHERE id = $${paramIdx}`,
      ...params
    );

    await logAdminAction(adminId, 'UPDATE_ANNOUNCEMENT', 'Announcement', id, req.body);

    res.json({ success: true, data: { id, ...req.body, updatedAt: now } });
  } catch (error: any) {
    console.error('[Support] updateAnnouncement error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * DELETE /backoffice/announcements/:id
 */
export const deleteAnnouncement = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const adminId = req.admin!.id;

    await prisma.$executeRawUnsafe(`DELETE FROM announcements WHERE id = $1`, id);

    await logAdminAction(adminId, 'DELETE_ANNOUNCEMENT', 'Announcement', id);

    res.json({ success: true, data: null });
  } catch (error: any) {
    console.error('[Support] deleteAnnouncement error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

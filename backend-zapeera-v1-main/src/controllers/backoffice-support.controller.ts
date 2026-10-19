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

// Announcement vocabulary follows the Prisma model (schema.postgresql.prisma):
// type: INFO | WARNING | MAINTENANCE | UPDATE; status: ACTIVE | INACTIVE | ARCHIVED.
const ANNOUNCEMENT_TYPES = ['INFO', 'WARNING', 'MAINTENANCE', 'UPDATE'];
const ANNOUNCEMENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];

const isRecordNotFound = (error: any): boolean => error?.code === 'P2025';

/**
 * GET /backoffice/announcements
 * List all platform announcements.
 */
export const getAnnouncements = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: announcements });
  } catch (error: any) {
    console.error('[Support] getAnnouncements error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /backoffice/announcements
 * Create a new announcement.
 *
 * Uses the Prisma model rather than raw SQL: the previous $executeRawUnsafe
 * insert passed `new Date().toISOString()` TEXT into the "createdAt"/
 * "updatedAt" timestamp columns, which Postgres rejects (error 42804) — the
 * create endpoint returned 500 on the live Postgres stack.
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
    if (type !== undefined && !ANNOUNCEMENT_TYPES.includes(type)) {
      res.status(400).json({ success: false, message: `Invalid type. Must be one of: ${ANNOUNCEMENT_TYPES.join(', ')}` });
      return;
    }
    if (status !== undefined && !ANNOUNCEMENT_STATUSES.includes(status)) {
      res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${ANNOUNCEMENT_STATUSES.join(', ')}` });
      return;
    }

    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        type: type || 'INFO',
        status: status || 'ACTIVE',
        createdBy: adminId
      }
    });

    await logAdminAction(adminId, 'CREATE_ANNOUNCEMENT', 'Announcement', announcement.id, {
      title,
      type: announcement.type,
    });

    res.status(201).json({ success: true, data: announcement });
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

    if (type !== undefined && !ANNOUNCEMENT_TYPES.includes(type)) {
      res.status(400).json({ success: false, message: `Invalid type. Must be one of: ${ANNOUNCEMENT_TYPES.join(', ')}` });
      return;
    }
    if (status !== undefined && !ANNOUNCEMENT_STATUSES.includes(status)) {
      res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${ANNOUNCEMENT_STATUSES.join(', ')}` });
      return;
    }

    const data: { title?: string; content?: string; type?: string; status?: string } = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (type !== undefined) data.type = type;
    if (status !== undefined) data.status = status;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, message: 'No fields to update' });
      return;
    }

    let announcement;
    try {
      announcement = await prisma.announcement.update({
        where: { id },
        data
      });
    } catch (error: any) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ success: false, message: 'Announcement not found' });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'UPDATE_ANNOUNCEMENT', 'Announcement', id, req.body);

    res.json({ success: true, data: announcement });
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

    try {
      await prisma.announcement.delete({ where: { id } });
    } catch (error: any) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ success: false, message: 'Announcement not found' });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'DELETE_ANNOUNCEMENT', 'Announcement', id);

    res.json({ success: true, data: null });
  } catch (error: any) {
    console.error('[Support] deleteAnnouncement error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

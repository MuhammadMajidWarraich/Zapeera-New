import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';
import {
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_PRIORITIES
} from './support.controller';

// Backoffice support-ticket handlers. These live in their own file (rather
// than backoffice-support.controller.ts, which owns announcements) and use
// the Prisma SupportTicket / SupportTicketMessage models — the previous
// list handler's "no DB model yet" raw-SQL placeholder is superseded by
// the filtered list below (routes/backoffice.routes.ts points here now).

const isRecordNotFound = (error: any): boolean => error?.code === 'P2025';

const enrichTickets = async (prisma: any, tickets: any[]): Promise<any[]> => {
  const businessIds = [...new Set(tickets.map((t) => t.businessId).filter(Boolean))];
  const userIds = [...new Set(tickets.map((t) => t.userId).filter(Boolean))];
  const [businesses, users] = await Promise.all([
    businessIds.length
      ? prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })
      : [],
    userIds.length
      ? prisma.zapeeraUser.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, username: true }
        })
      : []
  ]);
  const businessById = new Map(businesses.map((b: any) => [b.id, b.name]));
  const userById = new Map(users.map((u: any) => [u.id, u]));
  return tickets.map((t) => ({
    ...t,
    businessName: t.businessId ? businessById.get(t.businessId) || null : null,
    user: t.userId ? userById.get(t.userId) || null : null
  }));
};

/**
 * GET /backoffice/support/tickets
 * List all support tickets with optional filters:
 * ?status=&priority=&businessId=&search=&page=&limit=
 */
export const getSupportTicketsAdmin = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    const priority = typeof req.query.priority === 'string' ? req.query.priority.toUpperCase() : undefined;
    const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;

    const where: any = {};
    if (status && SUPPORT_TICKET_STATUSES.includes(status)) where.status = status;
    if (priority && SUPPORT_TICKET_PRIORITIES.includes(priority)) where.priority = priority;
    if (businessId) where.businessId = businessId;
    if (search) {
      where.OR = [
        { subject: { contains: search } },
        { description: { contains: search } }
      ];
    }

    const [total, tickets] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { messages: true } } }
      })
    ]);

    res.json({
      success: true,
      data: {
        tickets: await enrichTickets(prisma, tickets),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error: any) {
    console.error('[Support] getSupportTicketsAdmin error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /backoffice/support/tickets/:id
 * One ticket with its full message thread and creator/business context.
 */
export const getSupportTicketAdmin = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }
    const [enriched] = await enrichTickets(prisma, [ticket]);
    res.json({ success: true, data: enriched });
  } catch (error: any) {
    console.error('[Support] getSupportTicketAdmin error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /backoffice/support/tickets/:id/reply
 * Append an admin reply. The first admin reply on an OPEN ticket moves it
 * to IN_PROGRESS. RESOLVED/CLOSED tickets can still be answered (the reply
 * is part of the record) but their status is left untouched here — use the
 * status endpoint to reopen deliberately.
 */
export const replyToSupportTicketAdmin = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { body } = req.body || {};
    const adminId = req.admin!.id;

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ success: false, message: 'Reply body is required' });
      return;
    }
    if (body.length > 5000) {
      res.status(400).json({ success: false, message: 'Reply body is too long (max 5000 characters)' });
      return;
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }

    const message = await prisma.supportTicketMessage.create({
      data: { ticketId: id, authorType: 'ADMIN', authorId: adminId, body: body.trim() }
    });

    // Bump the ticket (updatedAt); an answered OPEN ticket is being worked.
    await prisma.supportTicket.update({
      where: { id },
      data: { status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status }
    });

    await logAdminAction(adminId, 'REPLY_SUPPORT_TICKET', 'SupportTicket', id, {
      messageId: message.id
    });

    res.status(201).json({ success: true, data: message });
  } catch (error: any) {
    console.error('[Support] replyToSupportTicketAdmin error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PATCH /backoffice/support/tickets/:id
 * Update status / priority / assignee. Assignee is a BackOfficeUser id.
 */
export const updateSupportTicketAdmin = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { status, priority, assignedTo } = req.body || {};
    const adminId = req.admin!.id;

    if (status !== undefined && !SUPPORT_TICKET_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${SUPPORT_TICKET_STATUSES.join(', ')}`
      });
      return;
    }
    if (priority !== undefined && !SUPPORT_TICKET_PRIORITIES.includes(priority)) {
      res.status(400).json({
        success: false,
        message: `Invalid priority. Must be one of: ${SUPPORT_TICKET_PRIORITIES.join(', ')}`
      });
      return;
    }

    const data: { status?: string; priority?: string; assignedTo?: string | null } = {};
    if (status !== undefined) data.status = status;
    if (priority !== undefined) data.priority = priority;
    if (assignedTo !== undefined) data.assignedTo = assignedTo || null;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, message: 'No fields to update' });
      return;
    }

    let ticket;
    try {
      ticket = await prisma.supportTicket.update({ where: { id }, data });
    } catch (error: any) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ success: false, message: 'Ticket not found' });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'UPDATE_SUPPORT_TICKET', 'SupportTicket', id, data);

    res.json({ success: true, data: ticket });
  } catch (error: any) {
    console.error('[Support] updateSupportTicketAdmin error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

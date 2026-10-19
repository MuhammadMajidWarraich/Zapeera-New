// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import Joi from 'joi';

// ─── Vocabulary (mirrors the SupportTicket model in the Prisma schemas) ────

export const SUPPORT_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
export const SUPPORT_TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

// ─── Validation schemas ─────────────────────────────────────────────────────

const createTicketSchema = Joi.object({
  subject: Joi.string().trim().min(3).max(200).required(),
  description: Joi.string().trim().min(1).max(5000).required(),
  priority: Joi.string().valid(...SUPPORT_TICKET_PRIORITIES).default('MEDIUM')
  // NOTE: businessId / userId are deliberately NOT accepted — tenancy comes
  // from the authenticated user and the membership that `authenticate`
  // resolved from the X-Business-ID header, never from the body.
});

const replySchema = Joi.object({
  body: Joi.string().trim().min(1).max(5000).required()
});

// ─── Tenancy helpers ────────────────────────────────────────────────────────
// A tenant may access a ticket when they created it OR when it belongs to a
// business they are an ACTIVE member of. Anything else fails closed as 404
// so ticket existence never leaks across tenants.

const getActiveBusinessIds = async (prisma: any, userId: string): Promise<string[]> => {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { businessId: true }
  });
  return memberships.map((m: any) => m.businessId as string);
};

const findAccessibleTicket = async (prisma: any, userId: string, ticketId: string) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: 'asc' } } }
  });
  if (!ticket) return null;
  if (ticket.userId === userId) return ticket;
  if (ticket.businessId) {
    const businessIds = await getActiveBusinessIds(prisma, userId);
    if (businessIds.includes(ticket.businessId)) return ticket;
  }
  return null;
};

const businessNameMap = async (prisma: any, businessIds: string[]): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  const unique = [...new Set(businessIds.filter(Boolean))];
  if (unique.length === 0) return map;
  const businesses = await prisma.business.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true }
  });
  for (const b of businesses) map.set(b.id, b.name);
  return map;
};

// ─── Handlers ───────────────────────────────────────────────────────────────

/**
 * POST /support/tickets
 * Create a support ticket for the authenticated user. When a business
 * context is active (X-Business-ID header with an ACTIVE membership) the
 * ticket is attached to that business; otherwise it is an account-level
 * ticket with businessId = null. The description is also stored as the
 * opening thread message.
 */
export const createSupportTicket = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { error, value } = createTicketSchema.validate(req.body || {});
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message)
      });
      return;
    }

    const prisma = await getPrisma();
    const userId = req.user!.id;
    const businessId = req.membership?.business_id || null;

    const ticket = await prisma.supportTicket.create({
      data: {
        businessId,
        userId,
        subject: value.subject,
        description: value.description,
        priority: value.priority,
        status: 'OPEN',
        messages: {
          create: { authorType: 'TENANT', authorId: userId, body: value.description }
        }
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });

    res.status(201).json({ success: true, data: ticket });
  } catch (error: any) {
    console.error('[Support] createSupportTicket error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /support/tickets
 * List tickets the caller may access: their own tickets plus tickets of
 * every business they are an ACTIVE member of. Optional ?status= filter.
 */
export const getMySupportTickets = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const userId = req.user!.id;
    const businessIds = await getActiveBusinessIds(prisma, userId);

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;

    const where: any = {
      OR: [
        { userId },
        ...(businessIds.length > 0 ? [{ businessId: { in: businessIds } }] : [])
      ],
      ...(status && SUPPORT_TICKET_STATUSES.includes(status) ? { status } : {})
    };

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

    const names = await businessNameMap(prisma, tickets.map((t: any) => t.businessId));
    const data = tickets.map((t: any) => ({
      ...t,
      businessName: t.businessId ? names.get(t.businessId) || null : null
    }));

    res.json({
      success: true,
      data: {
        tickets: data,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error: any) {
    console.error('[Support] getMySupportTickets error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /support/tickets/:id
 * One ticket with its full message thread. Cross-tenant access is a 404.
 */
export const getMySupportTicket = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const ticket = await findAccessibleTicket(prisma, req.user!.id, req.params.id);
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }
    const names = await businessNameMap(prisma, [ticket.businessId]);
    res.json({
      success: true,
      data: { ...ticket, businessName: ticket.businessId ? names.get(ticket.businessId) || null : null }
    });
  } catch (error: any) {
    console.error('[Support] getMySupportTicket error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /support/tickets/:id/reply
 * Append a tenant reply. Replying to a RESOLVED ticket reopens it;
 * CLOSED tickets are final (create a new ticket instead).
 */
export const replyToMySupportTicket = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { error, value } = replySchema.validate(req.body || {});
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message)
      });
      return;
    }

    const prisma = await getPrisma();
    const userId = req.user!.id;
    const ticket = await findAccessibleTicket(prisma, userId, req.params.id);
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }
    if (ticket.status === 'CLOSED') {
      res.status(400).json({ success: false, message: 'This ticket is closed. Please create a new ticket.' });
      return;
    }

    const message = await prisma.supportTicketMessage.create({
      data: { ticketId: ticket.id, authorType: 'TENANT', authorId: userId, body: value.body }
    });

    // Bump the ticket (updatedAt) and reopen it if it was resolved.
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: ticket.status === 'RESOLVED' ? 'OPEN' : ticket.status }
    });

    res.status(201).json({ success: true, data: message });
  } catch (error: any) {
    console.error('[Support] replyToMySupportTicket error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import Joi from 'joi';

// ─── Notification categories (canonical list) ────────────────────────────────
export const NOTIFICATION_CATEGORIES = [
  'sale',
  'inventory',
  'subscription',
  'invitation',
  'staff',
  'billing',
  'system',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a notification for a user (respects their preferences).
 * Returns the created notification or null if preference disabled / error.
 */
export async function createNotification(params: {
  userId: string;
  businessId?: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
}): Promise<{ id: string } | null> {
  try {
    const prisma = await getPrisma();

    // Determine category from type prefix (e.g. 'sale_created' → 'sale')
    const category = mapTypeToCategory(params.type);

    // Check user preference — if no row exists, default is enabled
    const pref = await prisma.notificationPreference.findFirst({
      where: { userId: params.userId, category },
    });
    if (pref && !pref.enabled) return null;

    // Create notification
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const notification = await prisma.notification.create({
      data: {
        id,
        userId: params.userId,
        businessId: params.businessId || null,
        type: params.type,
        title: params.title,
        body: params.body,
        actionUrl: params.actionUrl || null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    });

    return { id: notification.id };
  } catch (error) {
    console.error('[Notification] createNotification error:', error);
    return null;
  }
}

/**
 * Create notifications for multiple users at once.
 */
export async function createNotificationsForUsers(
  userIds: string[],
  params: {
    businessId?: string;
    type: string;
    title: string;
    body: string;
    actionUrl?: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  for (const userId of userIds) {
    await createNotification({ ...params, userId });
  }
}

/**
 * Map a notification type string to a preference category.
 * Types follow the pattern: "{category}_{action}" e.g. "sale_created".
 */
function mapTypeToCategory(type: string): NotificationCategory {
  const prefix = type.split('_')[0];
  if (NOTIFICATION_CATEGORIES.includes(prefix as NotificationCategory)) {
    return prefix as NotificationCategory;
  }
  return 'system';
}

// ─── Validation schemas ─────────────────────────────────────────────────────

const updatePreferenceSchema = Joi.object({
  category: Joi.string()
    .valid(...NOTIFICATION_CATEGORIES)
    .required(),
  enabled: Joi.boolean().required(),
});

const getNotificationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  unreadOnly: Joi.boolean().default(false),
  businessId: Joi.string().optional().allow(null, ''),
});

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * GET /api/notifications/preferences
 * Get all notification preferences for the authenticated user.
 */
export const getNotificationPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const prisma = await getPrisma();
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId },
    });

    // Merge with defaults: missing categories default to enabled
    const result: Record<string, boolean> = {};
    for (const cat of NOTIFICATION_CATEGORIES) {
      const found = prefs.find((p) => p.category === cat);
      result[cat] = found ? found.enabled : true;
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PUT /api/notifications/preferences
 * Update a single notification preference.
 */
export const updateNotificationPreference = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { error } = updatePreferenceSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: error.details[0].message });
      return;
    }

    const { category, enabled } = req.body;
    const prisma = await getPrisma();

    const existing = await prisma.notificationPreference.findFirst({
      where: { userId, category },
    });
    let pref;
    if (existing) {
      pref = await prisma.notificationPreference.update({
        where: { id: existing.id },
        data: { enabled },
      });
    } else {
      pref = await prisma.notificationPreference.create({
        data: { userId, category, enabled },
      });
    }

    res.json({ success: true, data: { category: pref.category, enabled: pref.enabled } });
  } catch (error) {
    console.error('Update notification preference error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PUT /api/notifications/preferences/all
 * Bulk update all notification preferences.
 */
export const bulkUpdatePreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const prefs = req.body.preferences;
    if (!prefs || typeof prefs !== 'object') {
      res.status(400).json({ success: false, message: 'preferences object required' });
      return;
    }

    const prisma = await getPrisma();
    for (const [category, enabled] of Object.entries(prefs)) {
      if (NOTIFICATION_CATEGORIES.includes(category as NotificationCategory)) {
        const existing = await prisma.notificationPreference.findFirst({
          where: { userId, category },
        });
        if (existing) {
          await prisma.notificationPreference.update({
            where: { id: existing.id },
            data: { enabled: Boolean(enabled) },
          });
        } else {
          await prisma.notificationPreference.create({
            data: { userId, category, enabled: Boolean(enabled) },
          });
        }
      }
    }

    res.json({ success: true, message: 'Preferences updated' });
  } catch (error) {
    console.error('Bulk update preferences error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /api/notifications
 * Get paginated notifications for the authenticated user.
 */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { error, value } = getNotificationsQuerySchema.validate(req.query);
    if (error) {
      res.status(400).json({ success: false, message: error.details[0].message });
      return;
    }

    const { page, limit, unreadOnly, businessId } = value;
    const prisma = await getPrisma();

    const where: any = { userId };
    if (unreadOnly) where.read = false;
    if (businessId) where.businessId = businessId;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where }),
    ]);

    const unreadCount = await prisma.notification.count({
      where: { userId, read: false },
    });

    res.json({
      success: true,
      data: {
        notifications: notifications.map((n) => ({
          ...n,
          metadata: n.metadata ? JSON.parse(n.metadata) : null,
        })),
        total,
        unreadCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /api/notifications/unread-count
 * Get the count of unread notifications.
 */
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const prisma = await getPrisma();
    const unreadCount = await prisma.notification.count({
      where: { userId, read: false },
    });

    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read.
 */
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const prisma = await getPrisma();
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.json({ success: true, message: 'Marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for the authenticated user.
 */
export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const prisma = await getPrisma();
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * DELETE /api/notifications/:id
 * Delete a single notification.
 */
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const prisma = await getPrisma();
    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    await prisma.notification.delete({ where: { id } });
    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

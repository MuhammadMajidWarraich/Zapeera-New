import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getNotificationPreferences,
  updateNotificationPreference,
  bulkUpdatePreferences,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
} from '../controllers/notification.controller';

const router = Router();

// ─── All notification routes require authentication ─────────────────────────
router.use(authenticate);

// Preferences
router.get('/preferences', getNotificationPreferences);
router.put('/preferences', updateNotificationPreference);
router.put('/preferences/all', bulkUpdatePreferences);

// Notifications
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', markAsRead);
router.delete('/clear-all', clearAllNotifications);
router.delete('/:id', deleteNotification);

export default router;

/**
 * Subscription Reminder Service
 * 
 * Sends automated email reminders for subscriptions expiring soon.
 * Runs as a background task to check for expiring subscriptions.
 * 
 * Schedule: Runs daily at 9:00 AM (configurable)
 * Reminders sent: 7 days before, 1 day before expiry
 */

import { getPrisma } from '../utils/db.util';
import { emailService } from './email.service';
import { createNotification } from '../controllers/notification.controller';
import logger from '../utils/logger';

// Reminder schedule configuration
const REMINDER_DAYS = [7, 1]; // Send reminders at 7 days and 1 day before expiry

/**
 * Check for subscriptions expiring soon and send reminders
 */
export async function sendSubscriptionExpiryReminders(): Promise<{
  checked: number;
  remindersSent: number;
  errors: number;
}> {
  const prisma = await getPrisma();
  
  const result = {
    checked: 0,
    remindersSent: 0,
    errors: 0
  };

  try {
    logger.info('[Subscription Reminder] Starting daily reminder check...');
    const now = new Date();
    
    // Find all active subscriptions with expiry dates
    const subscriptions = await prisma.$queryRaw<any[]>`
      SELECT 
        bs.id,
        bs."businessId",
        bs."planId",
        bs."currentPeriodEnd",
        bs."trialEndsAt",
        bs.status,
        b.name as "businessName",
        b."createdBy",
        u.email as "ownerEmail",
        u.name as "ownerName",
        u."welcomeEmailSent"
      FROM business_subscriptions bs
      INNER JOIN businesses b ON b.id = bs."businessId"
      INNER JOIN zapeera_users u ON u.id = b."createdBy"
      WHERE bs.status IN ('ACTIVE', 'TRIAL')
        AND (bs."currentPeriodEnd" IS NOT NULL OR bs."trialEndsAt" IS NOT NULL)
    `;

    result.checked = subscriptions.length;
    logger.info('Subscription reminder check started', { count: subscriptions.length });

    for (const sub of subscriptions) {
      try {
        // Determine expiry date (trial or subscription)
        const expiryDate = sub.trialEndsAt 
          ? new Date(sub.trialEndsAt) 
          : new Date(sub.currentPeriodEnd);
        
        if (!expiryDate || isNaN(expiryDate.getTime())) {
          continue;
        }

        // Calculate days remaining
        const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        // Check if we should send a reminder today
        if (!REMINDER_DAYS.includes(daysRemaining)) {
          continue;
        }

        // Check if we already sent a reminder for this subscription at this interval
        const existingReminder = await prisma.$queryRaw<any[]>`
          SELECT id FROM email_notifications
          WHERE "businessId" = ${sub.businessId}
            AND type = 'SUBSCRIPTION_EXPIRY_REMINDER'
            AND "daysRemaining" = ${daysRemaining}
            AND "createdAt" > ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
          LIMIT 1
        `;

        if (existingReminder && existingReminder.length > 0) {
          logger.debug('Subscription expiry reminder already sent', {
            businessName: sub.businessName,
            daysRemaining,
          });
          continue;
        }

        // Send reminder email
        if (sub.ownerEmail) {
          const emailSent = await emailService.sendSubscriptionExpiryReminder(
            sub.ownerEmail,
            sub.ownerName || 'Business Owner',
            sub.businessName,
            sub.planId || 'Your Plan',
            expiryDate.toISOString(),
            daysRemaining
          );

          if (emailSent) {
            // Log the notification
            await prisma.$executeRaw`
              INSERT INTO email_notifications (id, "businessId", type, "daysRemaining", status, "createdAt")
              VALUES (${crypto.randomUUID()}, ${sub.businessId}, 'SUBSCRIPTION_EXPIRY_REMINDER', ${daysRemaining}, 'SENT', CURRENT_TIMESTAMP)
            `;
            
            result.remindersSent++;
            logger.info('Subscription expiry reminder email sent', {
              email: sub.ownerEmail,
              businessName: sub.businessName,
              daysRemaining,
            });
          } else {
            result.errors++;
            logger.error('Failed to send subscription expiry reminder email', {
              email: sub.ownerEmail,
              businessName: sub.businessName,
            });
          }
        }

        // Create in-app notification for the business owner
        const inApp = await createNotification({
          userId: sub.createdBy,
          businessId: sub.businessId,
          type: 'subscription_expiry_reminder',
          title: `Subscription expiring in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
          body: `${sub.businessName}'s subscription ends on ${expiryDate.toISOString().split('T')[0]}. Renew to avoid service interruption.`,
          actionUrl: '/zapeera/subscriptions',
          metadata: {
            businessId: sub.businessId,
            businessName: sub.businessName,
            daysRemaining,
            expiresAt: expiryDate.toISOString(),
          },
        });
        if (inApp) {
          logger.debug('Created in-app subscription expiry reminder', {
            businessName: sub.businessName,
            daysRemaining,
          });
        }
      } catch (error: any) {
        result.errors++;
        logger.error('Error processing subscription reminder', {
          subscriptionId: sub.id,
          message: error.message,
        });
      }
    }

    logger.info('[Subscription Reminder] Reminder check complete', {
      checked: result.checked,
      sent: result.remindersSent,
      errors: result.errors,
    });
    return result;
  } catch (error: any) {
    logger.error('[Subscription Reminder] Fatal error:', { message: error.message });
    return result;
  }
}

/**
 * Initialize the subscription reminder scheduler
 * Should be called once when the server starts
 */
export function initializeReminderScheduler(): void {
  // Check if we're in a production environment
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Run immediately on startup (with 5 second delay to let server initialize)
  setTimeout(() => {
    logger.info('[Subscription Reminder] Running initial check...');
    sendSubscriptionExpiryReminders().catch(err => {
      logger.error('[Subscription Reminder] Initial check failed:', { message: err.message });
    });
  }, 5000);

  // Schedule daily check at 9:00 AM
  const scheduleNextRun = () => {
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(9, 0, 0, 0);
    
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const delay = nextRun.getTime() - now.getTime();
    
    logger.info('[Subscription Reminder] Next run scheduled', { nextRun: nextRun.toISOString() });
    
    setTimeout(() => {
      sendSubscriptionExpiryReminders().catch(err => {
        logger.error('[Subscription Reminder] Scheduled run failed:', { message: err.message });
      });
      scheduleNextRun(); // Schedule next run
    }, delay);
  };

  // Start the scheduling loop
  scheduleNextRun();
  
  logger.info('[Subscription Reminder] Scheduler initialized. Will run daily at 9:00 AM.');
}

// Import crypto for UUID generation
import crypto from 'crypto';

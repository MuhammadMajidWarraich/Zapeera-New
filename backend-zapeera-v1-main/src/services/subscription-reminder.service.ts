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
    console.log('[Subscription Reminder] Starting daily reminder check...');
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
    console.log(`[Subscription Reminder] Checking ${subscriptions.length} subscriptions...`);

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
          console.log(`[Subscription Reminder] Already sent ${daysRemaining}-day reminder for ${sub.businessName}`);
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
              VALUES (${crypto.randomUUID()}, ${sub.businessId}, 'SUBSCRIPTION_EXPIRY_REMINDER', ${daysRemaining}, 'SENT', datetime('now'))
            `;
            
            result.remindersSent++;
            console.log(`✅ Sent ${daysRemaining}-day expiry reminder to ${sub.ownerEmail} for ${sub.businessName}`);
          } else {
            result.errors++;
            console.error(`❌ Failed to send reminder to ${sub.ownerEmail}`);
          }
        }
      } catch (error: any) {
        result.errors++;
        console.error(`[Subscription Reminder] Error processing subscription ${sub.id}:`, error.message);
      }
    }

    console.log(`[Subscription Reminder] Complete. Checked: ${result.checked}, Sent: ${result.remindersSent}, Errors: ${result.errors}`);
    return result;
  } catch (error: any) {
    console.error('[Subscription Reminder] Fatal error:', error.message);
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
    console.log('[Subscription Reminder] Running initial check...');
    sendSubscriptionExpiryReminders().catch(err => {
      console.error('[Subscription Reminder] Initial check failed:', err);
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
    
    console.log(`[Subscription Reminder] Next run scheduled for ${nextRun.toISOString()}`);
    
    setTimeout(() => {
      sendSubscriptionExpiryReminders().catch(err => {
        console.error('[Subscription Reminder] Scheduled run failed:', err);
      });
      scheduleNextRun(); // Schedule next run
    }, delay);
  };

  // Start the scheduling loop
  scheduleNextRun();
  
  console.log('[Subscription Reminder] Scheduler initialized. Will run daily at 9:00 AM.');
}

// Import crypto for UUID generation
import crypto from 'crypto';

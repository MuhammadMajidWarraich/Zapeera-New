import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';

/**
 * GET /backoffice/notifications
 *
 * Aggregates the REAL, actionable queues a platform admin has to work on,
 * so the backoffice header bell reflects actual pending work instead of a
 * decorative dot. Every item comes from a live table — there are no sample
 * or synthetic notifications.
 *
 * Sources wired:
 *  - payment_proof        PaymentProof rows still PENDING review
 *  - affiliate_payout     AffiliatePayout rows still REQUESTED
 *  - affiliate_application Affiliate rows still PENDING approval
 *  - new_business         Businesses registered in the last 7 days
 *  - trial_expiring       TRIAL subscriptions whose trialEndsAt falls
 *                         within the next 3 days (item timestamp = the
 *                         moment the subscription entered that window,
 *                         i.e. trialEndsAt − 3 days, so "seen" semantics
 *                         stay correct)
 *  - support_ticket       SupportTicket rows still OPEN
 *  - partner_application  PartnerApplication rows still PENDING review
 *                         (white-label partner applications, added when
 *                         the partner-applications feature landed)
 *
 * Response: { success, data: { items, counts, total } }
 *  - items: newest first, capped at MAX_ITEMS
 *  - counts: exact per-kind pending totals (independent of the item cap)
 *  - total: sum of all per-kind counts
 */

const MAX_ITEMS = 50;
const NEW_BUSINESS_WINDOW_DAYS = 7;
const TRIAL_EXPIRY_WINDOW_DAYS = 3;

interface NotificationItem {
  id: string;
  kind: 'payment_proof' | 'affiliate_payout' | 'affiliate_application' | 'new_business' | 'trial_expiring' | 'support_ticket' | 'partner_application';
  title: string;
  detail: string;
  createdAt: Date;
  link: string;
}

function formatMoney(amount: number, currency?: string | null): string {
  const formatted = amount.toLocaleString('en-PK', { maximumFractionDigits: 2 });
  if (!currency || currency === 'PKR') return `Rs ${formatted}`;
  return `${currency} ${formatted}`;
}

// Row shapes for the two affiliate queries below.
interface AffiliatePayoutRow {
  id: string;
  amount: number;
  createdAt: Date;
  affiliate: { user: { name: string; email: string } };
}
interface AffiliateApplicationRow {
  id: string;
  code: string;
  createdAt: Date;
  user: { name: string; email: string };
}
interface PartnerApplicationRow {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  source: string;
  createdAt: Date;
}

export const getBackofficeNotifications = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const now = new Date();

    const newBusinessSince = new Date(now);
    newBusinessSince.setDate(now.getDate() - NEW_BUSINESS_WINDOW_DAYS);

    const trialWindowEnd = new Date(now);
    trialWindowEnd.setDate(now.getDate() + TRIAL_EXPIRY_WINDOW_DAYS);

    const [
      paymentProofs,
      affiliatePayouts,
      affiliateApplications,
      newBusinesses,
      expiringTrials,
      openTickets,
      partnerApplications,
      paymentProofCount,
      affiliatePayoutCount,
      affiliateApplicationCount,
      newBusinessCount,
      expiringTrialCount,
      openTicketCount,
      partnerApplicationCount,
    ] = await Promise.all([
      prisma.paymentProof.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: MAX_ITEMS,
        include: {
          business: { select: { name: true } },
          plan: { select: { name: true } },
        },
      }),
      // The sandbox-generated Prisma client predates the affiliate models,
      // so its types lack these two delegates (the affiliate controllers
      // carry the same TS2339s against it). The production client is
      // generated from the current schema at deploy time and has them —
      // scope the cast to these delegates so this file adds no new type
      // errors under the stale client; runtime behavior is unchanged.
      (prisma as any).affiliatePayout.findMany({
        where: { status: 'REQUESTED' },
        orderBy: { createdAt: 'desc' },
        take: MAX_ITEMS,
        include: {
          affiliate: {
            include: { user: { select: { name: true, email: true } } },
          },
        },
      }) as Promise<AffiliatePayoutRow[]>,
      (prisma as any).affiliate.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: MAX_ITEMS,
        include: { user: { select: { name: true, email: true } } },
      }) as Promise<AffiliateApplicationRow[]>,
      prisma.business.findMany({
        where: { createdAt: { gte: newBusinessSince } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ITEMS,
        select: { id: true, name: true, businessType: true, createdAt: true },
      }),
      prisma.businessSubscription.findMany({
        where: {
          status: 'TRIAL',
          trialEndsAt: { gte: now, lte: trialWindowEnd },
        },
        orderBy: { trialEndsAt: 'asc' },
        take: MAX_ITEMS,
        include: {
          business: { select: { name: true } },
          plan: { select: { name: true } },
        },
      }),
      prisma.supportTicket.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: MAX_ITEMS,
        select: { id: true, subject: true, priority: true, createdAt: true },
      }),
      // Same stale-client scoping as the affiliate delegates above: the
      // sandbox-generated client predates the PartnerApplication model;
      // the production client (generated at deploy time) has the delegate.
      (prisma as any).partnerApplication.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: MAX_ITEMS,
        select: { id: true, companyName: true, contactName: true, email: true, source: true, createdAt: true },
      }) as Promise<PartnerApplicationRow[]>,
      prisma.paymentProof.count({ where: { status: 'PENDING' } }),
      (prisma as any).affiliatePayout.count({ where: { status: 'REQUESTED' } }) as Promise<number>,
      (prisma as any).affiliate.count({ where: { status: 'PENDING' } }) as Promise<number>,
      prisma.business.count({ where: { createdAt: { gte: newBusinessSince } } }),
      prisma.businessSubscription.count({
        where: {
          status: 'TRIAL',
          trialEndsAt: { gte: now, lte: trialWindowEnd },
        },
      }),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      (prisma as any).partnerApplication.count({ where: { status: 'PENDING' } }) as Promise<number>,
    ]);

    const items: NotificationItem[] = [];

    for (const proof of paymentProofs) {
      items.push({
        id: `payment_proof:${proof.id}`,
        kind: 'payment_proof',
        title: 'Payment proof awaiting review',
        detail: `${proof.business.name} — ${proof.plan.name} — ${formatMoney(proof.amount, proof.currency)} via ${proof.method.replace(/_/g, ' ')}`,
        createdAt: proof.createdAt,
        link: '/backoffice/payment-proofs',
      });
    }

    for (const payout of affiliatePayouts) {
      const who = payout.affiliate.user.name || payout.affiliate.user.email;
      items.push({
        id: `affiliate_payout:${payout.id}`,
        kind: 'affiliate_payout',
        title: 'Affiliate payout requested',
        detail: `${who} — ${formatMoney(payout.amount)}`,
        createdAt: payout.createdAt,
        link: '/backoffice/affiliate-payouts',
      });
    }

    for (const application of affiliateApplications) {
      const who = application.user.name || application.user.email;
      items.push({
        id: `affiliate_application:${application.id}`,
        kind: 'affiliate_application',
        title: 'Affiliate application pending',
        detail: `${who} (${application.user.email}) — code ${application.code}`,
        createdAt: application.createdAt,
        link: '/backoffice/affiliates',
      });
    }

    for (const business of newBusinesses) {
      items.push({
        id: `new_business:${business.id}`,
        kind: 'new_business',
        title: 'New business registered',
        detail: `${business.name} — ${business.businessType}`,
        createdAt: business.createdAt,
        link: `/backoffice/businesses/${business.id}`,
      });
    }

    for (const sub of expiringTrials) {
      if (!sub.trialEndsAt) continue;
      // The item becomes actionable when the trial enters the ≤3-day window.
      const enteredWindowAt = new Date(sub.trialEndsAt);
      enteredWindowAt.setDate(enteredWindowAt.getDate() - TRIAL_EXPIRY_WINDOW_DAYS);
      const endsOn = sub.trialEndsAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      items.push({
        id: `trial_expiring:${sub.id}`,
        kind: 'trial_expiring',
        title: 'Trial expiring soon',
        detail: `${sub.business.name} — ${sub.plan.name} trial ends ${endsOn}`,
        createdAt: enteredWindowAt,
        link: `/backoffice/businesses/${sub.businessId}`,
      });
    }

    for (const ticket of openTickets) {
      items.push({
        id: `support_ticket:${ticket.id}`,
        kind: 'support_ticket',
        title: 'Support ticket open',
        detail: `${ticket.subject} — ${ticket.priority} priority`,
        createdAt: ticket.createdAt,
        link: '/backoffice/support/tickets',
      });
    }

    for (const application of partnerApplications) {
      items.push({
        id: `partner_application:${application.id}`,
        kind: 'partner_application',
        title: 'Partner application pending',
        detail: `${application.companyName} — ${application.contactName} (${application.email}) — via ${application.source}`,
        createdAt: application.createdAt,
        link: '/backoffice/partners',
      });
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const counts = {
      payment_proof: paymentProofCount,
      affiliate_payout: affiliatePayoutCount,
      affiliate_application: affiliateApplicationCount,
      new_business: newBusinessCount,
      trial_expiring: expiringTrialCount,
      support_ticket: openTicketCount,
      partner_application: partnerApplicationCount,
    };
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    res.json({
      success: true,
      data: {
        items: items.slice(0, MAX_ITEMS),
        counts,
        total,
      },
    });
  } catch (error: any) {
    console.error('Get backoffice notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

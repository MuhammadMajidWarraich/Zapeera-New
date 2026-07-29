import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';

/**
 * GET /backoffice/dashboard/stats
 *
 * Single endpoint that powers ALL widgets on the Super Admin Dashboard:
 *  - Summary KPI cards (revenue, businesses, subscriptions, registrations, users)
 *  - Top Performing Businesses (by subscription plan price — real sales not yet tracked per-business)
 *  - Recent Platform Activity (latest company creations + subscription changes)
 *  - Subscription Alerts (expiring within 7 days, already expired)
 *  - Recent Users (most recently created users with business count)
 *  - Recently Created Businesses
 *  - Subscription Growth chart data (daily new subscriptions last 30 days)
 */
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const now = new Date();

    // ── Date helpers ─────────────────────────────────────────────────────────
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(now.getDate() + 7);

    // ── 1. Business counts ────────────────────────────────────────────────────
    const [totalBusinesses, activeBusinesses] = await Promise.all([
      prisma.business.count(),
      prisma.business.count({ where: { isActive: true } }),
    ]);

    // ── 2. New registrations in last 30 days ──────────────────────────────────
    const newRegistrationsLast30 = await prisma.business.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    });

    // ── 3. Total platform users ───────────────────────────────────────────────
    const totalUsers = await prisma.zapeeraUser.count({ where: { isActive: true } });

    // ── 4. Subscriptions ──────────────────────────────────────────────────────
    const allSubs = await prisma.businessSubscription.findMany({
      include: { plan: { select: { id: true, price: true, name: true } } },
    });

    const activeCount    = allSubs.filter(s => s.status === 'ACTIVE').length;
    const trialCount     = allSubs.filter(s => s.status === 'TRIAL').length;
    const expiredCount   = allSubs.filter(s => s.status === 'EXPIRED' || s.status === 'CANCELLED').length;
    const suspendedCount = allSubs.filter(s => s.status === 'SUSPENDED').length;

    // "New" = became ACTIVE/TRIAL this calendar month
    const newThisMonth = allSubs.filter(s =>
      (s.status === 'ACTIVE' || s.status === 'TRIAL') &&
      s.createdAt >= currentMonthStart
    ).length;

    // "Renewal" = ACTIVE subs started before this month (they renewed)
    const renewalCount = allSubs.filter(s =>
      s.status === 'ACTIVE' && s.createdAt < currentMonthStart
    ).length;

    // ── 5. Revenue = sum of active plan prices (MRR proxy) ───────────────────
    const monthlyRevenue = (allSubs as any[])
      .filter(s => s.status === 'ACTIVE')
      .reduce((sum: number, s: any) => sum + (s.plan?.price ?? 0), 0);

    // Revenue vs last month: count active subs last month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthActiveSubs = await prisma.businessSubscription.findMany({
      where: {
        status: 'ACTIVE',
        createdAt: { lte: lastMonthEnd },
        currentPeriodEnd: { gte: lastMonthStart },
      },
      include: { plan: { select: { price: true } } },
    });
    const lastMonthRevenue = (lastMonthActiveSubs as any[]).reduce(
      (sum: number, s: any) => sum + (s.plan?.price ?? 0), 0
    );
    const revenueGrowthPercent = lastMonthRevenue > 0
      ? Math.round(((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : null;

    // ── 6. Top Performing Businesses ─────────────────────────────────────────
    // Revenue = plan price of their active subscription (sales per-business not tracked globally)
    const companiesWithSubs = await prisma.business.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        businessSubscription: {
          include: { plan: { select: { price: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const topBusinesses = (companiesWithSubs as any[])
      .map(c => ({
        id: c.id,
        name: c.name,
        revenue: (c.businessSubscription?.plan?.price ?? 0),
        planName: c.businessSubscription?.plan?.name ?? 'No active plan',
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // ── 7. Recent Platform Activity ───────────────────────────────────────────
    const recentCompanies = await prisma.business.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        createdBy: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const recentSubsActivity = await prisma.businessSubscription.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      include: {
        business: { select: { id: true, name: true } },
        plan: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const activities = [
      ...recentCompanies.map((c: any) => ({
        id: `biz_${c.id}`,
        type: 'business_created',
        message: `Business created: ${c.name}`,
        details: `ID: ${c.id}`,
        timestamp: c.createdAt.toISOString(),
      })),
      ...recentSubsActivity.map((s: any) => ({
        id: `sub_${s.id}`,
        type: 'subscription_added',
        message: `Subscription ${s.status}: ${s.business?.name ?? 'Unknown'} → ${s.plan?.name ?? 'Plan'}`,
        details: `Subscription ID: ${s.id}`,
        timestamp: s.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    // ── 8. Subscription Alerts ────────────────────────────────────────────────
    const alertSubs = await prisma.businessSubscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] },
        currentPeriodEnd: { lte: sevenDaysFromNow },
      },
      include: {
        business: { select: { id: true, name: true } },
        plan: { select: { name: true } },
      },
    });

    const subscriptionAlerts = alertSubs.map((s: any) => ({
      id: s.id,
      businessName: s.business?.name ?? 'Unknown',
      planName: s.plan?.name ?? 'Unknown',
      endDate: s.endDate?.toISOString(),
      type: s.endDate && s.endDate < now ? 'expired' : 'expiring',
      daysLeft: s.endDate
        ? Math.ceil((s.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null,
      severity: s.endDate && s.endDate < now ? 'danger' : 'warning',
    }));

    // ── 9. Recent Users ───────────────────────────────────────────────────────
    const recentUsers = await prisma.zapeeraUser.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // ── 10. Recently Created Businesses (with owner email) ────────────────────
    const recentBusinesses = await prisma.business.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        memberships: {
          where: { role: { name: 'OWNER' } },
          take: 1,
          include: {
            user: { select: { email: true, name: true } },
          },
        },
        businessSubscription: {
          include: { plan: { select: { name: true, price: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // ── 11. Subscription Growth chart (daily, last 30 days) ──────────────────
    // Build a map of day → { new, cancelled }
    const growthSubs = await prisma.businessSubscription.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, status: true },
    });

    const cancelledSubs = await prisma.businessSubscription.findMany({
      where: {
        status: { in: ['CANCELLED', 'EXPIRED'] },
        updatedAt: { gte: thirtyDaysAgo },
      },
      select: { updatedAt: true },
    });

    // Build daily buckets for last 30 days
    const growthMap: Record<string, { new: number; cancelled: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      growthMap[key] = { new: 0, cancelled: 0 };
    }
    growthSubs.forEach((s: any) => {
      const key = new Date(s.createdAt).toISOString().split('T')[0];
      if (growthMap[key]) growthMap[key].new++;
    });
    cancelledSubs.forEach((s: any) => {
      const key = new Date(s.updatedAt).toISOString().split('T')[0];
      if (growthMap[key]) growthMap[key].cancelled++;
    });

    const growthChart = Object.entries(growthMap).map(([date, counts]) => ({
      date,
      new: counts.new,
      cancelled: counts.cancelled,
    }));

    // ── Pending Payment Proofs count ──────────────────────────────────────────
    let pendingProofs = 0;
    try {
      const rows = await prisma.$queryRaw<{ cnt: number }[]>`
        SELECT COUNT(*) as cnt FROM payment_proofs WHERE status = 'PENDING'
      `;
      pendingProofs = Number(rows[0]?.cnt ?? 0);
    } catch {}

    // ── Response ──────────────────────────────────────────────────────────────
    res.json({
      success: true,
      data: {
        // KPI cards
        totalRevenue: monthlyRevenue,
        revenueGrowthPercent,
        totalBusinesses,
        activeBusinesses,
        inactiveBusinesses: totalBusinesses - activeBusinesses,
        totalSubscriptions: allSubs.length,
        activeSubscriptions: activeCount,
        trialSubscriptions: trialCount,
        expiredSubscriptions: expiredCount,
        suspendedSubscriptions: suspendedCount,
        newSubscriptionsThisMonth: newThisMonth,
        renewalSubscriptions: renewalCount,
        newRegistrationsLast30,
        totalUsers,

        // Widgets
        topBusinesses,
        recentActivity: activities,
        subscriptionAlerts,
        recentUsers: recentUsers.map((u: any) => ({
          id: u.id,
          name: u.name || u.username || 'User',
          email: u.email || '-',
          businessesCount: u._count.memberships,
          createdAt: u.createdAt.toISOString(),
        })),
        recentBusinesses: (recentBusinesses as any[]).map(b => ({
          id: b.id,
          name: b.name,
          ownerEmail: b.memberships?.[0]?.user?.email ?? '-',
          ownerName: b.memberships?.[0]?.user?.name ?? '-',
          planName: b.subscriptions?.[0]?.plan?.name ?? 'No plan',
          planPrice: b.subscriptions?.[0]?.plan?.price ?? 0,
          createdAt: b.createdAt.toISOString(),
        })),
        growthChart,
        pendingPaymentProofs: pendingProofs,
      },
    });
  } catch (error: any) {
    console.error('[DashboardStats] error:', error);
    res.status(500).json({ success: false, message: 'Failed to load dashboard stats' });
  }
};

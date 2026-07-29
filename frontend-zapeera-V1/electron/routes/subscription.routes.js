function registerSubscriptionRoutes(app, authMiddleware, deps) {
  const { query } = deps;

  app.get('/api/subscription/entitlements/business/:companyId', authMiddleware, (req, res) => {
    try {
      const { companyId } = req.params;

      const company = query('SELECT id, name, businessType FROM companies WHERE id = ? AND isActive = 1', [companyId])[0];

      if (!company) {
        return res.status(404).json({ success: false, message: 'Company not found' });
      }

      res.json({
        success: true,
        data: {
          companyId,
          businessType: company.businessType || 'PHARMACY',
          planId: 'free',
          isSubscribed: true,
          subscriptionStatus: 'active',
          trialEndsAt: null,
          currentPeriodEnd: null,
          addOns: {},
          plan: {
            id: 'free',
            segment: 'single',
            name: 'Free Plan',
            dashboardAccessRoles: ['OWNER', 'MANAGER', 'CASHIER'],
            businessTypes: ['PHARMACY', 'STORE', 'HOTEL', 'CLINIC'],
            limits: {
              maxBranches: 10,
              maxCountersPerBranch: 5,
              maxConcurrentUsers: 20,
            },
          },
          limits: {
            maxBranches: 10,
            maxCountersPerBranch: 5,
            maxConcurrentUsers: 20,
          },
          usage: {
            activeBranches: query('SELECT COUNT(*) as c FROM branches WHERE companyId = ? AND isActive = 1', [companyId])[0]?.c || 0,
            activeUsers: query('SELECT COUNT(*) as c FROM users WHERE companyId = ? AND isActive = 1', [companyId])[0]?.c || 0,
            totalUsers: query('SELECT COUNT(*) as c FROM users WHERE companyId = ?', [companyId])[0]?.c || 0,
          },
          remaining: {
            branches: null,
            users: null,
          },
        },
      });
    } catch (e) {
      console.error('[Subscription] error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = { registerSubscriptionRoutes };

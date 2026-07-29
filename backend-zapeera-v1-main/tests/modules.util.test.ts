jest.mock('../src/utils/subscription-entitlements.util', () => {
  const actual = jest.requireActual('../src/utils/subscription-entitlements.util');
  return {
    ...actual,
    loadPricingPlans: jest.fn(),
    resolveBusinessPlan: jest.fn(),
  };
});

import { getBusinessModuleAccessPayload } from '../src/utils/modules.util';
import { loadPricingPlans, resolveBusinessPlan } from '../src/utils/subscription-entitlements.util';

describe('getBusinessModuleAccessPayload', () => {
  it('respects plan-level disables even when the business has an active subscription', async () => {
    const mockedLoadPricingPlans = loadPricingPlans as jest.MockedFunction<typeof loadPricingPlans>;
    const mockedResolveBusinessPlan = resolveBusinessPlan as jest.MockedFunction<typeof resolveBusinessPlan>;

    mockedLoadPricingPlans.mockResolvedValue([] as any);
    mockedResolveBusinessPlan.mockResolvedValue({
      id: 'plan-1',
      name: 'Premium',
      modules: ['sales', 'inventory'],
    } as any);

    const prisma: any = {
      business: {
        findUnique: jest.fn().mockResolvedValue({ businessType: 'PHARMACY' }),
      },
      businessSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
      },
      $queryRawUnsafe: jest.fn(async (query: string) => {
        const sql = String(query).toLowerCase();

        if (sql.includes('select id, name from modules')) {
          return [
            { id: 'mod-sales', name: 'sales' },
            { id: 'mod-inventory', name: 'inventory' },
          ];
        }

        if (sql.includes('select id from business_types')) {
          return [];
        }

        if (sql.includes('plan_module_permissions')) {
          return [{ moduleName: 'sales', enabled: 0 }];
        }

        if (sql.includes('select moduleName, enabled from role_module_permissions')) {
          return [];
        }

        if (sql.includes('select bm.enabled, m.name')) {
          return [];
        }

        if (sql.includes('select moduleName, subModuleKey from business_type_sub_module_permissions')) {
          return [];
        }

        if (sql.includes('select moduleName, subModuleKey from plan_sub_module_permissions')) {
          return [];
        }

        if (sql.includes('select moduleName, subModuleKey from role_sub_module_permissions')) {
          return [];
        }

        if (sql.includes('select m.name from business_modules')) {
          return [];
        }

        if (sql.includes('select status, "trialendsat", "currentperiodend"')) {
          return [];
        }

        return [];
      }),
    };

    const result = await getBusinessModuleAccessPayload(prisma as any, 'business-1', { roleName: 'OWNER' });
    const salesModule = result.data.find((item) => item.name === 'sales');

    expect(salesModule?.enabled).toBe(false);
  });
});

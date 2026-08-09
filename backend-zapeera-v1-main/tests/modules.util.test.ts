/**
 * Modules utility tests — business-type driven module provisioning.
 * Regression coverage for the business_type_modules → module_definitions
 * FK fix: enabled/disabled sets must resolve from the business type template.
 */

jest.mock('../src/utils/db.util', () => ({
  getPrisma: jest.fn(),
}));

import { getPrisma } from '../src/utils/db.util';
import { enableDefaultModulesForBusiness } from '../src/utils/modules.util';

const mockedGetPrisma = getPrisma as jest.MockedFunction<typeof getPrisma>;

describe('enableDefaultModulesForBusiness', () => {
  const moduleList = [
    { id: 'mod-sales', name: 'sales' },
    { id: 'mod-inventory', name: 'inventory' },
    { id: 'mod-subscription', name: 'subscription' },
    { id: 'mod-reports', name: 'reports' },
  ];

  function buildPrisma(businessTypeModules: any[]) {
    return {
      business: {
        findUnique: jest.fn().mockResolvedValue({ businessType: 'PHARMACY' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'bt-pharmacy' }]),
      businessType: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bt-pharmacy',
          modules: businessTypeModules,
        }),
      },
      module: { findMany: jest.fn().mockResolvedValue(moduleList) },
      businessModule: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  function createdModuleStates(prisma: any): Record<string, boolean> {
    const created = prisma.businessModule.create.mock.calls.map((c: any[]) => c[0].data);
    return Object.fromEntries(created.map((d: any) => [d.moduleId, d.enabled]));
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enables modules allowed by the business type and always keeps subscription enabled', async () => {
    const prisma = buildPrisma([
      { isEnabled: true, module: { key: 'sales', name: 'sales' } },
      { isEnabled: false, module: { key: 'inventory', name: 'inventory' } },
    ]);
    mockedGetPrisma.mockResolvedValue(prisma as any);

    await enableDefaultModulesForBusiness('business-1');

    const states = createdModuleStates(prisma);
    expect(states['mod-sales']).toBe(true);
    expect(states['mod-inventory']).toBe(false);
    expect(states['mod-subscription']).toBe(true);
    expect(states['mod-reports']).toBe(false);
  });

  it('falls back to enabling all standard modules when the business type has no modules configured', async () => {
    const prisma = buildPrisma([]);
    mockedGetPrisma.mockResolvedValue(prisma as any);

    await enableDefaultModulesForBusiness('business-1');

    const states = createdModuleStates(prisma);
    expect(Object.values(states).every((enabled) => enabled)).toBe(true);
    expect(Object.keys(states).length).toBe(moduleList.length);
  });

  it('falls back to standard modules when the business has no business type', async () => {
    const prisma = buildPrisma([]);
    prisma.business.findUnique.mockResolvedValue({ businessType: null });
    mockedGetPrisma.mockResolvedValue(prisma as any);

    await enableDefaultModulesForBusiness('business-1');

    const states = createdModuleStates(prisma);
    expect(Object.values(states).every((enabled) => enabled)).toBe(true);
  });
});

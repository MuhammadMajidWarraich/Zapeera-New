/**
 * Business-types overhaul (2026-10-31) regression coverage.
 *
 * Muhammad's decision: Zapeera has FOUR industries — PHARMACY,
 * RETAIL_STORE, HOTEL, CLINIC. DEPARTMENTAL_STORE merged into
 * RETAIL_STORE. Covered here:
 *  - canonical types + legacy alias resolution (DEPARTMENTAL_STORE →
 *    RETAIL_STORE), incl. weight-selling eligibility;
 *  - per-industry category type sets (retail FOOD/NON_FOOD, pharmacy
 *    MEDICAL/NON_MEDICAL, hotel/clinic GENERAL only) and the
 *    business-type resolution used by category validation;
 *  - starter-category seeding: fires once for a NEW pharmacy/retail
 *    business, never when categories already exist, never for
 *    hotel/clinic;
 *  - the boot migration (ensureBusinessTypesExist): rewrites a stored
 *    DEPARTMENTAL_STORE business to RETAIL_STORE, remaps its
 *    categories (NON_MEDICAL → NON_FOOD, MEDICAL → GENERAL), retires
 *    the legacy business_types row, and is idempotent on re-run.
 *
 * All Prisma access is stubbed — these tests never touch a real DB.
 */

jest.mock('../src/utils/db.util', () => ({
  getPrisma: jest.fn(),
}));

jest.mock('../src/utils/modules-v2.util', () => ({
  ensureModuleAccessV2SeedData: jest.fn().mockResolvedValue(undefined),
}));

import { getPrisma } from '../src/utils/db.util';
import {
  CANONICAL_BUSINESS_TYPES,
  resolveCanonicalBusinessTypeKey,
  isWeightSellingAllowedForBusinessType,
  isModuleApplicableToBusinessType,
} from '../src/utils/module-applicability.util';
import {
  getAllowedCategoryTypes,
  isCategoryTypeAllowed,
  resolveBusinessTypeForCategoryScope,
  seedDefaultCategoriesForBusiness,
  PHARMACY_STARTER_CATEGORIES,
  RETAIL_STARTER_CATEGORIES,
} from '../src/utils/category-types.util';
import { ensureBusinessTypesExist } from '../src/utils/modules.util';

const mockedGetPrisma = getPrisma as jest.MockedFunction<typeof getPrisma>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('canonical business types + legacy aliases', () => {
  it('has exactly the four industries', () => {
    expect([...CANONICAL_BUSINESS_TYPES]).toEqual(['PHARMACY', 'RETAIL_STORE', 'HOTEL', 'CLINIC']);
  });

  it('resolves the whole departmental family to RETAIL_STORE', () => {
    expect(resolveCanonicalBusinessTypeKey('DEPARTMENTAL_STORE')).toBe('RETAIL_STORE');
    expect(resolveCanonicalBusinessTypeKey('Departmental Store')).toBe('RETAIL_STORE');
    expect(resolveCanonicalBusinessTypeKey('DEPARTMENT_STORE')).toBe('RETAIL_STORE');
    expect(resolveCanonicalBusinessTypeKey('STORE')).toBe('RETAIL_STORE');
    expect(resolveCanonicalBusinessTypeKey('SUPERMARKET')).toBe('RETAIL_STORE');
    expect(resolveCanonicalBusinessTypeKey('GROCERY_STORE')).toBe('RETAIL_STORE');
  });

  it('passes canonical and custom values through unchanged', () => {
    expect(resolveCanonicalBusinessTypeKey('PHARMACY')).toBe('PHARMACY');
    expect(resolveCanonicalBusinessTypeKey(' retail-store ')).toBe('RETAIL_STORE');
    expect(resolveCanonicalBusinessTypeKey('CLOTHING_STORE')).toBe('CLOTHING_STORE');
    expect(resolveCanonicalBusinessTypeKey(null)).toBe('');
  });

  it('keeps weight selling for retail (incl. legacy departmental), denies it elsewhere', () => {
    expect(isWeightSellingAllowedForBusinessType('RETAIL_STORE')).toBe(true);
    expect(isWeightSellingAllowedForBusinessType('DEPARTMENTAL_STORE')).toBe(true);
    expect(isWeightSellingAllowedForBusinessType('STORE')).toBe(true);
    expect(isWeightSellingAllowedForBusinessType('PHARMACY')).toBe(false);
    expect(isWeightSellingAllowedForBusinessType('HOTEL')).toBe(false);
    expect(isWeightSellingAllowedForBusinessType('CLINIC')).toBe(false);
  });

  it('denies the pharmacy pack to a legacy departmental business (resolves to retail)', () => {
    expect(isModuleApplicableToBusinessType('prescriptions', 'DEPARTMENTAL_STORE')).toBe(false);
    expect(isModuleApplicableToBusinessType('prescriptions', 'PHARMACY')).toBe(true);
    expect(isModuleApplicableToBusinessType('rooms', 'RETAIL_STORE')).toBe(false);
    expect(isModuleApplicableToBusinessType('sales', 'DEPARTMENTAL_STORE')).toBe(true);
  });
});

describe('per-industry category types', () => {
  it('gives each industry its own set', () => {
    expect(getAllowedCategoryTypes('PHARMACY')).toEqual(['MEDICAL', 'NON_MEDICAL', 'GENERAL']);
    expect(getAllowedCategoryTypes('RETAIL_STORE')).toEqual(['FOOD', 'NON_FOOD', 'GENERAL']);
    expect(getAllowedCategoryTypes('HOTEL')).toEqual(['GENERAL']);
    expect(getAllowedCategoryTypes('CLINIC')).toEqual(['GENERAL']);
  });

  it('resolves legacy departmental businesses to the retail set', () => {
    expect(getAllowedCategoryTypes('DEPARTMENTAL_STORE')).toEqual(['FOOD', 'NON_FOOD', 'GENERAL']);
  });

  it('accepts FOOD for retail and rejects MEDICAL; vice-versa for pharmacy', () => {
    expect(isCategoryTypeAllowed('RETAIL_STORE', 'FOOD')).toBe(true);
    expect(isCategoryTypeAllowed('RETAIL_STORE', 'NON_FOOD')).toBe(true);
    expect(isCategoryTypeAllowed('RETAIL_STORE', 'MEDICAL')).toBe(false);
    expect(isCategoryTypeAllowed('RETAIL_STORE', 'NON_MEDICAL')).toBe(false);
    expect(isCategoryTypeAllowed('PHARMACY', 'MEDICAL')).toBe(true);
    expect(isCategoryTypeAllowed('PHARMACY', 'NON_MEDICAL')).toBe(true);
    expect(isCategoryTypeAllowed('PHARMACY', 'FOOD')).toBe(false);
    expect(isCategoryTypeAllowed('HOTEL', 'GENERAL')).toBe(true);
    expect(isCategoryTypeAllowed('HOTEL', 'FOOD')).toBe(false);
    expect(isCategoryTypeAllowed('CLINIC', 'MEDICAL')).toBe(false);
  });

  it('falls through to the legacy set when the business type is unknown', () => {
    expect(isCategoryTypeAllowed(undefined, 'MEDICAL')).toBe(true);
    expect(isCategoryTypeAllowed('SOME_CUSTOM_TYPE', 'NON_MEDICAL')).toBe(true);
  });

  it('resolves the owning business type via company, else via branch', async () => {
    const prisma: any = {
      business: { findUnique: jest.fn().mockResolvedValue({ businessType: 'RETAIL_STORE' }) },
      branch: { findUnique: jest.fn().mockResolvedValue({ companyId: 'biz-1' }) },
    };
    await expect(resolveBusinessTypeForCategoryScope(prisma, { companyId: 'biz-1' })).resolves.toBe('RETAIL_STORE');
    await expect(resolveBusinessTypeForCategoryScope(prisma, { branchId: 'br-1' })).resolves.toBe('RETAIL_STORE');
    await expect(resolveBusinessTypeForCategoryScope(prisma, {})).resolves.toBeNull();
  });
});

describe('starter category seeding (new businesses only)', () => {
  function buildCategoryPrisma(existingCount: number, failOnName?: string) {
    const created: any[] = [];
    const prisma: any = {
      category: {
        count: jest.fn().mockResolvedValue(existingCount),
        create: jest.fn(async ({ data }: any) => {
          if (failOnName && data.name === failOnName) {
            throw new Error('Unique constraint failed');
          }
          created.push(data);
          return data;
        }),
      },
    };
    return { prisma, created };
  }

  it('seeds the 18 pharmacy starters for a new pharmacy business, exactly once', async () => {
    const { prisma, created } = buildCategoryPrisma(0);
    const first = await seedDefaultCategoriesForBusiness(prisma, {
      businessId: 'biz-p', branchId: 'br-1', businessType: 'PHARMACY', createdBy: 'user-1',
    });
    expect(first).toBe(18);
    expect(created).toHaveLength(PHARMACY_STARTER_CATEGORIES.length);
    expect(created.find((c) => c.name === 'Antibiotics')?.type).toBe('MEDICAL');
    expect(created.find((c) => c.name === 'Baby Care')?.type).toBe('NON_MEDICAL');
    expect(created.find((c) => c.name === 'General')?.type).toBe('GENERAL');
    expect(created.every((c) => c.companyId === 'biz-p' && c.branchId === 'br-1' && c.createdBy === 'user-1')).toBe(true);

    // Second run: the branch now has categories → no-op.
    prisma.category.count.mockResolvedValue(created.length);
    const second = await seedDefaultCategoriesForBusiness(prisma, {
      businessId: 'biz-p', branchId: 'br-1', businessType: 'PHARMACY', createdBy: 'user-1',
    });
    expect(second).toBe(0);
    expect(prisma.category.create).toHaveBeenCalledTimes(18);
  });

  it('seeds the retail starters for a new retail business', async () => {
    const { prisma, created } = buildCategoryPrisma(0);
    const count = await seedDefaultCategoriesForBusiness(prisma, {
      businessId: 'biz-r', branchId: 'br-9', businessType: 'RETAIL_STORE', createdBy: 'user-1',
    });
    expect(count).toBe(RETAIL_STARTER_CATEGORIES.length);
    expect(created.find((c) => c.name === 'Grocery & Staples')?.type).toBe('FOOD');
    expect(created.find((c) => c.name === 'Personal Care')?.type).toBe('NON_FOOD');
    expect(created.find((c) => c.name === 'General')?.type).toBe('GENERAL');
  });

  it('never injects categories into an existing business', async () => {
    const { prisma } = buildCategoryPrisma(5);
    const count = await seedDefaultCategoriesForBusiness(prisma, {
      businessId: 'biz-old', branchId: 'br-1', businessType: 'RETAIL_STORE', createdBy: 'user-1',
    });
    expect(count).toBe(0);
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it('does not seed hotel or clinic businesses', async () => {
    const { prisma } = buildCategoryPrisma(0);
    for (const businessType of ['HOTEL', 'CLINIC']) {
      const count = await seedDefaultCategoriesForBusiness(prisma, {
        businessId: 'biz-h', branchId: 'br-1', businessType, createdBy: 'user-1',
      });
      expect(count).toBe(0);
    }
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it('survives a single duplicate-name failure and seeds the rest', async () => {
    const { prisma, created } = buildCategoryPrisma(0, 'General');
    const count = await seedDefaultCategoriesForBusiness(prisma, {
      businessId: 'biz-r', branchId: 'br-1', businessType: 'RETAIL_STORE', createdBy: 'user-1',
    });
    expect(count).toBe(RETAIL_STARTER_CATEGORIES.length - 1);
    expect(created).toHaveLength(RETAIL_STARTER_CATEGORIES.length - 1);
  });
});

describe('boot migration: ensureBusinessTypesExist', () => {
  const typeRows: Record<string, any> = {
    PHARMACY: { id: 'PHARMACY', name: 'PHARMACY', description: 'Pharmacy and medical stores' },
    RETAIL_STORE: { id: 'RETAIL_STORE', name: 'RETAIL_STORE', description: 'Retail stores (including departmental stores)' },
    HOTEL: { id: 'HOTEL', name: 'HOTEL', description: 'Hotels and hospitality' },
    CLINIC: { id: 'CLINIC', name: 'CLINIC', description: 'Medical clinics' },
    DEPARTMENTAL_STORE: { id: 'DEPARTMENTAL_STORE', name: 'DEPARTMENTAL_STORE', description: 'General retail and departmental stores' },
  };

  function buildBootPrisma(opts: { departmentalBusinesses: any[]; remainingDepartmental: number; deptRow: any }) {
    return {
      businessType: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.name === 'DEPARTMENTAL_STORE' ? opts.deptRow : (typeRows[where.name] ?? null)),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      business: {
        findMany: jest.fn().mockResolvedValue(opts.departmentalBusinesses),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(opts.remainingDepartmental),
      },
      category: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      branch: { findMany: jest.fn().mockResolvedValue([{ id: 'br-main' }]) },
      businessTypePage: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      businessTypeModule: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      moduleDefinition: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ cnt: 1 }]),
    };
  }

  it('rewrites DEPARTMENTAL_STORE → RETAIL_STORE, remaps its categories, retires the row', async () => {
    const prisma = buildBootPrisma({
      departmentalBusinesses: [{ id: 'biz-gs' }],
      remainingDepartmental: 0,
      deptRow: typeRows.DEPARTMENTAL_STORE,
    });
    mockedGetPrisma.mockResolvedValue(prisma as any);

    await ensureBusinessTypesExist();

    // The merge rewrite itself.
    expect(prisma.business.updateMany).toHaveBeenCalledWith({
      where: { businessType: 'DEPARTMENTAL_STORE' },
      data: { businessType: 'RETAIL_STORE' },
    });
    // No departmental type is (re)seeded.
    const createdTypes = prisma.businessType.create.mock.calls.map((c: any[]) => c[0].data.name);
    expect(createdTypes).not.toContain('DEPARTMENTAL_STORE');
    // Category remap for the merged business only.
    expect(prisma.category.updateMany).toHaveBeenCalledWith({
      where: { companyId: { in: ['biz-gs'] }, type: 'NON_MEDICAL' },
      data: { type: 'NON_FOOD' },
    });
    expect(prisma.category.updateMany).toHaveBeenCalledWith({
      where: { companyId: { in: ['biz-gs'] }, type: 'MEDICAL' },
      data: { type: 'GENERAL' },
    });
    // Legacy row retirement: join rows first, then the row.
    expect(prisma.businessTypePage.deleteMany).toHaveBeenCalledWith({ where: { businessTypeId: 'DEPARTMENTAL_STORE' } });
    expect(prisma.businessTypeModule.deleteMany).toHaveBeenCalledWith({ where: { businessTypeId: 'DEPARTMENTAL_STORE' } });
    expect(prisma.businessType.delete).toHaveBeenCalledWith({ where: { id: 'DEPARTMENTAL_STORE' } });
  });

  it('is idempotent: a second boot finds nothing to merge, remap or retire', async () => {
    const prisma = buildBootPrisma({
      departmentalBusinesses: [],
      remainingDepartmental: 0,
      deptRow: null,
    });
    mockedGetPrisma.mockResolvedValue(prisma as any);

    await ensureBusinessTypesExist();

    expect(prisma.category.updateMany).not.toHaveBeenCalled();
    expect(prisma.businessType.delete).not.toHaveBeenCalled();
    expect(prisma.businessTypePage.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the legacy row while any business still references DEPARTMENTAL_STORE', async () => {
    const prisma = buildBootPrisma({
      departmentalBusinesses: [{ id: 'biz-gs' }],
      remainingDepartmental: 1, // rewrite did not land (e.g. older DB) → do not retire
      deptRow: typeRows.DEPARTMENTAL_STORE,
    });
    mockedGetPrisma.mockResolvedValue(prisma as any);

    await ensureBusinessTypesExist();

    expect(prisma.businessType.delete).not.toHaveBeenCalled();
  });
});

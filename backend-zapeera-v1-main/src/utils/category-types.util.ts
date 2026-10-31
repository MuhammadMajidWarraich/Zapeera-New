/**
 * Per-industry category types (business-types overhaul, 2026-10-31).
 *
 * Category.type stays a free String on the Category row, but the VALUES
 * a business may use now depend on its industry — Muhammad's standing
 * rule (2026-10-26): a business type gets only its own things. Before
 * this overhaul one universal pharmacy-flavoured set
 * (MEDICAL / NON_MEDICAL / GENERAL) was offered to every industry, so a
 * grocery store's category form literally asked "Medical / Non-Medical".
 *
 *   PHARMACY     → MEDICAL / NON_MEDICAL / GENERAL   (unchanged)
 *   RETAIL_STORE → FOOD / NON_FOOD / GENERAL         (departmental
 *                  stores merged into retail on 2026-10-31; their
 *                  stored NON_MEDICAL → NON_FOOD and MEDICAL → GENERAL
 *                  remap runs in the boot migration, modules.util)
 *   HOTEL        → GENERAL only (no type selector in the UI)
 *   CLINIC       → GENERAL only (no type selector in the UI)
 *
 * Non-canonical / backoffice-defined custom types keep the legacy set
 * (the codebase-wide fall-through convention for unknown types, same
 * as module-applicability.util). The frontend mirrors these sets
 * (src/utils/category-types.ts) so the UI never offers a type the API
 * would refuse.
 */
import {
  normalizeBusinessTypeKey,
  resolveCanonicalBusinessTypeKey,
} from './module-applicability.util';

export const PHARMACY_CATEGORY_TYPES = ['MEDICAL', 'NON_MEDICAL', 'GENERAL'] as const;
export const RETAIL_CATEGORY_TYPES = ['FOOD', 'NON_FOOD', 'GENERAL'] as const;
export const GENERAL_ONLY_CATEGORY_TYPES = ['GENERAL'] as const;

/** Pre-overhaul universal set — retained ONLY as the fall-through for
 *  non-canonical / custom business types (legacy behaviour). */
export const LEGACY_CATEGORY_TYPES = PHARMACY_CATEGORY_TYPES;

export const CATEGORY_TYPES_BY_BUSINESS_TYPE: Readonly<Record<string, readonly string[]>> = {
  PHARMACY: PHARMACY_CATEGORY_TYPES,
  RETAIL_STORE: RETAIL_CATEGORY_TYPES,
  HOTEL: GENERAL_ONLY_CATEGORY_TYPES,
  CLINIC: GENERAL_ONLY_CATEGORY_TYPES,
};

/** Allowed Category.type values for a business of the given type. */
export function getAllowedCategoryTypes(businessType: unknown): readonly string[] {
  const canonical = resolveCanonicalBusinessTypeKey(businessType);
  return CATEGORY_TYPES_BY_BUSINESS_TYPE[canonical] || LEGACY_CATEGORY_TYPES;
}

export function isCategoryTypeAllowed(businessType: unknown, categoryType: unknown): boolean {
  const type = String(categoryType || '').trim().toUpperCase();
  return getAllowedCategoryTypes(businessType).includes(type);
}

/**
 * Resolve the businessType of the business that owns a category scope:
 * directly via companyId (categories.companyId → businesses.id), else
 * via branchId → branches.companyId → businesses. Returns null when no
 * business resolves (orphaned legacy rows) — callers then fall back to
 * the legacy type set, preserving pre-overhaul behaviour for them.
 */
export async function resolveBusinessTypeForCategoryScope(
  prisma: any,
  scope: { companyId?: string | null; branchId?: string | null }
): Promise<string | null> {
  const companyId = scope.companyId ? String(scope.companyId) : '';
  if (companyId) {
    const business = await prisma.business.findUnique({
      where: { id: companyId },
      select: { businessType: true }
    });
    if (business) return business.businessType ?? null;
  }
  const branchId = scope.branchId ? String(scope.branchId) : '';
  if (branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { companyId: true }
    });
    if (branch?.companyId) {
      const business = await prisma.business.findUnique({
        where: { id: branch.companyId },
        select: { businessType: true }
      });
      if (business) return business.businessType ?? null;
    }
  }
  return null;
}

// ─── Starter categories for NEW businesses ─────────────────────────────
// Seeded once, at business creation (company.controller createCompany),
// for PHARMACY and RETAIL_STORE only, into the business's Main Branch.
// The pharmacy set is the established 18 from prisma/seed-pharmacy.ts
// (10 MEDICAL / 7 NON_MEDICAL / 1 GENERAL). The retail set mirrors the
// same shape for a general store (4 FOOD / 2 NON_FOOD / 1 GENERAL).
// Owners can rename/delete them afterwards — they are a starting point,
// never re-imposed (seeding is skipped when the branch already has any
// category, and it NEVER runs for existing businesses).

export interface StarterCategory {
  name: string;
  description: string;
  type: string;
  color: string;
}

export const PHARMACY_STARTER_CATEGORIES: readonly StarterCategory[] = [
  // Medical
  { name: 'Antibiotics', description: 'Antibiotic medications for bacterial infections', type: 'MEDICAL', color: '#EF4444' },
  { name: 'Painkillers', description: 'Pain relief medications', type: 'MEDICAL', color: '#F59E0B' },
  { name: 'Vitamins', description: 'Vitamin supplements', type: 'MEDICAL', color: '#10B981' },
  { name: 'Cardiovascular', description: 'Heart and blood pressure medications', type: 'MEDICAL', color: '#3B82F6' },
  { name: 'Diabetes', description: 'Diabetes management medications', type: 'MEDICAL', color: '#8B5CF6' },
  { name: 'Respiratory', description: 'Respiratory system medications', type: 'MEDICAL', color: '#EC4899' },
  { name: 'Digestive', description: 'Digestive system medications', type: 'MEDICAL', color: '#14B8A6' },
  { name: 'Skin Care', description: 'Dermatology products', type: 'MEDICAL', color: '#F97316' },
  { name: 'Eye Care', description: 'Ophthalmology products', type: 'MEDICAL', color: '#6366F1' },
  { name: 'Allergy', description: 'Allergy relief medications', type: 'MEDICAL', color: '#F43F5E' },
  // Non-Medical
  { name: 'Personal Care', description: 'Personal hygiene products', type: 'NON_MEDICAL', color: '#84CC16' },
  { name: 'Baby Care', description: 'Baby products and accessories', type: 'NON_MEDICAL', color: '#06B6D4' },
  { name: 'Beauty & Cosmetics', description: 'Beauty and cosmetic products', type: 'NON_MEDICAL', color: '#EC4899' },
  { name: 'Health Devices', description: 'Health monitoring devices', type: 'NON_MEDICAL', color: '#8B5CF6' },
  { name: 'First Aid', description: 'First aid supplies', type: 'NON_MEDICAL', color: '#F97316' },
  { name: 'Nutritional Supplements', description: 'Protein and nutritional supplements', type: 'NON_MEDICAL', color: '#10B981' },
  { name: 'Dental Care', description: 'Dental hygiene products', type: 'NON_MEDICAL', color: '#3B82F6' },
  // General
  { name: 'General', description: 'General pharmacy items', type: 'GENERAL', color: '#6B7280' },
];

export const RETAIL_STARTER_CATEGORIES: readonly StarterCategory[] = [
  // Food
  { name: 'Grocery & Staples', description: 'Everyday grocery and staple foods', type: 'FOOD', color: '#10B981' },
  { name: 'Beverages', description: 'Drinks, juices and bottled water', type: 'FOOD', color: '#06B6D4' },
  { name: 'Snacks & Confectionery', description: 'Snacks, biscuits, chocolates and sweets', type: 'FOOD', color: '#F59E0B' },
  { name: 'Dairy & Bakery', description: 'Milk, eggs, bread and bakery items', type: 'FOOD', color: '#F97316' },
  // Non-Food
  { name: 'Personal Care', description: 'Personal hygiene and grooming products', type: 'NON_FOOD', color: '#84CC16' },
  { name: 'Household & Cleaning', description: 'Cleaning supplies and household essentials', type: 'NON_FOOD', color: '#8B5CF6' },
  // General
  { name: 'General', description: 'General store items', type: 'GENERAL', color: '#6B7280' },
];

export const STARTER_CATEGORIES_BY_BUSINESS_TYPE: Readonly<Record<string, readonly StarterCategory[]>> = {
  PHARMACY: PHARMACY_STARTER_CATEGORIES,
  RETAIL_STORE: RETAIL_STARTER_CATEGORIES,
};

/**
 * Seed the starter category set for a NEWLY created business.
 * Returns the number of categories created. No-ops (returns 0) when:
 * the industry has no starter set (HOTEL / CLINIC / custom), or the
 * branch already has any category (never inject into existing data).
 */
export async function seedDefaultCategoriesForBusiness(
  prisma: any,
  args: { businessId: string; branchId: string; businessType: unknown; createdBy?: string | null }
): Promise<number> {
  const canonical = resolveCanonicalBusinessTypeKey(args.businessType);
  const starters = STARTER_CATEGORIES_BY_BUSINESS_TYPE[canonical];
  if (!starters || !args.businessId || !args.branchId) return 0;

  const existingCount = await prisma.category.count({ where: { branchId: args.branchId } });
  if (existingCount > 0) return 0;

  let created = 0;
  for (const starter of starters) {
    try {
      await prisma.category.create({
        data: {
          name: starter.name,
          description: starter.description,
          type: starter.type,
          color: starter.color,
          branchId: args.branchId,
          companyId: args.businessId,
          createdBy: args.createdBy || null,
        }
      });
      created++;
    } catch (err: any) {
      // Unique (name, branchId) or a concurrent create — skip that one,
      // never fail business creation over a starter category.
      console.warn(`[Categories] Starter category "${starter.name}" skipped:`, err?.message || err);
    }
  }
  return created;
}

export { normalizeBusinessTypeKey };

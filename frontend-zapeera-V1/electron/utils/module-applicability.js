/**
 * Module → business-type applicability (embedded port of
 * backend-zapeera-v1-main/src/utils/module-applicability.util.ts).
 *
 * The map is the code-level authority for which industry pack a
 * business type may use. It is enforced as a HARD DENY by
 * requireModule() in the embedded routes (mirroring the cloud's
 * checkModule middleware, which returns 403
 * MODULE_NOT_APPLICABLE_TO_BUSINESS_TYPE).
 *
 * RULES (same as the cloud):
 * - A module NOT listed here applies to ALL business types (the shared
 *   core: dashboard, sales, inventory, purchases, reports,
 *   business_management, expenses, subscription, employee_portal,
 *   stock_takes, and everything inside the sales/inventory families).
 * - A module listed here applies ONLY to the listed canonical types.
 * - Enforcement applies to the four canonical business types. A custom /
 *   unknown type falls through (returns true), preserving legacy
 *   behaviour for backoffice-defined types.
 * - Business-types overhaul (2026-10-31): DEPARTMENTAL_STORE merged
 *   into RETAIL_STORE; legacy departmental values resolve to retail.
 */
const CANONICAL_BUSINESS_TYPES = [
  'PHARMACY',
  'RETAIL_STORE',
  'HOTEL',
  'CLINIC'
];

const LEGACY_BUSINESS_TYPE_ALIASES = {
  STORE: 'RETAIL_STORE',
  DEPARTMENT_STORE: 'RETAIL_STORE',
  DEPARTMENTAL_STORE: 'RETAIL_STORE',
  SUPERMARKET: 'RETAIL_STORE',
  GROCERY_STORE: 'RETAIL_STORE'
};

/** module key (normalized) → the ONLY canonical business types it belongs to. */
const MODULE_BUSINESS_TYPE_APPLICABILITY = {
  // Pharmacy pack
  prescriptions: ['PHARMACY'],
  // Clinic pack
  patients: ['CLINIC'],
  doctors: ['CLINIC'],
  appointments: ['CLINIC'],
  // Hotel pack
  rooms: ['HOTEL'],
  reservations: ['HOTEL'],
  folios: ['HOTEL'],
  front_desk: ['HOTEL']
};

/** The module keys the desktop sidebar / /api/modules/enabled knows. */
const STANDARD_MODULES = [
  { name: 'sales', sortOrder: 1 },
  { name: 'inventory', sortOrder: 2 },
  { name: 'purchases', sortOrder: 3 },
  { name: 'reports', sortOrder: 4 },
  { name: 'prescriptions', sortOrder: 5 },
  { name: 'business_management', sortOrder: 6 },
  { name: 'expenses', sortOrder: 7 },
  { name: 'subscription', sortOrder: 8 },
  { name: 'patients', sortOrder: 9 },
  { name: 'doctors', sortOrder: 10 },
  { name: 'appointments', sortOrder: 11 },
  { name: 'rooms', sortOrder: 12 },
  { name: 'reservations', sortOrder: 13 },
  { name: 'folios', sortOrder: 14 },
  { name: 'front_desk', sortOrder: 15 },
  { name: 'stock_takes', sortOrder: 16 }
];

function normalizeModuleKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeBusinessTypeKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function resolveCanonicalBusinessTypeKey(value) {
  const key = normalizeBusinessTypeKey(value);
  return LEGACY_BUSINESS_TYPE_ALIASES[key] || key;
}

function isCanonicalBusinessType(value) {
  return CANONICAL_BUSINESS_TYPES.includes(resolveCanonicalBusinessTypeKey(value));
}

/**
 * True when `moduleKey` may be used by a business of type `businessType`.
 * Unlisted modules → all types. Listed modules → only the listed
 * canonical types; non-canonical/unknown types are NOT decided here
 * (returns true so the legacy behaviour is preserved for custom types).
 * Legacy aliases resolve to their canonical type first.
 */
function isModuleApplicableToBusinessType(moduleKey, businessType) {
  const allowed = MODULE_BUSINESS_TYPE_APPLICABILITY[normalizeModuleKey(moduleKey)];
  if (!allowed) return true;
  const typeKey = resolveCanonicalBusinessTypeKey(businessType);
  if (!CANONICAL_BUSINESS_TYPES.includes(typeKey)) return true;
  return allowed.includes(typeKey);
}

/**
 * The enabled-modules list for one business type, in the shape the
 * frontend expects from /api/modules/enabled and
 * /api/business-types/:id/modules: [{ name, enabled, sortOrder }].
 * `businessType` may be null/unknown — then every module reports
 * enabled (legacy fall-through; the caller cannot know the type).
 */
function modulesForBusinessType(businessType) {
  return STANDARD_MODULES.map((m) => ({
    name: m.name,
    enabled: isModuleApplicableToBusinessType(m.name, businessType),
    sortOrder: m.sortOrder
  }));
}

/**
 * Express middleware factory mirroring the cloud's checkModule.
 * Resolves the business type from the caller's company (via
 * getDataFilter's companyFilter, else the user's own company) and 403s
 * with MODULE_NOT_APPLICABLE_TO_BUSINESS_TYPE when the module does not
 * apply. Unknown/absent company → falls through (cannot decide; the
 * route's own scoping still applies).
 * @param {string} moduleKey e.g. 'prescriptions'
 * @param {object} helpers { query, getDataFilter }
 */
function requireModule(moduleKey, helpers) {
  const { query, getDataFilter } = helpers;
  return (req, res, next) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      const companyId = companyFilter || req.user?.companyId || null;
      if (!companyId) return next();
      const company = query('SELECT businessType FROM companies WHERE id = ?', [companyId])[0];
      const businessType = company ? company.businessType : null;
      if (!businessType) return next();
      if (!isModuleApplicableToBusinessType(moduleKey, businessType)) {
        return res.status(403).json({
          success: false,
          message: `Module '${moduleKey}' is not available for this business type.`,
          details: { module: moduleKey, code: 'MODULE_NOT_APPLICABLE_TO_BUSINESS_TYPE' }
        });
      }
      return next();
    } catch (e) {
      console.error('[ModuleGate] error:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };
}

/**
 * Role gate factory: allows only the listed roles (plus SUPERADMIN,
 * which bypasses every role gate on the desktop). Mirrors the cloud
 * role matrix for the endpoint at hand — see each call site for which
 * cloud grant it mirrors.
 */
function requireRole(allowedRoles) {
  const allowed = new Set([...(allowedRoles || []), 'SUPERADMIN']);
  return (req, res, next) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (role === 'SUPERADMIN' || allowed.has(role)) return next();
    return res.status(403).json({
      success: false,
      message: 'This action requires an OWNER or MANAGER role.',
      code: 'ROLE_NOT_ALLOWED'
    });
  };
}

module.exports = {
  CANONICAL_BUSINESS_TYPES,
  MODULE_BUSINESS_TYPE_APPLICABILITY,
  STANDARD_MODULES,
  normalizeModuleKey,
  normalizeBusinessTypeKey,
  isCanonicalBusinessType,
  isModuleApplicableToBusinessType,
  modulesForBusinessType,
  requireModule,
  requireRole
};

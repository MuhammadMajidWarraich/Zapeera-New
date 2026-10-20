/**
 * Standard roles bootstrap (Round-2 fix, 2026-10-21).
 *
 * The defect this closes: businesses only ever got an OWNER role row.
 * Staff creation looked up MANAGER/CASHIER roles by name, found none,
 * and linked memberships with roleId = NULL — and no code anywhere
 * published a default role policy. In the V2 authorization system a
 * membership without a configured role is denied EVERYTHING (payload
 * and API), so real staff could log in but saw an empty, locked
 * workspace. Owners never noticed: the business creator gets a
 * synthesized OWNER identity that bypasses the role gate.
 *
 * This service makes the standard roles real:
 * - find-or-create OWNER / MANAGER / CASHIER Role rows per business;
 * - for MANAGER and CASHIER, publish a default RolePermissionV2 policy
 *   derived from MODULE_HIERARCHY's own roles[] intent (the same map
 *   the product ships as its statement of which roles get which page),
 *   but ONLY while the role is UNCONFIGURED — an admin-published policy
 *   (Backoffice policies API) is never overwritten.
 *
 * Default operations: MANAGER is the trusted deputy (full ops incl.
 * delete/approve/export); CASHIER is counter-safe (read/create/update/
 * print — no delete, no export, no approve; refunds stay manager-only
 * because the hierarchy already limits the refunds page to
 * OWNER/MANAGER for reads, and approve is never granted to CASHIER).
 */
import { MODULE_HIERARCHY } from '../config/module-hierarchy';

export const STANDARD_ROLE_NAMES = ['OWNER', 'MANAGER', 'CASHIER'] as const;

const ROLE_OPS: Record<string, string[]> = {
  MANAGER: ['read', 'create', 'update', 'delete', 'export', 'print', 'approve'],
  CASHIER: ['read', 'create', 'update', 'print'],
};

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// pageRoles: "moduleKey::pageKey" -> role names allowed on that page,
// built once from the hierarchy config. Module defaultRoles cover the
// module's 'overview' page and any page without an explicit entry.
const pageRolesCache = (() => {
  const map = new Map<string, string[]>();
  const defaults = new Map<string, string[]>();
  for (const mod of MODULE_HIERARCHY as any[]) {
    const moduleKey = normalizeKey(mod.module);
    const def: string[] = (mod.defaultRoles || ['OWNER']).map((r: string) => String(r).toUpperCase());
    defaults.set(moduleKey, def);
    for (const sub of mod.subModules || []) {
      const roles = (sub.roles && sub.roles.length > 0 ? sub.roles : def).map((r: string) => String(r).toUpperCase());
      map.set(`${moduleKey}::${normalizeKey(sub.key)}`, roles);
    }
  }
  return { map, defaults };
})();

function rolesForPage(moduleKey: string, pageKey: string): string[] {
  return (
    pageRolesCache.map.get(`${moduleKey}::${pageKey}`) ||
    pageRolesCache.defaults.get(moduleKey) ||
    ['OWNER']
  );
}

/**
 * Find-or-create a role in a business; for standard staff roles also
 * ensure a default policy exists. Returns the role row.
 */
export async function ensureRoleWithPolicy(prisma: any, businessId: string, roleNameRaw: string): Promise<any> {
  const roleName = String(roleNameRaw || '').trim().toUpperCase();
  if (!roleName) throw new Error('roleName is required');

  let role = await prisma.role.findFirst({ where: { businessId, name: roleName } });
  if (!role) {
    role = await prisma.role.create({
      data: {
        businessId,
        name: roleName,
        isSystem: (STANDARD_ROLE_NAMES as readonly string[]).includes(roleName),
      },
    });
  }

  const ops = ROLE_OPS[roleName];
  if (ops && String(role.permissionState || 'UNCONFIGURED').toUpperCase() !== 'CONFIGURED') {
    const pages = await prisma.modulePage.findMany({
      where: { isActive: true },
      include: { module: { select: { key: true } } },
    });

    const rows: Array<{ roleId: string; modulePageId: string; operationKey: string; allowed: boolean; scope: string }> = [];
    for (const page of pages || []) {
      const moduleKey = normalizeKey(page.module?.key || '');
      const pageKey = normalizeKey(page.key || '');
      if (!moduleKey || !pageKey) continue;
      if (!rolesForPage(moduleKey, pageKey).includes(roleName)) continue;
      for (const operationKey of ops) {
        rows.push({ roleId: role.id, modulePageId: page.id, operationKey, allowed: true, scope: 'BUSINESS' });
      }
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.rolePermissionV2.deleteMany({ where: { roleId: role.id } });
      if (rows.length > 0) {
        await tx.rolePermissionV2.createMany({ data: rows });
      }
      role = await tx.role.update({
        where: { id: role.id },
        data: { permissionState: 'CONFIGURED', policyVersion: { increment: 1 } },
      });
    });
  }

  return role;
}

/**
 * Ensure all standard roles (OWNER/MANAGER/CASHIER) exist in a business
 * with their default policies. Idempotent; safe to call on every
 * business creation and staff operation.
 */
export async function ensureStandardRoles(prisma: any, businessId: string): Promise<void> {
  for (const name of STANDARD_ROLE_NAMES) {
    await ensureRoleWithPolicy(prisma, businessId, name);
  }
}

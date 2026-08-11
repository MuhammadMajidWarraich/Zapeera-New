import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  getPermittedOperationsByPage,
  FULL_OPERATION_SET,
  resetFallbackOperationGrantCount,
  getFallbackOperationGrantCount,
} from '../src/utils/modules-v2.util';
import { resolveModuleOperation } from '../src/config/module-route-protection.config';
import { enforceOperation } from '../src/middleware/universal-module-protection.middleware';

// ── Fake data for getPermittedOperationsByPage ───────────────────────────

const pages = [
  { id: 'page-products', moduleId: 'm-inventory', key: 'products' },
  { id: 'page-categories', moduleId: 'm-inventory', key: 'categories' },
  { id: 'page-overview', moduleId: 'm-inventory', key: 'overview' },
];

const moduleDef = { id: 'm-inventory', key: 'inventory', name: 'Inventory' };

function fakePrisma() {
  return {
    modulePage: {
      findMany: async ({ where }: any) => pages.filter((p) => p.moduleId === where.moduleId),
    },
  } as any;
}

function membershipWith(permissionsV2: any[], roleName = 'MANAGER', permissionState = 'CONFIGURED') {
  return { role: { name: roleName, permissionState, permissionsV2 } };
}

// ── Issue 4: page-specific operation permissions ─────────────────────────

describe('getPermittedOperationsByPage (Issue 4 — page-specific permissions)', () => {
  beforeEach(() => {
    resetFallbackOperationGrantCount();
  });

  it('grants an operation on one page and NOT on another page of the same module', async () => {
    const result = await getPermittedOperationsByPage(
      fakePrisma(),
      moduleDef,
      membershipWith([{ modulePageId: 'page-products', operationKey: 'create', allowed: true }])
    );

    // Products page: create granted.
    expect(result.pageOperations['products']).toEqual({ allowedOperations: ['create'], blockedOperations: [] });
    // Categories page: NOT granted — permission does not leak across pages.
    expect(result.pageOperations['categories']).toEqual({ allowedOperations: [], blockedOperations: [] });
    // Module union still contains the granted ops (sidebar rendering).
    expect(result.allowedOperations).toContain('create');
    expect(result.fallbackFullOps).toBe(false);
  });

  it('tracks blocked operations per page', async () => {
    const result = await getPermittedOperationsByPage(
      fakePrisma(),
      moduleDef,
      membershipWith([
        { modulePageId: 'page-products', operationKey: 'delete', allowed: false },
        { modulePageId: 'page-products', operationKey: 'read', allowed: true },
      ])
    );

    expect(result.pageOperations['products']).toEqual({
      allowedOperations: ['read'],
      blockedOperations: ['delete'],
    });
  });

  it('denies ALL operations for a CONFIGURED role with zero V2 rows (migration fallback removed)', async () => {
    resetFallbackOperationGrantCount();
    const result = await getPermittedOperationsByPage(fakePrisma(), moduleDef, membershipWith([]));

    expect(result.fallbackFullOps).toBe(false);
    expect(result.allowedOperations).toEqual([]);
    expect(result.pageOperations['products']).toEqual({ allowedOperations: [], blockedOperations: [] });
    expect(getFallbackOperationGrantCount()).toBe(0);
  });

  it('grants FULL operations to the OWNER system role on every page', async () => {
    const result = await getPermittedOperationsByPage(fakePrisma(), moduleDef, membershipWith([], 'OWNER', 'UNCONFIGURED'));

    expect(result.fallbackFullOps).toBe(false);
    expect(result.allowedOperations.sort()).toEqual([...FULL_OPERATION_SET].sort());
    expect(result.pageOperations['products'].allowedOperations.sort()).toEqual([...FULL_OPERATION_SET].sort());
    expect(result.pageOperations['categories'].allowedOperations.sort()).toEqual([...FULL_OPERATION_SET].sort());
    expect(getFallbackOperationGrantCount()).toBe(0);
  });

  it('denies everything for a role with NO published policy (UNCONFIGURED), even with V2 rows present', async () => {
    const result = await getPermittedOperationsByPage(
      fakePrisma(),
      moduleDef,
      membershipWith([{ modulePageId: 'page-products', operationKey: 'create', allowed: true }], 'MANAGER', 'UNCONFIGURED')
    );

    expect(result.allowedOperations).toEqual([]);
    expect(result.pageOperations['products']).toEqual({ allowedOperations: [], blockedOperations: [] });
    expect(result.fallbackFullOps).toBe(false);
  });

  it('does not grant anything for pages with no permission rows once a role is configured', async () => {
    const result = await getPermittedOperationsByPage(
      fakePrisma(),
      moduleDef,
      membershipWith([{ modulePageId: 'page-products', operationKey: 'read', allowed: true }])
    );

    expect(result.pageOperations['categories']).toEqual({ allowedOperations: [], blockedOperations: [] });
    expect(result.fallbackFullOps).toBe(false);
  });

  it('denies for unknown roles without membership role', async () => {
    const result = await getPermittedOperationsByPage(fakePrisma(), moduleDef, {} as any);
    expect(result.allowedOperations).toEqual([]);
    expect(result.pageOperations).toEqual({});
    expect(result.fallbackFullOps).toBe(false);
  });
});

// ── Issue 4: exact page/operation enforcement at the HTTP layer ──────────

describe('enforceOperation (Issue 4 — deny when the page/operation pair is not granted)', () => {
  it('blocks write operations when a configured role has no permission for the page', () => {
    // Configured role, page has NO granted operations → POST must be blocked.
    const denied = enforceOperation('POST', '/api/inventory/products', [], false);
    expect(denied).not.toBeNull();
    expect(denied?.error).toBe('OPERATION_NOT_ALLOWED');
  });

  it('blocks operations not in the per-page allowed set', () => {
    const denied = enforceOperation('DELETE', '/api/inventory/products/1', ['read', 'create'], false);
    expect(denied).not.toBeNull();
    expect(denied?.operation).toBe('delete');
  });

  it('allows operations present in the per-page allowed set', () => {
    expect(enforceOperation('POST', '/api/inventory/products', ['read', 'create'], false)).toBeNull();
    expect(enforceOperation('PUT', '/api/inventory/products/1', ['read', 'update'], false)).toBeNull();
  });

  it('never blocks reads (baseline) even for restricted pages', () => {
    expect(enforceOperation('GET', '/api/inventory/products', [], false)).toBeNull();
  });

  it('allows everything when the legacy fallbackFullOps flag is set (retained helper contract)', () => {
    expect(enforceOperation('DELETE', '/api/inventory/products/1', FULL_OPERATION_SET, true)).toBeNull();
  });

  it('maps export/approve/print endpoints to their exact operations', () => {
    expect(resolveModuleOperation('GET', '/api/reports/export/sales')).toBe('export');
    expect(resolveModuleOperation('GET', '/api/staff/1/approve')).toBe('approve');
    expect(resolveModuleOperation('GET', '/api/reports/print')).toBe('print');
  });

  it('blocks export when the page only grants read', () => {
    const denied = enforceOperation('GET', '/api/reports/export/sales', ['read'], false);
    expect(denied).not.toBeNull();
    expect(denied?.operation).toBe('export');
  });
});

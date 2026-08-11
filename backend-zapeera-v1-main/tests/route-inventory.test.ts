import { describe, it, expect, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  classifyRoute,
  getRequiredModule,
  getRequiredPage,
  MODULE_PAGES,
  MODULE_PAGE_ROUTE_MAP,
  normalizeModulePolicyPath,
} from '../src/config/module-route-protection.config';
import {
  resolveRoutePolicy,
  normalizePolicyPath,
  ALL_REGISTERED_POLICY_PREFIXES,
} from '../src/config/route-policy.registry';
import { universalModuleProtection } from '../src/middleware/universal-module-protection.middleware';

const SERVER_TS = path.join(__dirname, '..', 'src', 'server.ts');

/** Extract every `app.use('/api...', ...)` mount from server.ts. */
function registeredApiPrefixes(): string[] {
  const source = fs.readFileSync(SERVER_TS, 'utf8');
  const prefixes: string[] = [];
  const pattern = /app\.use\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const prefix = match[1];
    if (prefix.startsWith('/api')) {
      prefixes.push(prefix);
    }
  }
  return prefixes;
}

describe('route inventory coverage (Issue 5 — fail closed for unmapped endpoints)', () => {
  it('classifies every route registered in server.ts', () => {
    const unmapped: string[] = [];
    for (const prefix of registeredApiPrefixes()) {
      // Middleware/rate-limit mounts over the whole API are not endpoints.
      const normalized = normalizeModulePolicyPath(prefix);
      if (normalized === '/api' || normalized === '/api/v1') {
        continue;
      }
      const classification = classifyRoute(prefix);
      if (classification === null) {
        unmapped.push(prefix);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('every business-scoped route resolves to a module AND a page', () => {
    const problems: string[] = [];
    for (const [prefix, { module, page }] of Object.entries(MODULE_PAGE_ROUTE_MAP)) {
      if (getRequiredModule(prefix) !== module) {
        problems.push(`${prefix}: module mismatch`);
      }
      if (getRequiredPage(prefix) !== page) {
        problems.push(`${prefix}: page mismatch`);
      }
      if (!MODULE_PAGES[module]?.includes(page)) {
        problems.push(`${prefix}: page "${page}" missing from MODULE_PAGES[${module}]`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('classifies public/health/login endpoints as available (not blocked)', () => {
    expect(classifyRoute('/api/auth/login')).toBe('bootstrap');
    expect(classifyRoute('/api/v1/auth/login')).toBe('bootstrap');
    expect(classifyRoute('/api/health')).toBe('bootstrap');
    expect(classifyRoute('/api/companies')).toBe('bootstrap');
    expect(classifyRoute('/api/v1/users/me')).toBe('bootstrap');
    expect(classifyRoute('/api/backoffice/auth/login')).toBe('backoffice');
    expect(classifyRoute('/api/users')).toBe('auth-only');
    expect(classifyRoute('/api')).toBe('bootstrap');
    expect(classifyRoute('/api/v1')).toBe('bootstrap');
  });

  it('classifies business-scoped routes as business', () => {
    expect(classifyRoute('/api/products')).toBe('business');
    expect(classifyRoute('/api/v1/products')).toBe('business');
    expect(classifyRoute('/api/staff/1/shifts')).toBe('business');
  });

  it('returns null (unknown) for unregistered endpoints', () => {
    expect(classifyRoute('/api/unknown-feature')).toBeNull();
    expect(classifyRoute('/api/secret-tool')).toBeNull();
  });
});

describe('canonical route policy registry (Phase 4 — complete classification)', () => {
  it('every route mounted in server.ts resolves to a policy in the registry', () => {
    const unmapped: string[] = [];
    for (const prefix of registeredApiPrefixes()) {
      const normalized = normalizePolicyPath(prefix);
      if (normalized === '/api' || normalized === '/api/v1') {
        continue;
      }
      if (resolveRoutePolicy(normalized) === null) {
        unmapped.push(prefix);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('classifies public/health/login endpoints as public', () => {
    expect(resolveRoutePolicy('/api/auth/login')?.kind).toBe('public');
    expect(resolveRoutePolicy('/api/v1/auth/login')?.kind).toBe('public');
    expect(resolveRoutePolicy('/api/health')?.kind).toBe('public');
    expect(resolveRoutePolicy('/api/sse')?.kind).toBe('public');
    expect(resolveRoutePolicy('/api/business-types')?.kind).toBe('public');
  });

  it('classifies account-level endpoints as auth or auth-core', () => {
    expect(resolveRoutePolicy('/api/users/me')?.kind).toBe('auth');
    expect(resolveRoutePolicy('/api/branches')?.kind).toBe('auth-core');
    expect(resolveRoutePolicy('/api/dashboard')?.kind).toBe('auth-core');
    expect(resolveRoutePolicy('/api/modules')?.kind).toBe('auth-core');
    expect(resolveRoutePolicy('/api/subscription')?.kind).toBe('billing');
  });

  it('classifies every module route with its canonical resource key', () => {
    const expectations: Array<[string, string]> = [
      ['/api/products', 'inventory.products'],
      ['/api/v1/products', 'inventory.products'],
      ['/api/inventory', 'inventory.overview'],
      ['/api/v1/sales', 'sales.invoices'],
      ['/api/pos', 'sales.pos'],
      ['/api/customers', 'customers.customers'],
      ['/api/purchases/order-purchase', 'purchases.order-purchase'],
      ['/api/staff', 'staff.staff'],
      ['/api/attendance', 'staff.attendance'],
      ['/api/shifts', 'staff.shifts'],
      ['/api/reports', 'reports.reports'],
      ['/api/expenses', 'expenses.expenses'],
      ['/api/settings', 'business_management.settings'],
      ['/api/roles', 'business_management.roles'],
    ];
    for (const [route, resourceKey] of expectations) {
      const policy = resolveRoutePolicy(route);
      expect(policy?.kind).toBe('module');
      if (policy?.kind === 'module') {
        expect(policy.resourceKey).toBe(resourceKey);
      }
    }
  });

  it('classifies backoffice routes (with public auth/setup subpaths)', () => {
    expect(resolveRoutePolicy('/api/backoffice/module-permissions/plans')?.kind).toBe('backoffice');
    expect(resolveRoutePolicy('/api/backoffice/policies/plans/x')?.kind).toBe('backoffice');
    expect(resolveRoutePolicy('/api/backoffice/auth/login')?.kind).toBe('public');
  });

  it('returns null for unregistered paths and normalizes the api version prefix', () => {
    expect(normalizePolicyPath('/api/v1/auth/login')).toBe('/api/auth/login');
    expect(resolveRoutePolicy('/api/unknown-feature')).toBeNull();
    expect(resolveRoutePolicy('/api/secret-tool')).toBeNull();
  });

  it('exposes the full registry list for auditing', () => {
    expect(ALL_REGISTERED_POLICY_PREFIXES.length).toBeGreaterThan(20);
    expect(ALL_REGISTERED_POLICY_PREFIXES).toContain('/api/inventory');
  });
});

describe('universal module protection fail-closed behavior (Issue 5)', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  function mockRes() {
    const res: any = { statusCode: 0, body: null };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: any) => {
      res.body = body;
      return res;
    };
    return res;
  }

  it('blocks unknown business endpoints in production with a machine-readable error', async () => {
    process.env.NODE_ENV = 'production';
    const req: any = { originalUrl: '/api/unknown-feature', path: '/api/unknown-feature', user: { id: 'u1' } };
    const res = mockRes();
    let calledNext = false;

    await universalModuleProtection(req, res, () => {
      calledNext = true;
    });

    expect(calledNext).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('UNMAPPED_ROUTE');
  });

  it('allows unknown routes outside production (warns instead of blocking)', async () => {
    process.env.NODE_ENV = 'test';
    const req: any = { originalUrl: '/api/unknown-feature', path: '/api/unknown-feature', user: { id: 'u1' } };
    const res = mockRes();
    let calledNext = false;

    await universalModuleProtection(req, res, () => {
      calledNext = true;
    });

    expect(calledNext).toBe(true);
  });

  it('still allows public bootstrap routes in production', async () => {
    process.env.NODE_ENV = 'production';
    const req: any = { originalUrl: '/api/health', path: '/api/health' };
    const res = mockRes();
    let calledNext = false;

    await universalModuleProtection(req, res, () => {
      calledNext = true;
    });

    expect(calledNext).toBe(true);
  });
});

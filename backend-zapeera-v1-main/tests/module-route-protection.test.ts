import {
  getRequiredModule,
  getRequiredPage,
  normalizeModulePolicyPath,
  resolveModuleOperation,
  shouldSkipModuleCheck,
} from '../src/config/module-route-protection.config';

describe('module route protection policy', () => {
  it.each([
    ['/api/products', '/api/products', 'inventory'],
    ['/api/v1/products', '/api/products', 'inventory'],
    ['/api/v1/products/abc?include=batch', '/api/products/abc', 'inventory'],
    ['/api/customers', '/api/customers', 'customers'],
    ['/api/v1/customers/customer-1', '/api/customers/customer-1', 'customers'],
  ])('normalizes and protects %s', (path, expectedPolicyPath, expectedModule) => {
    expect(normalizeModulePolicyPath(path)).toBe(expectedPolicyPath);
    expect(getRequiredModule(path)).toBe(expectedModule);
    expect(shouldSkipModuleCheck(path)).toBe(false);
  });

  it('keeps billing and authentication bootstrap routes available in either API version', () => {
    expect(shouldSkipModuleCheck('/api/subscription')).toBe(true);
    expect(shouldSkipModuleCheck('/api/v1/subscription/pricing-plans')).toBe(true);
    expect(shouldSkipModuleCheck('/api/v1/auth/login')).toBe(true);
  });
});

describe('module page resolution (Issue 4)', () => {
  it.each([
    ['/api/products', 'products'],
    ['/api/v1/products', 'products'],
    ['/api/categories', 'categories'],
    ['/api/shelves', 'shelves'],
    ['/api/manufacturers', 'manufacturers'],
    ['/api/batches', 'batches'],
    ['/api/suppliers', 'suppliers'],
    ['/api/pos', 'pos'],
    ['/api/refunds', 'refunds'],
    ['/api/sales', 'invoices'],
    ['/api/customers', 'customers'],
    ['/api/purchases', 'order-purchase'],
    ['/api/staff', 'staff'],
    ['/api/attendance', 'attendance'],
    ['/api/shifts', 'shifts'],
    ['/api/scheduled-shifts', 'shifts'],
    ['/api/commissions', 'commissions'],
    ['/api/reports', 'reports'],
    ['/api/settings', 'settings'],
    ['/api/roles', 'roles'],
    ['/api/expenses', 'expenses'],
    ['/api/inventory', 'overview'],
  ])('resolves %s to page %s', (path, expectedPage) => {
    expect(getRequiredPage(path)).toBe(expectedPage);
  });

  it('resolves pages identically for versioned /api/v1 equivalents', () => {
    for (const path of ['/api/products', '/api/v1/products', '/api/v1/products/abc']) {
      expect(getRequiredPage(path)).toBe('products');
    }
  });

  it('returns null when no module page policy applies', () => {
    expect(getRequiredPage('/api/auth/login')).toBeNull();
    expect(getRequiredPage('/api/health')).toBeNull();
    expect(getRequiredPage('/api/unknown-thing')).toBeNull();
  });
});

describe('resolveModuleOperation', () => {
  it.each([
    ['GET', '/api/inventory/products', 'read'],
    ['HEAD', '/api/inventory/products/1', 'read'],
    ['OPTIONS', '/api/inventory/products', 'read'],
    ['POST', '/api/inventory/products', 'create'],
    ['POST', '/api/pos/transactions', 'create'],
    ['PUT', '/api/inventory/products/1', 'update'],
    ['PATCH', '/api/inventory/products/1', 'update'],
    ['DELETE', '/api/inventory/products/1', 'delete'],
    ['DELETE', '/api/expenses/42', 'delete'],
  ])('maps %s %s to %s', (method, path, expected) => {
    expect(resolveModuleOperation(method, path)).toBe(expected);
  });

  it('maps explicit export endpoints to export regardless of method', () => {
    expect(resolveModuleOperation('GET', '/api/reports/export/sales')).toBe('export');
    expect(resolveModuleOperation('POST', '/api/reports/export')).toBe('export');
    expect(resolveModuleOperation('GET', '/api/v1/reports/export/sales')).toBe('export');
  });

  it('does not treat words containing export as export endpoints', () => {
    expect(resolveModuleOperation('GET', '/api/reports/exported-sales')).not.toBe('export');
    expect(resolveModuleOperation('GET', '/api/sales/exportable')).not.toBe('export');
    expect(resolveModuleOperation('GET', '/api/reports/exported-sales')).toBe('read');
  });

  it('returns null for unknown methods', () => {
    expect(resolveModuleOperation('TRACE', '/api/products')).toBeNull();
  });
});

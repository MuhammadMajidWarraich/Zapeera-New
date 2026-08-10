import {
  getRequiredModule,
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

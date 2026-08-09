import {
  getRequiredModule,
  normalizeModulePolicyPath,
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

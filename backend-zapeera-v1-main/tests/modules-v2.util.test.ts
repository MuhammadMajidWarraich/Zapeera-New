import { mapAccessReasonToDisabledReason, toLegacyModuleAccessPayload } from '../src/utils/modules-v2.util';

describe('mapAccessReasonToDisabledReason', () => {
  it('maps override and dependency blocks to the legacy UI reasons', () => {
    expect(mapAccessReasonToDisabledReason('BUSINESS_OWNER_DISABLED')).toBe('BUSINESS_TYPE');
    expect(mapAccessReasonToDisabledReason('BUSINESS_TYPE_RESTRICTED')).toBe('BUSINESS_TYPE');
    expect(mapAccessReasonToDisabledReason('MODULE_DEPENDENCY_MISSING')).toBe('SUBSCRIPTION_PLAN');
    expect(mapAccessReasonToDisabledReason('SUBSCRIPTION_NOT_ENTITLED')).toBe('SUBSCRIPTION_PLAN');
    expect(mapAccessReasonToDisabledReason('ROLE_NO_ACCESS')).toBe('ROLE');
    expect(mapAccessReasonToDisabledReason('OPERATION_NOT_PERMITTED')).toBe('ROLE');
    expect(mapAccessReasonToDisabledReason('PARENT_MODULE_DENIED')).toBe('PARENT_MODULE');
    expect(mapAccessReasonToDisabledReason('ALLOWED')).toBeNull();
    expect(mapAccessReasonToDisabledReason('UNKNOWN_ERROR')).toBeNull();
  });
});

describe('toLegacyModuleAccessPayload', () => {
  it('maps V2 access decisions to the legacy module payload shape', () => {
    const payload = {
      businessId: 'business-1',
      userId: 'user-1',
      roleName: 'OWNER',
      modules: [
        {
          moduleKey: 'sales',
          moduleName: 'Sales',
          icon: 'cash-register',
          enabled: true,
          reason: 'ALLOWED',
          typeAllowed: true,
          planAllowed: true,
          businessOverrideDisabled: false,
          roleAllowed: true,
          dependencyBlocked: false,
          allowedOperations: ['read'],
          blockedOperations: [],
        },
        {
          moduleKey: 'inventory',
          moduleName: 'Inventory',
          icon: 'box',
          enabled: false,
          reason: 'SUBSCRIPTION_NOT_ENTITLED',
          typeAllowed: true,
          planAllowed: false,
          businessOverrideDisabled: false,
          roleAllowed: true,
          dependencyBlocked: false,
          allowedOperations: [],
          blockedOperations: [],
        },
        {
          moduleKey: 'customers',
          moduleName: 'Customers',
          icon: 'users',
          enabled: false,
          reason: 'ROLE_NO_ACCESS',
          typeAllowed: true,
          planAllowed: true,
          businessOverrideDisabled: false,
          roleAllowed: false,
          dependencyBlocked: false,
          allowedOperations: [],
          blockedOperations: [],
        },
      ],
    } as any;

    const result = toLegacyModuleAccessPayload(payload);

    expect(result.data.find((item: any) => item.name === 'sales')?.enabled).toBe(true);
    expect(result.data.find((item: any) => item.name === 'sales')?.disabledReason).toBeNull();
    expect(result.data.find((item: any) => item.name === 'inventory')?.disabledReason).toBe('SUBSCRIPTION_PLAN');
    expect(result.data.find((item: any) => item.name === 'customers')?.disabledReason).toBe('ROLE');
    expect(result.enabledModuleNames).toEqual(['sales']);
  });
});

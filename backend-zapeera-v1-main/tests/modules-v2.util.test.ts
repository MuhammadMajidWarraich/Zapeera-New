import { getLegacyDisabledReasonForV2, toLegacyModuleAccessPayload } from '../src/utils/modules-v2.util';

describe('getLegacyDisabledReasonForV2', () => {
  it('maps override and dependency blocks to the legacy UI reasons', () => {
    expect(getLegacyDisabledReasonForV2('BUSINESS_OWNER_DISABLED')).toBe('BUSINESS_TYPE');
    expect(getLegacyDisabledReasonForV2('MODULE_DEPENDENCY_MISSING')).toBe('SUBSCRIPTION_PLAN');
    expect(getLegacyDisabledReasonForV2('ROLE_NO_ACCESS')).toBe('ROLE');
    expect(getLegacyDisabledReasonForV2('ALLOWED')).toBeNull();
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

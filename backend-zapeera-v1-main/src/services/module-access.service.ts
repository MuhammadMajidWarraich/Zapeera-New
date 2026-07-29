/**
 * Module Access Service
 * Centralized service for module access control logic
 * Used by middleware, controllers, and API endpoints
 */

import { getPrisma } from '../utils/db.util';
import { getModuleAccessV2 } from '../utils/modules-v2.util';

export interface ModuleAccessInfo {
  moduleKey: string;
  moduleName: string;
  enabled: boolean;
  features?: string[];
  limits?: {
    maxUsers?: number;
    maxBranches?: number;
    maxStorage?: number;
  };
}

export interface UserModuleAccess {
  userId: string;
  businessId: string;
  allowedModules: string[];
  modules: ModuleAccessInfo[];
  hasAccess: (moduleKey: string) => boolean;
}

class ModuleAccessService {
  /**
   * Get all module access information for a user in a business
   */
  async getUserModuleAccess(
    userId: string,
    businessId: string
  ): Promise<UserModuleAccess | null> {
    const prisma = await getPrisma();

    try {
      // Verify membership
      const membership = await prisma.membership.findFirst({
        where: {
          userId: userId,
          businessId: businessId,
          status: 'ACTIVE',
        },
        include: { role: true },
      });

      if (!membership) {
        console.warn(`[ModuleAccessService] No membership found for user ${userId} in business ${businessId}`);
        return null;
      }

      const membershipAny = membership as any;
      const roleName = membership.role?.name || membershipAny.role_name || membershipAny.role;
      const v2Payload = await getModuleAccessV2(prisma, businessId, userId, {
        skipCache: false,
        roleName,
      });

      const moduleRows = await prisma.module.findMany({
        where: { name: { in: v2Payload.modules.map((m) => m.moduleKey) } },
      });
      const moduleDisplayMap = new Map(moduleRows.map((m: any) => [String(m.name).toLowerCase(), m.displayName || m.name]));
      const enabledModuleNames = v2Payload.modules.filter((m) => m.enabled).map((m) => String(m.moduleKey).toLowerCase());

      const modules: ModuleAccessInfo[] = v2Payload.modules.map((module) => ({
        moduleKey: module.moduleKey,
        moduleName: moduleDisplayMap.get(module.moduleKey.toLowerCase()) || module.moduleName || module.moduleKey,
        enabled: module.enabled,
      }));

      return {
        userId,
        businessId,
        allowedModules: enabledModuleNames,
        modules,
        hasAccess: (moduleKey: string) => enabledModuleNames.includes(String(moduleKey).toLowerCase()),
      };
    } catch (error) {
      console.error('[ModuleAccessService] Error getting user module access:', error);
      return null;
    }
  }

  /**
   * Check if a specific module is enabled for a business
   */
  private async getEffectiveUserIdForBusiness(prisma: any, businessId: string): Promise<string | null> {
    const owner = await prisma.business.findUnique({
      where: { id: businessId },
      select: { createdBy: true },
    });

    if (owner?.createdBy) {
      return String(owner.createdBy);
    }

    const membership = await prisma.membership.findFirst({
      where: { businessId, status: 'ACTIVE' },
      select: { userId: true },
    });

    return membership?.userId || null;
  }

  async isModuleEnabled(businessId: string, moduleKey: string, roleName?: string): Promise<boolean> {
    const prisma = await getPrisma();

    try {
      const userId = await this.getEffectiveUserIdForBusiness(prisma, businessId);
      if (!userId) {
        return false;
      }
      const v2Payload = await getModuleAccessV2(prisma, businessId, userId, {
        skipCache: false,
        roleName,
      });
      return v2Payload.modules.some((m) => String(m.moduleKey).toLowerCase() === String(moduleKey).toLowerCase() && m.enabled);
    } catch (error) {
      console.error(`[ModuleAccessService] Error checking module ${moduleKey}:`, error);
      return false;
    }
  }

  /**
   * Check if user has access to specific module
   */
  async checkAccess(
    userId: string,
    businessId: string,
    moduleKey: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const prisma = await getPrisma();

    try {
      const membership = await prisma.membership.findFirst({
        where: {
          userId: userId,
          businessId: businessId,
          status: 'ACTIVE',
        },
        include: { role: true },
      });

      const membershipAny = membership as any;
      const roleName = membership?.role?.name || membershipAny.role_name || membershipAny.role || 'OWNER';
      const v2Payload = await getModuleAccessV2(prisma, businessId, userId, {
        skipCache: false,
        roleName,
      });
      const moduleKeyNormalized = String(moduleKey).trim().toLowerCase();
      const moduleEntry = v2Payload.modules.find((m) => String(m.moduleKey).toLowerCase() === moduleKeyNormalized);

      if (!moduleEntry) {
        return { allowed: false, reason: 'MODULE_NOT_FOUND' };
      }

      if (!moduleEntry.enabled) {
        return { allowed: false, reason: 'MODULE_NOT_ENABLED' };
      }

      return { allowed: true };
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('user not member of business')) {
        return { allowed: false, reason: 'NO_MEMBERSHIP' };
      }

      console.error(`[ModuleAccessService] Error checking module ${moduleKey}:`, error);
      return { allowed: false, reason: 'MODULE_NOT_ENABLED' };
    }
  }

  /**
   * Get module details
   */
  async getModuleDetails(moduleKey: string): Promise<any | null> {
    const prisma = await getPrisma();

    try {
      const module = await prisma.module.findUnique({
        where: { name: moduleKey },
      });

      return module;
    } catch (error) {
      console.error(`[ModuleAccessService] Error getting module ${moduleKey}:`, error);
      return null;
    }
  }

  /**
   * Get all available modules in the system
   */
  async getAllModules(): Promise<any[]> {
    const prisma = await getPrisma();

    try {
      const modules = await prisma.module.findMany({
        });

      return modules;
    } catch (error) {
      console.error('[ModuleAccessService] Error getting all modules:', error);
      return [];
    }
  }

  /**
   * Log unauthorized access attempt for security auditing
   */
  logUnauthorizedAccess(
    userId: string,
    businessId: string,
    moduleKey: string,
    path: string,
    ip?: string
  ): void {
    console.warn(`[SECURITY] Unauthorized module access attempt:`, {
      userId,
      businessId,
      moduleKey,
      path,
      ip,
      timestamp: new Date().toISOString(),
    });

    // TODO: Write to security audit log table if implemented
    // TODO: Trigger alert if repeated violations
  }
}

export const moduleAccessService = new ModuleAccessService();

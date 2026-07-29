import { PrismaClient } from '@prisma/client';
import { ensureBusinessRole, upsertMembership, upsertMembershipBranch } from './membership-bridge.util';

/**
 * Migration utility to move legacy User.companyId and User.branchId 
 * data into the new Membership system.
 */
export const migrateLegacyUserContextToMemberships = async (prisma: PrismaClient) => {
  console.log('🚀 Starting legacy user context migration...');
  
  // 1. Fetch all users who have a companyId or branchId
  // Since these fields are commented out in Prisma, we use queryRaw
  const legacyUsers = await prisma.$queryRaw<any[]>`
    SELECT id, companyId, branchId, name
    FROM zapeera_users
    WHERE companyId IS NOT NULL OR branchId IS NOT NULL
  `;
  
  console.log(`🔍 Found ${legacyUsers.length} users with legacy context.`);
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  for (const user of legacyUsers) {
    try {
      const userId = user.id;
      const businessId = user.companyId;
      const branchId = user.branchId;
      
      if (!businessId) {
        // If they only have branchId but no companyId, we can't easily map them
        // unless we look up the branch's company.
        if (branchId) {
          const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { companyId: true }
          });
          if (branch?.companyId) {
            await createLegacyMembership(prisma, userId, branch.companyId, branchId);
            successCount++;
          } else {
            skipCount++;
          }
        } else {
          skipCount++;
        }
        continue;
      }
      
      await createLegacyMembership(prisma, userId, businessId, branchId);
      successCount++;
      
    } catch (err: any) {
      console.error(`❌ Error migrating user ${user.id}:`, err.message);
      errorCount++;
    }
  }
  
  console.log('✅ Migration complete!');
  console.log(`📊 Results: ${successCount} migrated, ${skipCount} skipped, ${errorCount} errors.`);
  
  return { successCount, skipCount, errorCount };
};

/**
 * Helper to create a membership and link branch for legacy users.
 * Assumes they are 'OWNER' if they had a companyId set on their user record,
 * as this was the old pattern for business creators.
 */
async function createLegacyMembership(
  prisma: PrismaClient, 
  userId: string, 
  businessId: string, 
  branchId: string | null
) {
  // 1. Ensure 'OWNER' role exists for this business
  const roleId = await ensureBusinessRole(prisma as any, businessId, 'OWNER');
  
  if (!roleId) {
    throw new Error(`Could not resolve OWNER role for business ${businessId}`);
  }
  
  // 2. Create membership
  const membershipId = await upsertMembership(prisma as any, {
    userId,
    businessId,
    roleId,
    status: 'ACTIVE'
  });
  
  if (!membershipId) {
    throw new Error(`Could not create membership for user ${userId} in business ${businessId}`);
  }
  
  // 3. Link to branch if available
  if (branchId) {
    await upsertMembershipBranch(prisma as any, membershipId, branchId);
  }
}

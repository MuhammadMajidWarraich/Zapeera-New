import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

export const isMissingTableError = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('no such table') ||
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('p2021')
  );
};

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '')}`;

export const ensureBusinessRole = async (
  prisma: PrismaClient,
  businessId: string,
  roleName: string
): Promise<string | null> => {
  try {
    const normalized = String(roleName || '').toUpperCase();
    const existing = await prisma.$queryRaw<any[]>`
      SELECT id FROM roles
      WHERE "businessId" = ${businessId}
        AND name = ${normalized}
      LIMIT 1
    `;
    if (existing[0]?.id) return String(existing[0].id);

    const id = newId('role');
    await prisma.$executeRaw`
      INSERT INTO roles (id, "businessId", name, "createdAt", "updatedAt", uuid, "syncStatus")
      VALUES (${id}, ${businessId}, ${normalized}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${newId('uuid')}, 'PENDING')
    `;
    return id;
  } catch (error: any) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
};

export const isBusinessCreator = async (
  prisma: PrismaClient,
  businessId: string,
  userId: string
): Promise<boolean> => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { createdBy: true },
    });
    return !!business && String(business.createdBy) === String(userId);
  } catch {
    return false;
  }
};

export const upsertMembership = async (
  prisma: PrismaClient,
  params: {
    userId: string;
    businessId: string;
    roleId?: string | null;
    invitedBy?: string | null;
    status?: string;
  }
): Promise<string | null> => {
  const status = params.status || 'ACTIVE';
  try {
    const existing = await prisma.$queryRaw<any[]>`
      SELECT id
      FROM memberships
      WHERE "userId" = ${params.userId}
        AND "businessId" = ${params.businessId}
      LIMIT 1
    `;

    if (existing[0]?.id) {
      const id = String(existing[0].id);
      // NEVER demote the business creator via a generic upsert: the creator
      // must keep OWNER. If a caller passes a non-OWNER role for the creator,
      // keep the existing role and only update status/invitedBy.
      let roleId: string | null | undefined = params.roleId || null;
      if (params.roleId) {
        const roleRow = await prisma.$queryRaw<any[]>`
          SELECT name FROM roles WHERE id = ${params.roleId} LIMIT 1
        `;
        const roleName = String(roleRow?.[0]?.name || '').toUpperCase();
        if (roleName !== 'OWNER' && (await isBusinessCreator(prisma, params.businessId, params.userId))) {
          console.warn(`[Membership] ⚠️ Refusing to demote business creator ${params.userId} from OWNER (requested role: ${roleName})`);
          roleId = undefined; // keep the existing role untouched
        }
      }
      if (roleId === undefined) {
        await prisma.$executeRaw`
          UPDATE memberships
          SET status = ${status},
              "invitedBy" = ${params.invitedBy || null},
              "updatedAt" = CURRENT_TIMESTAMP,
              "syncStatus" = 'PENDING'
          WHERE id = ${id}
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE memberships
          SET "roleId" = ${roleId},
              status = ${status},
              "invitedBy" = ${params.invitedBy || null},
              "updatedAt" = CURRENT_TIMESTAMP,
              "syncStatus" = 'PENDING'
          WHERE id = ${id}
        `;
      }
      return id;
    }

    const id = newId('mem');
    await prisma.$executeRaw`
      INSERT INTO memberships (
        id, "userId", "businessId", "roleId", status, "invitedBy", "createdAt", "updatedAt", uuid, "syncStatus"
      )
      VALUES (
        ${id}, ${params.userId}, ${params.businessId}, ${params.roleId || null}, ${status}, ${params.invitedBy || null},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${newId('uuid')}, 'PENDING'
      )
    `;
    return id;
  } catch (error: any) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
};

export const upsertMembershipBranch = async (
  prisma: PrismaClient,
  membershipId: string,
  branchId?: string | null
): Promise<void> => {
  if (!branchId) return;
  try {
    const existing = await prisma.$queryRaw<any[]>`
      SELECT id
      FROM membership_branches
      WHERE "membershipId" = ${membershipId}
        AND "branchId" = ${branchId}
      LIMIT 1
    `;
    if (existing[0]?.id) return;

    const id = newId('mbr');
    await prisma.$executeRaw`
      INSERT INTO membership_branches (id, "membershipId", "branchId", "createdAt", "updatedAt", uuid, "syncStatus")
      VALUES (${id}, ${membershipId}, ${branchId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${newId('uuid')}, 'PENDING')
    `;
  } catch (error: any) {
    if (isMissingTableError(error)) return;
    throw error;
  }
};

export const deleteMembershipByUserBusiness = async (
  prisma: PrismaClient,
  userId: string,
  businessId: string
): Promise<boolean> => {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id
      FROM memberships
      WHERE "userId" = ${userId}
        AND "businessId" = ${businessId}
      LIMIT 1
    `;
    if (!rows[0]?.id) return false;
    const membershipId = String(rows[0].id);

    await prisma.$executeRaw`DELETE FROM membership_branches WHERE "membershipId" = ${membershipId}`;
    await prisma.$executeRaw`DELETE FROM memberships WHERE id = ${membershipId}`;
    return true;
  } catch (error: any) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
};

export const listBusinessMembershipUsers = async (
  prisma: PrismaClient,
  businessId: string
): Promise<Array<{
  membershipId: string;
  userId: string;
  userName: string;
  username: string;
  email: string;
  isActive: boolean;
  status: string;
  role: string | null;
  branchId: string | null;
  branchName: string | null;
  createdAt: string;
}>> => {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        m.id AS membership_id,
        m."userId" AS user_id,
        m.status AS membership_status,
        m."createdAt" AS created_at,
        u.name AS user_name,
        u.username AS username,
        u.email AS email,
        u."isActive" AS user_is_active,
        r.name AS role_name,
        mb."branchId" AS branch_id,
        b.name AS branch_name
      FROM memberships m
      INNER JOIN zapeera_users u ON u.id = m."userId"
      LEFT JOIN roles r ON r.id = m."roleId"
      LEFT JOIN membership_branches mb ON mb."membershipId" = m.id
      LEFT JOIN branches b ON b.id = mb."branchId"
      WHERE m."businessId" = ${businessId}
      ORDER BY m."createdAt" DESC
    `;

    const merged = new Map<string, any>();
    for (const row of rows) {
      const userId = String(row.user_id);
      if (!merged.has(userId)) {
        merged.set(userId, {
          membershipId: String(row.membership_id),
          userId,
          userName: String(row.user_name || ''),
          username: String(row.username || ''),
          email: String(row.email || ''),
          isActive: Boolean(row.user_is_active),
          status: String(row.membership_status || 'ACTIVE'),
          role: row.role_name ? String(row.role_name) : null,
          branchId: row.branch_id ? String(row.branch_id) : null,
          branchName: row.branch_name ? String(row.branch_name) : null,
          createdAt: String(row.created_at || nowIso()),
        });
      }
    }

    return Array.from(merged.values());
  } catch (error: any) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
};



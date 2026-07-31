import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

const INVITATION_EXPIRY_DAYS = 7; // Invitations valid for 7 days

/**
 * Generate a secure token for invitation acceptance
 */
export const generateInvitationToken = (): string => {
  return randomBytes(32).toString('hex');
};

/**
 * Calculate expiration date for invitation
 */
export const getInvitationExpiryDate = (): Date => {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + INVITATION_EXPIRY_DAYS);
  return expiryDate;
};

/**
 * Send business invitation to email
 */
export const createBusinessInvitation = async (
  prisma: PrismaClient,
  params: {
    businessId: string;
    email: string;
    invitedBy: string;
    roleId?: string;
  }
): Promise<{
  invitationId: string;
  token: string;
  expiresAt: Date;
} | null> => {
  try {
    // Check if user already has a membership for this business
    const existingMembership = await prisma.$queryRaw<any[]>`
      SELECT id FROM memberships
      WHERE "businessId" = ${params.businessId}
        AND "userId" = (SELECT id FROM zapeera_users WHERE email = ${params.email})
      LIMIT 1
    `;

    if (existingMembership.length > 0) {
      return null; // User already a member
    }

    // Check if invitation already exists
    const existingInvitation = await prisma.$queryRaw<any[]>`
      SELECT id FROM business_invitations
      WHERE "businessId" = ${params.businessId}
        AND email = ${params.email}
        AND status IN ('PENDING', 'ACCEPTED')
      LIMIT 1
    `;

    if (existingInvitation.length > 0) {
      return null; // Invitation already exists
    }

    const token = generateInvitationToken();
    const expiresAt = getInvitationExpiryDate();

    await prisma.$executeRaw`
      INSERT INTO business_invitations (
        id, "businessId", email, "invitedBy", "roleId", status, "expiresAt", token,
        "createdAt", "updatedAt", uuid, "syncStatus"
      )
      VALUES (
        ${generateId('inv')}, ${params.businessId}, ${params.email}, ${params.invitedBy},
        ${params.roleId || null}, 'PENDING', ${expiresAt}, ${token},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${generateId('uuid')}, 'PENDING'
      )
    `;

    return {
      invitationId: generateId('inv'),
      token,
      expiresAt
    };
  } catch (error) {
    console.error('Create invitation error:', error);
    throw error;
  }
};

/**
 * Accept business invitation and create membership
 */
export const acceptInvitation = async (
  prisma: PrismaClient,
  params: {
    token: string;
    userId?: string;
  }
): Promise<{
  success: boolean;
  membershipId?: string;
  message: string;
} | null> => {
  try {
    // Find invitation by token
    const invitations = await prisma.$queryRaw<any[]>`
      SELECT id, "businessId", "roleId", "expiresAt", email, status
      FROM business_invitations
      WHERE token = ${params.token}
      LIMIT 1
    `;

    if (invitations.length === 0) {
      return {
        success: false,
        message: 'Invitation not found'
      };
    }

    const invitation = invitations[0];

    // Check if invitation is expired
    if (new Date() > new Date(invitation.expires_at)) {
      return {
        success: false,
        message: 'Invitation has expired'
      };
    }

    // Check if invitation is already accepted or rejected
    if (invitation.status !== 'PENDING') {
      return {
        success: false,
        message: `Invitation has already been ${invitation.status.toLowerCase()}`
      };
    }

    // If userId provided, verify email matches invitation
    if (params.userId) {
      const users = await prisma.$queryRaw<any[]>`
        SELECT id FROM zapeera_users WHERE id = ${params.userId}
      `;

      if (users.length === 0) {
        return {
          success: false,
          message: 'User not found'
        };
      }
    }

    // Create membership
    const membershipId = await createMembershipFromInvitation(
      prisma,
      invitation.business_id,
      invitation.email,
      invitation.role_id,
      params.userId
    );

    // Mark invitation as accepted
    await prisma.$executeRaw`
      UPDATE business_invitations
      SET status = 'ACCEPTED', "acceptedAt" = CURRENT_TIMESTAMP, "syncStatus" = 'PENDING'
      WHERE token = ${params.token}
    `;

    return {
      success: true,
      membershipId,
      message: 'Invitation accepted successfully'
    };
  } catch (error) {
    console.error('Accept invitation error:', error);
    throw error;
  }
};

/**
 * Reject business invitation
 */
export const rejectInvitation = async (
  prisma: PrismaClient,
  token: string
): Promise<{
  success: boolean;
  message: string;
}> => {
  try {
    const invitations = await prisma.$queryRaw<any[]>`
      SELECT id, status FROM business_invitations
      WHERE token = ${token}
      LIMIT 1
    `;

    if (invitations.length === 0) {
      return {
        success: false,
        message: 'Invitation not found'
      };
    }

    if (invitations[0].status !== 'PENDING') {
      return {
        success: false,
        message: `Invitation has already been ${invitations[0].status.toLowerCase()}`
      };
    }

    await prisma.$executeRaw`
      UPDATE business_invitations
      SET status = 'REJECTED', "rejectedAt" = CURRENT_TIMESTAMP, "syncStatus" = 'PENDING'
      WHERE token = ${token}
    `;

    return {
      success: true,
      message: 'Invitation rejected'
    };
  } catch (error) {
    console.error('Reject invitation error:', error);
    throw error;
  }
};

/**
 * Create membership from accepted invitation
 */
const createMembershipFromInvitation = async (
  prisma: PrismaClient,
  businessId: string,
  email: string,
  roleId: string | null,
  userId?: string
): Promise<string> => {
  try {
    // If userId not provided, find user by email
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const users = await prisma.$queryRaw<any[]>`
        SELECT id FROM zapeera_users WHERE email = ${email}
      `;
      if (users.length > 0) {
        resolvedUserId = users[0].id;
      } else {
        throw new Error('User not found for email: ' + email);
      }
    }

    // Check if membership already exists
    const existing = await prisma.$queryRaw<any[]>`
      SELECT id FROM memberships
      WHERE "userId" = ${resolvedUserId} AND "businessId" = ${businessId}
    `;

    if (existing.length > 0) {
      return existing[0].id;
    }

    // Create membership
    const membershipId = generateId('mem');
    await prisma.$executeRaw`
      INSERT INTO memberships (
        id, "userId", "businessId", "roleId", status, "createdAt", "updatedAt", uuid, "syncStatus"
      )
      VALUES (
        ${membershipId}, ${resolvedUserId}, ${businessId}, ${roleId || null},
        'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${generateId('uuid')}, 'PENDING'
      )
    `;

    // Assign all branches
    const branches = await prisma.$queryRaw<any[]>`
      SELECT id FROM branches WHERE "companyId" = ${businessId}
    `;

    for (const branch of branches) {
      const mbId = generateId('mbr');
      await prisma.$executeRaw`
        INSERT INTO membership_branches (
          id, "membershipId", "branchId", "createdAt", "updatedAt", uuid, "syncStatus"
        )
        VALUES (
          ${mbId}, ${membershipId}, ${branch.id},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${generateId('uuid')}, 'PENDING'
        )
      `;
    }

    return membershipId;
  } catch (error) {
    console.error('Create membership from invitation error:', error);
    throw error;
  }
};

/**
 * Get pending invitations for a business
 */
export const getBusinessInvitations = async (
  prisma: PrismaClient,
  businessId: string,
  status?: string
): Promise<Array<{
  invitationId: string;
  email: string;
  roleName: string | null;
  status: string;
  invitedBy: string;
  inviterName: string;
  expiresAt: string;
  createdAt: string;
}>> => {
  try {
    let query = `
      SELECT
        bi.id AS invitation_id,
        bi.email,
        bi.status,
        bi."invitedBy",
        bi."expiresAt",
        bi."createdAt",
        r.name AS role_name,
        u.name AS inviter_name
      FROM business_invitations bi
      LEFT JOIN roles r ON r.id = bi."roleId"
      LEFT JOIN zapeera_users u ON u.id = bi."invitedBy"
      WHERE bi."businessId" = '${businessId}'
    `;

    if (status) {
      query += ` AND bi.status = '${status}'`;
    }

    query += ' ORDER BY bi."createdAt" DESC';

    const rows = await prisma.$queryRawUnsafe<any[]>(query);

    return rows.map(row => ({
      invitationId: String(row.invitation_id),
      email: String(row.email),
      roleName: row.role_name ? String(row.role_name) : null,
      status: String(row.status),
      invitedBy: String(row.invited_by),
      inviterName: String(row.inviter_name || ''),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at)
    }));
  } catch (error) {
    console.error('Get business invitations error:', error);
    throw error;
  }
};

/**
 * Get pending invitations for user by email
 */
export const getUserInvitations = async (
  prisma: PrismaClient,
  email: string
): Promise<Array<{
  invitationId: string;
  token: string;
  businessName: string;
  roleName: string | null;
  status: string;
  expiresAt: string;
}>> => {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        bi.id AS invitation_id,
        bi.token,
        bi.status,
        bi."expiresAt",
        c.name AS business_name,
        r.name AS role_name
      FROM business_invitations bi
      LEFT JOIN businesses c ON c.id = bi."businessId"
      LEFT JOIN roles r ON r.id = bi."roleId"
      WHERE bi.email = ${email}
        AND bi.status = 'PENDING'
        AND bi."expiresAt" > CURRENT_TIMESTAMP
      ORDER BY bi."createdAt" DESC
    `;

    return rows.map(row => ({
      invitationId: String(row.invitation_id),
      token: String(row.token),
      businessName: String(row.business_name || ''),
      roleName: row.role_name ? String(row.role_name) : null,
      status: String(row.status),
      expiresAt: String(row.expires_at)
    }));
  } catch (error) {
    console.error('Get user invitations error:', error);
    throw error;
  }
};

/**
 * Cancel pending invitations for business
 */
export const cancelInvitations = async (
  prisma: PrismaClient,
  businessId: string,
  email?: string
): Promise<number> => {
  try {
    let query = `
      UPDATE business_invitations SET status = 'CANCELLED', "syncStatus" = 'PENDING'
      WHERE "businessId" = '${businessId}' AND status = 'PENDING'
    `;

    if (email) {
      query += ` AND email = '${email}'`;
    }

    const result = await prisma.$executeRawUnsafe(query);
    return Number(result) || 0;
  } catch (error) {
    console.error('Cancel invitations error:', error);
    throw error;
  }
};

/**
 * Generate unique ID with prefix
 */
const generateId = (prefix: string): string => {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
};

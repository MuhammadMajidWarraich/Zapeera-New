import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { emailService } from '../services/email.service';
import { validateStaffCreationAllowance } from '../utils/subscription-entitlements.util';
import { normalizeBusinessType } from '../utils/subscription-entitlements.util';
import {
  createBusinessInvitation,
  acceptInvitation,
  rejectInvitation,
  getBusinessInvitations,
  getUserInvitations,
  cancelInvitations
} from '../utils/invitation.util';
import { createNotification } from './notification.controller';
import Joi from 'joi';

// Validation schemas
const sendInvitationSchema = Joi.object({
  businessId: Joi.string().required(),
  email: Joi.string().email().required(),
  roleId: Joi.string().optional().allow(null)
});

const acceptInvitationSchema = Joi.object({
  token: Joi.string().required()
});

const rejectInvitationSchema = Joi.object({
  token: Joi.string().required()
});

/**
 * Send invitation to join business
 * POST /api/invitations/send
 */
export const sendInvitation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    // Validate request
    const { error, value } = sendInvitationSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: error.details[0].message
      });
      return;
    }

    const { businessId, email, roleId } = value;

    // Get business details for subscription validation
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, createdBy: true, businessType: true }
    });

    if (!business) {
      res.status(404).json({
        success: false,
        message: 'Business not found'
      });
      return;
    }

    // Validate staff creation allowance based on subscription plan
    if (!business.createdBy) {
      res.status(400).json({
        success: false,
        message: 'Business owner not found'
      });
      return;
    }

    const staffValidation = await validateStaffCreationAllowance(prisma, {
      companyId: business.id,
      ownerUserId: business.createdBy,
      businessType: normalizeBusinessType(business.businessType) || 'PHARMACY'
    });

    if (!staffValidation.allowed) {
      res.status(staffValidation.statusCode).json({
        success: false,
        message: staffValidation.message,
        details: staffValidation.details
      });
      return;
    }

    // Check if user sending invitation has permission
    const senderMembership = await prisma.$queryRaw<any[]>`
      SELECT m.id, m."roleId" FROM memberships m
      WHERE m."userId" = ${req.user?.id}
        AND m."businessId" = ${businessId}
        AND m.status = 'ACTIVE'
      LIMIT 1
    `;

    if (senderMembership.length === 0) {
      res.status(403).json({
        success: false,
        message: 'You do not have access to this business'
      });
      return;
    }

    // Check if sender is owner or has invite permission
    const senderRole = senderMembership[0].roleId;
    const company = await prisma.$queryRaw<any[]>`
      SELECT "createdBy" FROM businesses WHERE id = ${businessId} LIMIT 1
    `;

    const isOwner = company[0]?.createdBy === req.user?.id;
    if (!isOwner && senderRole) {
      // Check if role has invite permission (legacy tables may be absent — fail closed)
      let hasInvitePermission = false;
      try {
        const permission = await prisma.$queryRaw<any[]>`
          SELECT 1 FROM role_permissions rp
          INNER JOIN permissions p ON p.id = rp."permissionId"
          WHERE rp."roleId" = ${senderRole} AND p.name = 'INVITE_USERS'
          LIMIT 1
        `;
        hasInvitePermission = permission.length > 0;
      } catch (err: any) {
        hasInvitePermission = false;
      }

      if (!hasInvitePermission) {
        res.status(403).json({
          success: false,
          message: 'You do not have permission to invite users'
        });
        return;
      }
    }

    // Create invitation
    const invitation = await createBusinessInvitation(prisma, {
      businessId,
      email,
      invitedBy: req.user!.id,
      roleId
    });

    if (!invitation) {
      res.status(400).json({
        success: false,
        message: 'User is already a member or invitation already exists'
      });
      return;
    }

    // Get business name and role details for email
    const businessData = await prisma.$queryRaw<any[]>`
      SELECT c.name as business_name, r.name as role_name
      FROM businesses c
      LEFT JOIN roles r ON r.id = ${roleId || null}
      WHERE c.id = ${businessId}
      LIMIT 1
    `;

    const businessName = businessData[0]?.business_name || businessId;
    const roleName = businessData[0]?.role_name || undefined;
    const inviterData = await prisma.$queryRaw<any[]>`
      SELECT name FROM zapeera_users WHERE id = ${req.user!.id}
    `;
    const inviterName = inviterData[0]?.name || 'A team member';

    // Generate acceptance link
    const acceptanceLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${invitation.token}/accept`;

    // Send email invitation
    const emailSent = await emailService.sendBusinessInvitationEmail(
      email,
      undefined, // recipientName - we don't know it yet
      businessName,
      inviterName,
      roleName,
      acceptanceLink,
      invitation.expiresAt
    );

    if (!emailSent) {
      console.warn(`⚠️ [Invitation] Email sending failed for ${email}, but invitation was created`);
    }

    createNotification({
      userId: req.user!.id,
      businessId: businessId,
      type: 'invitation_sent',
      title: 'Invitation Sent',
      body: `Invitation sent to ${email} for ${businessName}`,
      actionUrl: `/zapeera/invitations`,
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        invitationId: invitation.invitationId,
        email,
        expiresAt: invitation.expiresAt.toISOString(),
        emailSent,
        message: 'Invitation sent successfully'
      }
    });
  } catch (error) {
    console.error('Send invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send invitation'
    });
  }
};

/**
 * Accept invitation and join business
 * POST /api/invitations/accept
 */
export const acceptInvitationHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    // Validate request
    const { error, value } = acceptInvitationSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: error.details[0].message
      });
      return;
    }

    const { token } = value;

    // Accept invitation
    const result = await acceptInvitation(prisma, {
      token,
      userId: req.user?.id
    });

    if (!result || !result.success) {
      res.status(400).json({
        success: false,
        message: result?.message || 'Failed to accept invitation'
      });
      return;
    }

    // Send confirmation email
    const businessData = await prisma.$queryRaw<any[]>`
      SELECT c.name FROM businesses c
      WHERE c.id = (SELECT "businessId" FROM business_invitations WHERE token = ${token})
      LIMIT 1
    `;

    const businessName = businessData[0]?.name || 'the Business';
    
    const userInfo = req.user?.id
      ? await prisma.zapeeraUser.findUnique({
          where: { id: req.user.id },
          select: { email: true, name: true }
        })
      : null;

    const recipientEmail = userInfo?.email || req.user?.email || null;
    const recipientName = userInfo?.name || req.user?.name || null;

    const emailSent =
      recipientEmail && recipientName
        ? await emailService.sendInvitationAcceptanceConfirmation(recipientEmail, recipientName, businessName)
        : false;

    if (!emailSent) {
      console.warn(`⚠️ Confirmation email failed for ${req.user!.email}`);
    }

    // Notify business owner that invitation was accepted
    try {
      const invitation = await prisma.businessInvitation.findFirst({
        where: { token },
        select: { businessId: true, invitedBy: true, email: true }
      });
      if (invitation?.invitedBy && invitation.businessId) {
        createNotification({
          userId: invitation.invitedBy,
          businessId: invitation.businessId,
          type: 'invitation_accepted',
          title: 'Invitation Accepted',
          body: `${recipientName || invitation.email} has accepted your invitation and joined the business.`,
          actionUrl: `/staff`,
        }).catch(() => {});
      }
    } catch { /* notification failure is non-blocking */ }

    res.json({
      success: true,
      data: {
        membershipId: result.membershipId,
        message: result.message,
        confirmationEmailSent: emailSent
      }
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept invitation'
    });
  }
};

/**
 * Reject invitation
 * POST /api/invitations/reject
 */
export const rejectInvitationHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    // Validate request
    const { error, value } = rejectInvitationSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: error.details[0].message
      });
      return;
    }

    const { token } = value;

    // Reject invitation
    const result = await rejectInvitation(prisma, token);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: result.message
      });
      return;
    }

    res.json({
      success: true,
      data: {
        message: result.message
      }
    });
  } catch (error) {
    console.error('Reject invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject invitation'
    });
  }
};

/**
 * Get pending invitations for a business (Owner/Admin only)
 * GET /api/invitations/business/:businessId
 */
export const getBusinessInvitationsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { businessId } = req.params;
    const { status } = req.query;

    // Check if user has access to this business
    const membership = await prisma.$queryRaw<any[]>`
      SELECT m.id FROM memberships m
      WHERE m."userId" = ${req.user?.id}
        AND m."businessId" = ${businessId}
        AND m.status = 'ACTIVE'
      LIMIT 1
    `;

    const company = await prisma.$queryRaw<any[]>`
      SELECT "createdBy" FROM businesses WHERE id = ${businessId} LIMIT 1
    `;

    const isOwner = company[0]?.createdBy === req.user?.id;
    if (membership.length === 0 && !isOwner) {
      res.status(403).json({
        success: false,
        message: 'You do not have access to this business'
      });
      return;
    }

    // Get invitations
    const invitations = await getBusinessInvitations(
      prisma,
      businessId,
      status as string | undefined
    );

    res.json({
      success: true,
      data: {
        invitations,
        count: invitations.length
      }
    });
  } catch (error) {
    console.error('Get business invitations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invitations'
    });
  }
};

/**
 * Get pending invitations for authenticated user
 * GET /api/invitations/pending
 */
export const getMyInvitations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    if (!req.user?.email) {
      res.status(400).json({
        success: false,
        message: 'User email not found'
      });
      return;
    }

    // Get invitations
    const invitations = await getUserInvitations(prisma, req.user.email);

    res.json({
      success: true,
      data: {
        invitations,
        count: invitations.length
      }
    });
  } catch (error) {
    console.error('Get user invitations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invitations'
    });
  }
};

/**
 * Cancel pending invitation (Owner/Admin only)
 * DELETE /api/invitations/:invitationId
 */
export const cancelInvitationHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { invitationId } = req.params;

    // Get invitation details
    const invitations = await prisma.$queryRaw<any[]>`
      SELECT "businessId", status FROM business_invitations
      WHERE id = ${invitationId}
      LIMIT 1
    `;

    if (invitations.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
      return;
    }

    const invitation = invitations[0];

    // Check if user has permission
    const membership = await prisma.$queryRaw<any[]>`
      SELECT m.id FROM memberships m
      WHERE m."userId" = ${req.user?.id}
        AND m."businessId" = ${invitation.businessId}
        AND m.status = 'ACTIVE'
      LIMIT 1
    `;

    const company = await prisma.$queryRaw<any[]>`
      SELECT "createdBy" FROM businesses WHERE id = ${invitation.businessId} LIMIT 1
    `;

    const isOwner = company[0]?.createdBy === req.user?.id;
    if (membership.length === 0 && !isOwner) {
      res.status(403).json({
        success: false,
        message: 'You do not have access to this business'
      });
      return;
    }

    if (invitation.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        message: `Cannot cancel ${invitation.status.toLowerCase()} invitation`
      });
      return;
    }

    // Cancel invitation
    await cancelInvitations(prisma, invitation.businessId, undefined);

    res.json({
      success: true,
      data: {
        message: 'Invitation cancelled'
      }
    });
  } catch (error) {
    console.error('Cancel invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel invitation'
    });
  }
};

/**
 * Verify invitation token (public endpoint, no auth required)
 * GET /api/invitations/verify/:token
 */
export const verifyInvitationToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { token } = req.params;

    const invitations = await prisma.$queryRaw<any[]>`
      SELECT
        bi.id,
        bi.email,
        bi.status,
        bi."expiresAt",
        c.name AS business_name,
        r.name AS role_name
      FROM business_invitations bi
      LEFT JOIN businesses c ON c.id = bi."businessId"
      LEFT JOIN roles r ON r.id = bi."roleId"
      WHERE bi.token = ${token}
      LIMIT 1
    `;

    if (invitations.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
      return;
    }

    const invitation = invitations[0];

    // Check if expired
    if (new Date() > new Date(invitation.expiresAt)) {
      res.status(400).json({
        success: false,
        message: 'Invitation has expired'
      });
      return;
    }

    if (invitation.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        message: `Invitation has already been ${invitation.status.toLowerCase()}`
      });
      return;
    }

    res.json({
      success: true,
      data: {
        invitationId: invitation.id,
        email: invitation.email,
        businessName: invitation.business_name,
        roleName: invitation.role_name,
        expiresAt: invitation.expires_at
      }
    });
  } catch (error) {
    console.error('Verify invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify invitation'
    });
  }
};

import { Router } from 'express';
import {
  sendInvitation,
  acceptInvitationHandler,
  rejectInvitationHandler,
  getBusinessInvitationsHandler,
  getMyInvitations,
  cancelInvitationHandler,
  verifyInvitationToken
} from '../controllers/invitation.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, resolveBranch, checkModule, checkPermission } from '../middleware/multitenancy.middleware';
import { checkSubscription, enforceMembershipInviteLimit } from '../middleware/subscription.middleware';

const router = Router();

// Public routes (no authentication required)
router.get('/verify/:token', verifyInvitationToken);

// Protected routes (authentication required)
router.use(authenticate);

// Invite user to business (authenticated user)
router.post('/send', checkPermission('create_invitation'), checkSubscription(), enforceMembershipInviteLimit(), sendInvitation);

// Accept invitation to join business
router.post('/accept', checkPermission('accept_invitation'), acceptInvitationHandler);

// Reject invitation
router.post('/reject', checkPermission('reject_invitation'), rejectInvitationHandler);

// Get pending invitations for current user
router.get('/pending', checkPermission('read_my_invitations'), getMyInvitations);

// Get business invitations (permission guarded + module)
router.get('/business/:businessId', resolveBusiness({ required: false }), resolveMembership(), resolveBranch({ required: false }), checkModule('business_management'), checkPermission('manage_invitations'), getBusinessInvitationsHandler);

// Cancel invitation (permission guarded + module)
router.delete('/:invitationId', resolveBusiness({ required: false }), resolveMembership(), resolveBranch({ required: false }), checkModule('business_management'), checkPermission('manage_invitations'), cancelInvitationHandler);

export default router;

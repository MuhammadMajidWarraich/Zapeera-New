import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation } from '../utils/sync-helper';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';

const createBillingProfileSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().allow('', null).optional(),
  addressLine1: Joi.string().required(),
  addressLine2: Joi.string().allow('', null).optional(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  postalCode: Joi.string().required(),
  country: Joi.string().default('US'),
  taxId: Joi.string().allow('', null).optional(),
  companyName: Joi.string().allow('', null).optional(),
  businessId: Joi.string().allow('', null).optional(),
  paymentMethodId: Joi.string().allow('', null).optional(),
  isDefault: Joi.boolean().default(false)
});

const updateBillingProfileSchema = Joi.object({
  name: Joi.string().optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().allow('', null).optional(),
  addressLine1: Joi.string().optional(),
  addressLine2: Joi.string().allow('', null).optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  postalCode: Joi.string().optional(),
  country: Joi.string().optional(),
  taxId: Joi.string().allow('', null).optional(),
  companyName: Joi.string().allow('', null).optional(),
  paymentMethodId: Joi.string().allow('', null).optional(),
  isDefault: Joi.boolean().optional()
});

export const getBillingProfiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const userId = req.user?.id;
    const businessId = req.query.businessId as string;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const where: any = { userId };
    if (businessId) {
      where.businessId = businessId;
    }

    const profiles = await prisma.billingProfile.findMany({
      where,
      include: {
        paymentMethod: {
          select: {
            id: true,
            last4: true,
            brand: true,
            expiryMonth: true,
            expiryYear: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: profiles });
  } catch (error: any) {
    console.error('Get billing profiles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve billing profiles',
      error: error.message
    });
  }
};

export const getBillingProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const profile = await prisma.billingProfile.findFirst({
      where: {
        id,
        userId
      },
      include: {
        paymentMethod: {
          select: {
            id: true,
            last4: true,
            brand: true,
            expiryMonth: true,
            expiryYear: true
          }
        }
      }
    });

    if (!profile) {
      res.status(404).json({ success: false, message: 'Billing profile not found' });
      return;
    }

    res.json({ success: true, data: profile });
  } catch (error: any) {
    console.error('Get billing profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve billing profile',
      error: error.message
    });
  }
};

export const createBillingProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { error, value } = createBillingProfileSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    // If setting as default, unset other defaults
    if (value.isDefault) {
      await prisma.billingProfile.updateMany({
        where: { userId, businessId: value.businessId || null },
        data: { isDefault: false }
      });
    }

    const profile = await prisma.billingProfile.create({
      data: {
        ...value,
        userId,
        businessId: value.businessId || null,
        paymentMethodId: value.paymentMethodId || null
      },
      include: {
        paymentMethod: {
          select: {
            id: true,
            last4: true,
            brand: true,
            expiryMonth: true,
            expiryYear: true
          }
        }
      }
    });

    // Sync to PostgreSQL
    await syncAfterOperation('billingProfile', 'create', profile).catch(err =>
      console.warn('[Sync] BillingProfile create sync failed:', err.message)
    );

    res.status(201).json({ success: true, data: profile });
  } catch (error: any) {
    console.error('Create billing profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create billing profile',
      error: error.message
    });
  }
};

export const updateBillingProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { error, value } = updateBillingProfileSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    // Check if profile exists and belongs to user
    const existingProfile = await prisma.billingProfile.findFirst({
      where: { id, userId }
    });

    if (!existingProfile) {
      res.status(404).json({ success: false, message: 'Billing profile not found' });
      return;
    }

    // If setting as default, unset other defaults
    if (value.isDefault) {
      await prisma.billingProfile.updateMany({
        where: { userId, businessId: existingProfile.businessId },
        data: { isDefault: false }
      });
    }

    const updateData: any = { ...value };
    if (value.paymentMethodId !== undefined) {
      updateData.paymentMethodId = value.paymentMethodId || null;
    }

    const profile = await prisma.billingProfile.update({
      where: { id },
      data: updateData,
      include: {
        paymentMethod: {
          select: {
            id: true,
            last4: true,
            brand: true,
            expiryMonth: true,
            expiryYear: true
          }
        }
      }
    });

    // Sync to PostgreSQL
    await syncAfterOperation('billingProfile', 'update', profile).catch(err =>
      console.warn('[Sync] BillingProfile update sync failed:', err.message)
    );

    res.json({ success: true, data: profile });
  } catch (error: any) {
    console.error('Update billing profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update billing profile',
      error: error.message
    });
  }
};

export const deleteBillingProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    // Check if profile exists and belongs to user
    const existingProfile = await prisma.billingProfile.findFirst({
      where: { id, userId }
    });

    if (!existingProfile) {
      res.status(404).json({ success: false, message: 'Billing profile not found' });
      return;
    }

    await prisma.billingProfile.delete({
      where: { id }
    });

    // Sync to PostgreSQL
    await syncAfterOperation('billingProfile', 'delete', { id }).catch(err =>
      console.warn('[Sync] BillingProfile delete sync failed:', err.message)
    );

    res.json({ success: true, message: 'Billing profile deleted successfully' });
  } catch (error: any) {
    console.error('Delete billing profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete billing profile',
      error: error.message
    });
  }
};

export const setDefaultBillingProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    // Check if profile exists and belongs to user
    const existingProfile = await prisma.billingProfile.findFirst({
      where: { id, userId }
    });

    if (!existingProfile) {
      res.status(404).json({ success: false, message: 'Billing profile not found' });
      return;
    }

    // Unset all defaults for this user/business combination
    await prisma.billingProfile.updateMany({
      where: { userId, businessId: existingProfile.businessId },
      data: { isDefault: false }
    });

    // Set this one as default
    const profile = await prisma.billingProfile.update({
      where: { id },
      data: { isDefault: true },
      include: {
        paymentMethod: {
          select: {
            id: true,
            last4: true,
            brand: true,
            expiryMonth: true,
            expiryYear: true
          }
        }
      }
    });

    // Sync to PostgreSQL
    await syncAfterOperation('billingProfile', 'update', profile).catch(err =>
      console.warn('[Sync] BillingProfile update sync failed:', err.message)
    );

    res.json({ success: true, data: profile });
  } catch (error: any) {
    console.error('Set default billing profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set default billing profile',
      error: error.message
    });
  }
};
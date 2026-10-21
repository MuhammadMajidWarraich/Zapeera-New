import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';

const updateSettingsSchema = Joi.object({
  defaultTax: Joi.number().min(0).max(100).required(),
  // Loyalty (Wave B3): PKR value of one loyalty point at redemption.
  // Optional so existing settings clients (which never send it) keep
  // working; the sale flow falls back to 1 when no row is stored.
  loyaltyPointValue: Joi.number().positive().optional(),
  lowStockAlert: Joi.number().min(0).required(),
  expiryAlert: Joi.number().min(0).required(),
  autoSync: Joi.boolean().required(),
  offlineMode: Joi.boolean().required(),
  receiptPrinter: Joi.string().required(),
  pharmacyName: Joi.string().required(),
  pharmacyAddress: Joi.string().required(),
  pharmacyPhone: Joi.string().required(),
  pharmacyEmail: Joi.string().email().required(),
  pharmacyLicense: Joi.string().required(),
  pharmacyTaxNumber: Joi.string().required()
});

// Settings contract alignment (roadmap A1): settings rows are stored under
// the canonical pharmacy* keys (existing data is untouched), but the
// business Settings page sends/expects business* keys. The API therefore
// accepts BOTH key styles on update (canonical pharmacy* wins when both are
// present) and returns BOTH styles on read, so either consumer works.
const SETTINGS_KEY_ALIASES: Record<string, string> = {
  businessName: 'pharmacyName',
  businessAddress: 'pharmacyAddress',
  businessPhone: 'pharmacyPhone',
  businessEmail: 'pharmacyEmail',
  businessLicense: 'pharmacyLicense',
  businessTaxNumber: 'pharmacyTaxNumber'
};

const normalizeSettingsPayload = (body: any): Record<string, unknown> => {
  const normalized: Record<string, unknown> = { ...(body || {}) };
  for (const [alias, canonical] of Object.entries(SETTINGS_KEY_ALIASES)) {
    if (normalized[canonical] === undefined && normalized[alias] !== undefined) {
      normalized[canonical] = normalized[alias];
    }
    delete normalized[alias];
  }
  return normalized;
};

export const getSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const createdBy = req.user?.createdBy || req.user?.id;

    if (!createdBy) {
      res.status(401).json({
        success: false,
        message: 'Admin ID not found'
      });
      return;
    }

    // Get all settings for this admin
    const settings = await prisma.settings.findMany({
      where: { createdBy },
      select: {
        key: true,
        value: true,
        description: true
      }
    });

    // Convert to object format
    const settingsObj: any = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = setting.value;
    });

    // Set default values if not found
    const pharmacyName = settingsObj.pharmacyName || process.env.DEFAULT_PHARMACY_NAME || 'Zapeera Pharmacy';
    const pharmacyAddress = settingsObj.pharmacyAddress || 'Block A, Gulberg III, Lahore';
    const pharmacyPhone = settingsObj.pharmacyPhone || process.env.DEFAULT_PHARMACY_PHONE || '+92 42 1234567';
    const pharmacyEmail = settingsObj.pharmacyEmail || process.env.DEFAULT_PHARMACY_EMAIL || 'info@zapeera.com';
    const pharmacyLicense = settingsObj.pharmacyLicense || process.env.DEFAULT_PHARMACY_LICENSE || 'PHR-LHR-2024-001';
    const pharmacyTaxNumber = settingsObj.pharmacyTaxNumber || '1234567890123';
    const defaultSettings = {
      defaultTax: settingsObj.defaultTax || '17',
      loyaltyPointValue: settingsObj.loyaltyPointValue || '1',
      lowStockAlert: settingsObj.lowStockAlert || '20',
      expiryAlert: settingsObj.expiryAlert || '30',
      autoSync: settingsObj.autoSync || 'true',
      offlineMode: settingsObj.offlineMode || 'true',
      receiptPrinter: settingsObj.receiptPrinter || 'EPSON TM-T20II',
      pharmacyName,
      pharmacyAddress,
      pharmacyPhone,
      pharmacyEmail,
      pharmacyLicense,
      pharmacyTaxNumber,
      // business* mirrors of the same values (see SETTINGS_KEY_ALIASES)
      businessName: pharmacyName,
      businessAddress: pharmacyAddress,
      businessPhone: pharmacyPhone,
      businessEmail: pharmacyEmail,
      businessLicense: pharmacyLicense,
      businessTaxNumber: pharmacyTaxNumber
    };

    res.json({
      success: true,
      data: defaultSettings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const createdBy = req.user?.createdBy || req.user?.id;

    if (!createdBy) {
      res.status(401).json({
        success: false,
        message: 'Admin ID not found'
      });
      return;
    }

    // Accept both pharmacy* and business* key styles; persist canonical keys only.
    const { error, value: settingsData } = updateSettingsSchema.validate(
      normalizeSettingsPayload(req.body)
    );
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    // Use transaction to update all settings
    await prisma.$transaction(async (tx: any) => {
      for (const [key, value] of Object.entries(settingsData)) {
        await tx.settings.upsert({
          where: {
            createdBy_key: {
              createdBy,
              key
            }
          },
          update: {
            value: String(value),
            updatedAt: new Date()
          },
          create: {
            createdBy,
            key,
            value: String(value),
            description: getSettingDescription(key)
          }
        });
      }
    });

    res.json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getTaxRate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const createdBy = req.user?.createdBy || req.user?.id;

    if (!createdBy) {
      res.status(401).json({
        success: false,
        message: 'Admin ID not found'
      });
      return;
    }

    // Get tax rate setting
    const taxSetting = await prisma.settings.findUnique({
      where: {
        createdBy_key: {
          createdBy,
          key: 'defaultTax'
        }
      }
    });

    const taxRate = taxSetting ? parseFloat(taxSetting.value) : 0; // Tax disabled - default to 0%

    res.json({
      success: true,
      data: {
        taxRate
      }
    });
  } catch (error) {
    console.error('Get tax rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

function getSettingDescription(key: string): string {
  const descriptions: { [key: string]: string } = {
    defaultTax: 'Default tax rate percentage for sales',
    loyaltyPointValue: 'PKR value of one loyalty point when redeemed at the POS',
    lowStockAlert: 'Minimum stock level to trigger low stock alert',
    expiryAlert: 'Days before expiry to trigger alert',
    autoSync: 'Automatically sync data when online',
    offlineMode: 'Allow operations without internet connection',
    receiptPrinter: 'Default receipt printer model',
    pharmacyName: 'Pharmacy business name',
    pharmacyAddress: 'Pharmacy business address',
    pharmacyPhone: 'Pharmacy contact phone number',
    pharmacyEmail: 'Pharmacy contact email address',
    pharmacyLicense: 'Pharmacy license number',
    pharmacyTaxNumber: 'Pharmacy tax registration number'
  };

  return descriptions[key] || 'System setting';
}

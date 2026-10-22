// Prescription enforcement helpers (Wave C1 — Pharmacy pack).
//
// Whether the POS must refuse a sale of requiresPrescription items
// that has no prescription attached is a per-business choice stored
// in the same per-admin key/value Settings store as `defaultTax` and
// `loyaltyPointValue`, under the key `requirePrescriptionAtPos`:
//
//   stored 'true'   → enforcement ON for that business's admin scope
//   stored 'false'  → enforcement OFF (sales proceed; the sale
//                     response carries prescriptionWarning instead)
//   no row stored   → DEFAULT: ON for PHARMACY businesses, OFF for
//                     every other business type. A pharmacy that has
//                     never touched the setting is protected by
//                     default; a grocery/retail business that happens
//                     to stock a flagged product is never blocked by
//                     a module it does not use.
//
// The setting is written from Business Settings → POS (a three-state
// control: Automatic / Always / Never; "Automatic" deletes the row).

export const REQUIRE_PRESCRIPTION_SETTING_KEY = 'requirePrescriptionAtPos';

/**
 * Resolve the effective enforcement flag. `businessType` is the sale's
 * company type as stored on the Business row (canonical values like
 * 'PHARMACY'); anything pharmacy-like counts, everything else does
 * not — mirroring normalizeBusinessType's upper-case comparison.
 */
export const isPrescriptionEnforced = async (
  prisma: any,
  adminId: string | undefined | null,
  businessType: string | undefined | null
): Promise<boolean> => {
  if (adminId) {
    try {
      const setting = await prisma.settings.findUnique({
        where: {
          createdBy_key: {
            createdBy: adminId,
            key: REQUIRE_PRESCRIPTION_SETTING_KEY
          }
        }
      });
      if (setting) {
        if (setting.value === 'true') return true;
        if (setting.value === 'false') return false;
      }
    } catch (error) {
      console.warn('Could not fetch prescription enforcement setting, using business-type default:', error);
    }
  }
  return String(businessType || '').trim().toUpperCase() === 'PHARMACY';
};

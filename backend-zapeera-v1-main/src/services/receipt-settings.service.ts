// ─── Receipt settings (POS update): service layer ──────────────────────
// Per-business receipt template + content overrides, following the
// FbrConfig pattern (one row per business, upserted on companyId).
// The sandbox generated Prisma client is STALE (it predates several
// models), so `prisma.receiptSettings` is accessed through `(prisma
// as any).receiptSettings` — the VM assembly container regenerates
// the client at deploy (same precedent as addon.controller.ts and
// backoffice-addon.controller.ts). Never run `prisma generate` or
// `prisma db push` in the sandbox.

type PrismaLike = Awaited<ReturnType<typeof import('../utils/db.util').getPrisma>>;

export const RECEIPT_TEMPLATES = ['thermal', 'a4'] as const;
export type ReceiptTemplate = (typeof RECEIPT_TEMPLATES)[number];

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = 'a4';

export interface ReceiptSettingsShape {
  companyId: string;
  template: ReceiptTemplate;
  displayName: string | null;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  footerMessage: string | null;
  showCashier: boolean;
  showCustomer: boolean;
  showPrescription: boolean;
  showTaxBreakdown: boolean;
  showFbr: boolean;
  showPayment: boolean;
  showItemDetails: boolean;
  updatedAt: Date | null;
}

const SHOW_FLAGS = [
  'showCashier',
  'showCustomer',
  'showPrescription',
  'showTaxBreakdown',
  'showFbr',
  'showPayment',
  'showItemDetails'
] as const;

const OVERRIDES = ['displayName', 'tagline', 'address', 'phone', 'email', 'website', 'footerMessage'] as const;

export const defaultReceiptSettings = (companyId: string): ReceiptSettingsShape => ({
  companyId,
  template: DEFAULT_RECEIPT_TEMPLATE,
  displayName: null,
  tagline: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  footerMessage: null,
  showCashier: true,
  showCustomer: true,
  showPrescription: true,
  showTaxBreakdown: true,
  showFbr: true,
  showPayment: true,
  showItemDetails: true,
  updatedAt: null
});

/** Unknown template values stored previously fall back to 'a4' on read (defensive). */
const normalizeTemplate = (value: unknown): ReceiptTemplate =>
  value === 'thermal' || value === 'a4' ? value : DEFAULT_RECEIPT_TEMPLATE;

/** Merges a stored row over the defaults — a missing row returns the defaults. */
export const serializeReceiptSettings = (row: any, companyId: string): ReceiptSettingsShape => {
  const defaults = defaultReceiptSettings(companyId);
  if (!row) return defaults;
  return {
    ...defaults,
    template: normalizeTemplate(row.template),
    ...Object.fromEntries(OVERRIDES.map((key) => [key, row[key] ?? null])),
    ...Object.fromEntries(SHOW_FLAGS.map((key) => [key, row[key] ?? true])),
    updatedAt: row.updatedAt ?? null
  };
};

export const getReceiptSettings = async (
  prisma: PrismaLike,
  companyId: string
): Promise<ReceiptSettingsShape> => {
  const row = await (prisma as any).receiptSettings.findUnique({ where: { companyId } });
  return serializeReceiptSettings(row, companyId);
};

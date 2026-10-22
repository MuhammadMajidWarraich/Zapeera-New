import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { buildVariantMatrix, buildVariantName, normalizeAttributes } from '../utils/variant.util';

// ─── Product variants (Wave C6 — Retail pack) ────────────────────────
// The size x colour matrix of a product, managed as child resources
// of the product (routes live in product.routes.ts, so the router's
// checkModule('inventory') + per-route product permissions apply,
// exactly like the C3 medicine-catalog endpoints).
//
// A variant carries NO stock: stock lives on batches of the variant
// (Batch.variantId). Deleting a variant is a soft deactivate — sale
// history keeps its variantName snapshots, and batches keep pointing
// at the (inactive) variant so their stock stays accounted; the sale
// engine refuses INACTIVE variants for new lines.

const resolveVariantCompanyId = (req: AuthRequest): string =>
  req.membership?.business_id ||
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const attributesSchema = Joi.object()
  .pattern(Joi.string().trim().min(1).max(40), Joi.string().trim().max(60).allow('', null))
  .optional();

const createVariantSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).optional(),
  sku: Joi.string().trim().max(80).allow('', null).optional(),
  barcode: Joi.string().trim().max(80).allow('', null).optional(),
  attributes: attributesSchema,
  priceDelta: Joi.number().optional()
});

const updateVariantSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).optional(),
  sku: Joi.string().trim().max(80).allow('', null).optional(),
  barcode: Joi.string().trim().max(80).allow('', null).optional(),
  attributes: attributesSchema,
  priceDelta: Joi.number().optional(),
  isActive: Joi.boolean().optional()
}).min(1);

const generateVariantsSchema = Joi.object({
  sizes: Joi.array().items(Joi.string().trim().max(60)).max(50).optional(),
  colors: Joi.array().items(Joi.string().trim().max(60)).max(50).optional()
}).or('sizes', 'colors');

const nullIfEmpty = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

const findScopedProduct = async (prisma: any, req: AuthRequest, productId: string) =>
  prisma.product.findFirst({
    where: { id: productId, companyId: resolveVariantCompanyId(req) },
    select: { id: true, name: true, isActive: true }
  });

const variantWithStock = async (prisma: any, variant: any) => {
  const agg = await prisma.batch.aggregate({
    where: { variantId: variant.id, isActive: true },
    _sum: { quantity: true }
  });
  return { ...variant, stock: agg._sum.quantity || 0 };
};

// List a product's variants (active first), each with its live stock
// (the sum of its batches — the pool the sale engine draws from).
export const getProductVariants = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const product = await findScopedProduct(prisma, req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const variants = await prisma.productVariant.findMany({
      where: { productId: product.id, companyId: resolveVariantCompanyId(req) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }]
    });
    const data = await Promise.all(variants.map((v: any) => variantWithStock(prisma, v)));
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('[ProductVariants] GET error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load product variants' });
  }
};

// Create one variant. The name defaults to the attribute-built name
// ("Large / Red"); an explicit name always wins.
export const createProductVariant = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createVariantSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message)
      });
    }

    const companyId = resolveVariantCompanyId(req);
    const product = await findScopedProduct(prisma, req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const attributes = normalizeAttributes(value.attributes);
    const name = nullIfEmpty(value.name) || buildVariantName(attributes);
    if (!attributes && !nullIfEmpty(value.name)) {
      return res.status(400).json({
        success: false,
        message: 'A variant needs a name or attributes (e.g. size / color)',
        code: 'VARIANT_NAME_REQUIRED'
      });
    }

    const activeSiblings = await prisma.productVariant.findMany({
      where: { productId: product.id, companyId, isActive: true },
      select: { id: true, name: true }
    });
    const duplicate = activeSiblings.some((v: any) => String(v.name).toLowerCase() === name.toLowerCase());
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `An active variant named "${name}" already exists for this product`,
        code: 'VARIANT_NAME_TAKEN'
      });
    }

    const variant = await prisma.productVariant.create({
      data: {
        companyId,
        productId: product.id,
        name,
        sku: nullIfEmpty(value.sku),
        barcode: nullIfEmpty(value.barcode),
        attributes,
        priceDelta: value.priceDelta ?? 0
      }
    });
    return res.status(201).json({ success: true, data: await variantWithStock(prisma, variant) });
  } catch (error: any) {
    console.error('[ProductVariants] POST error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to create product variant' });
  }
};

// Generate the size x colour matrix: creates every combination that
// does not already exist as an ACTIVE variant of the product (matched
// by built name, case-insensitive) and reports the rest as skipped.
export const generateProductVariants = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = generateVariantsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message)
      });
    }

    const companyId = resolveVariantCompanyId(req);
    const product = await findScopedProduct(prisma, req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const matrix = buildVariantMatrix(value.sizes, value.colors);
    if (matrix.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one size or color to generate variants',
        code: 'VARIANT_MATRIX_EMPTY'
      });
    }

    const existing = await prisma.productVariant.findMany({
      where: { productId: product.id, companyId, isActive: true },
      select: { name: true }
    });
    const existingNames = new Set(existing.map((v: any) => String(v.name).toLowerCase()));

    const created: any[] = [];
    let skipped = 0;
    for (const entry of matrix) {
      if (existingNames.has(entry.name.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const variant = await prisma.productVariant.create({
        data: {
          companyId,
          productId: product.id,
          name: entry.name,
          attributes: entry.attributes,
          priceDelta: 0
        }
      });
      created.push(variant);
      existingNames.add(entry.name.toLowerCase());
    }

    return res.status(201).json({
      success: true,
      data: { created, skipped, total: matrix.length },
      message: `${created.length} variant(s) created, ${skipped} already existed`
    });
  } catch (error: any) {
    console.error('[ProductVariants] GENERATE error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to generate product variants' });
  }
};

// Update a variant (name / sku / barcode / attributes / priceDelta /
// isActive). Renaming onto another ACTIVE variant's name is refused.
export const updateProductVariant = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updateVariantSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message)
      });
    }

    const companyId = resolveVariantCompanyId(req);
    const product = await findScopedProduct(prisma, req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const variant = await prisma.productVariant.findFirst({
      where: { id: req.params.variantId, productId: product.id, companyId }
    });
    if (!variant) return res.status(404).json({ success: false, message: 'Variant not found' });

    const data: any = {};
    if (value.name !== undefined) data.name = String(value.name).trim();
    if (value.sku !== undefined) data.sku = nullIfEmpty(value.sku);
    if (value.barcode !== undefined) data.barcode = nullIfEmpty(value.barcode);
    if (value.attributes !== undefined) data.attributes = normalizeAttributes(value.attributes);
    if (value.priceDelta !== undefined) data.priceDelta = value.priceDelta;
    if (value.isActive !== undefined) data.isActive = value.isActive;

    const nextName = data.name ?? variant.name;
    const nextActive = data.isActive ?? variant.isActive;
    if (nextActive && nextName !== variant.name) {
      const activeSiblings = await prisma.productVariant.findMany({
        where: { productId: product.id, companyId, isActive: true, NOT: { id: variant.id } },
        select: { name: true }
      });
      const duplicate = activeSiblings.some((v: any) => String(v.name).toLowerCase() === String(nextName).toLowerCase());
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: `An active variant named "${nextName}" already exists for this product`,
          code: 'VARIANT_NAME_TAKEN'
        });
      }
    }

    const updated = await prisma.productVariant.update({ where: { id: variant.id }, data });
    return res.json({ success: true, data: await variantWithStock(prisma, updated) });
  } catch (error: any) {
    console.error('[ProductVariants] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update product variant' });
  }
};

// Deactivate a variant (soft delete — never a hard delete: batches
// and sale history reference it).
export const deactivateProductVariant = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveVariantCompanyId(req);
    const product = await findScopedProduct(prisma, req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const variant = await prisma.productVariant.findFirst({
      where: { id: req.params.variantId, productId: product.id, companyId }
    });
    if (!variant) return res.status(404).json({ success: false, message: 'Variant not found' });

    const updated = await prisma.productVariant.update({
      where: { id: variant.id },
      data: { isActive: false }
    });
    return res.json({ success: true, data: updated, message: 'Variant deactivated' });
  } catch (error: any) {
    console.error('[ProductVariants] DELETE error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to deactivate product variant' });
  }
};

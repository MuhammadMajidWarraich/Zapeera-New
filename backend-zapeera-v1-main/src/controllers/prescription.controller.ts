import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';

// ─── Prescriptions register (Wave C1 — Pharmacy pack) ───────────────────
// The module existed in the hierarchy + route protection for a long
// time with no model/API/UI behind it; this controller is the register
// itself. Conventions mirror the tax-class / promotion controllers:
//   · Tenancy: every query is scoped to the caller's business (A-02);
//     an id from another tenant reads as "not found".
//   · The register is a LEGAL record: there is NO hard delete. DELETE
//     voids the record (isActive = false + voidReason/voidedAt/
//     voidedBy) and is OWNER/MANAGER/ADMIN only; a voided record keeps
//     its items and its linked sales, but can no longer be edited or
//     attached to a new sale.
//   · Create/edit are open to every role the module grants (counter
//     staff record prescriptions at the POS all day); the router guard
//     (checkModule('prescriptions')) + the route-policy registry
//     (prescriptions.prescriptions) enforce module/page permissions.
//   · Item productName is a snapshot: later product renames never
//     rewrite what the paper prescription said.

const resolvePrescriptionCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const prescriptionScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolvePrescriptionCompanyId(req)
});

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can void a prescription record'
    });
    return false;
  }
  return true;
};

const prescriptionItemSchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().positive().required(),
  dosage: Joi.string().trim().max(60).allow('', null).optional(),
  durationDays: Joi.number().integer().min(1).max(3650).allow(null).optional()
});

const prescriptionFields = {
  branchId: Joi.string().allow(null, '').optional(),
  patientName: Joi.string().trim().min(1).max(160).required(),
  patientPhone: Joi.string().trim().max(40).allow('', null).optional(),
  doctorName: Joi.string().trim().max(160).allow('', null).optional(),
  doctorReg: Joi.string().trim().max(80).allow('', null).optional(),
  notes: Joi.string().trim().max(1000).allow('', null).optional(),
  // The scan/photo of the paper prescription: a data URI (stored
  // inline, like profile pictures) or an uploads path. Generous cap —
  // it is evidence, not an avatar.
  imageUrl: Joi.string().max(7_000_000).allow('', null).optional(),
  issuedDate: Joi.date().required(),
  items: Joi.array().items(prescriptionItemSchema).min(1).required()
};

const createPrescriptionSchema = Joi.object(prescriptionFields);

const updatePrescriptionSchema = Joi.object({
  ...prescriptionFields,
  patientName: Joi.string().trim().min(1).max(160).optional(),
  issuedDate: Joi.date().optional(),
  items: Joi.array().items(prescriptionItemSchema).min(1).optional()
}).min(1);

const voidPrescriptionSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required()
});

const reviewPrescriptionSchema = Joi.object({
  decision: Joi.string().valid('REVIEWED', 'REJECTED').required(),
  note: Joi.string().trim().max(500).allow('', null).optional(),
  // The pharmacist transcribes the paper prescription's medicines
  // while reviewing an upload (uploads arrive with no items). When
  // sent, the line set is REPLACED wholesale, like updatePrescription.
  items: Joi.array().items(prescriptionItemSchema).min(1).optional()
});

/** Every item product must exist inside the caller's business. */
const resolveItemProducts = async (
  prisma: any,
  companyId: string,
  items: Array<{ productId: string }>
): Promise<Map<string, { id: string; name: string }> | null> => {
  const ids = [...new Set(items.map(item => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, name: true }
  });
  if (products.length !== ids.length) return null;
  return new Map(products.map((p: any) => [p.id, p]));
};

const buildItemsData = (
  items: Array<{ productId: string; quantity: number; dosage?: string | null; durationDays?: number | null }>,
  productsById: Map<string, { id: string; name: string }>
) =>
  items.map(item => ({
    productId: item.productId,
    productName: productsById.get(item.productId)?.name || '',
    quantity: item.quantity,
    dosage: item.dosage ? String(item.dosage).trim() : null,
    durationDays: item.durationDays ?? null
  }));

const prescriptionInclude = {
  items: { orderBy: { createdAt: 'asc' as const } },
  _count: { select: { sales: true } }
};

// Create a prescription record (with its medicine lines)
export const createPrescription = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createPrescriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePrescriptionCompanyId(req);

    let branchId: string | null = value.branchId ? String(value.branchId) : null;
    if (!branchId && req.user?.selectedBranchId) {
      branchId = String(req.user.selectedBranchId);
    }
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, companyId },
        select: { id: true }
      });
      if (!branch) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
    }

    const productsById = await resolveItemProducts(prisma, companyId, value.items);
    if (!productsById) {
      return res.status(400).json({
        success: false,
        message: 'One or more prescription items refer to a product that does not exist in this business'
      });
    }

    const prescription = await prisma.prescription.create({
      data: {
        companyId,
        branchId,
        patientName: value.patientName,
        patientPhone: value.patientPhone ? String(value.patientPhone).trim() : null,
        doctorName: value.doctorName ? String(value.doctorName).trim() : null,
        doctorReg: value.doctorReg ? String(value.doctorReg).trim() : null,
        notes: value.notes ? String(value.notes).trim() : null,
        imageUrl: value.imageUrl || null,
        issuedDate: new Date(value.issuedDate),
        // Staff-entered records are REVIEWED at entry (recorded by
        // staff at the counter). Only public storefront uploads start
        // PENDING — see uploadStorePrescription.
        reviewStatus: 'REVIEWED',
        source: 'STAFF',
        createdBy: req.user?.createdBy || req.user?.id || null,
        items: { create: buildItemsData(value.items, productsById) }
      },
      include: prescriptionInclude
    });

    return res.status(201).json({
      success: true,
      data: prescription,
      message: 'Prescription recorded successfully'
    });
  } catch (error) {
    console.error('Create prescription error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List prescriptions for the caller's business.
// Filters: search (patient name or phone), productId (records that
// include the product), from/to (issuedDate range), isActive.
export const getPrescriptions = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 20, search, productId, from, to, isActive, reviewStatus, source } = req.query;

    const where: any = { companyId: resolvePrescriptionCompanyId(req) };
    if (isActive !== undefined) where.isActive = String(isActive) === 'true';
    // Online store (Wave C5 — gap item 5): the pharmacist review
    // queue is GET /prescriptions?reviewStatus=PENDING&source=ONLINE_UPLOAD.
    if (reviewStatus === 'PENDING' || reviewStatus === 'REVIEWED' || reviewStatus === 'REJECTED') {
      where.reviewStatus = String(reviewStatus);
    }
    if (source === 'STAFF' || source === 'ONLINE_UPLOAD') {
      where.source = String(source);
    }
    if (search) {
      const term = String(search);
      where.OR = [
        { patientName: { contains: term } },
        { patientPhone: { contains: term } }
      ];
    }
    if (productId) {
      where.items = { some: { productId: String(productId) } };
    }
    if (from || to) {
      where.issuedDate = {};
      if (from) where.issuedDate.gte = new Date(String(from));
      if (to) {
        const toDate = new Date(String(to));
        toDate.setHours(23, 59, 59, 999);
        where.issuedDate.lte = toDate;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [prescriptions, total] = await Promise.all([
      prisma.prescription.findMany({
        where,
        include: prescriptionInclude,
        orderBy: { issuedDate: 'desc' },
        skip,
        take: Number(limit)
      }),
      prisma.prescription.count({ where })
    ]);

    return res.json({
      success: true,
      data: prescriptions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get prescriptions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one prescription (tenancy-scoped), with the sales that
// dispensed against it.
export const getPrescriptionById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const prescription = await prisma.prescription.findFirst({
      where: prescriptionScopeWhere(req, req.params.id),
      include: {
        ...prescriptionInclude,
        sales: {
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    return res.json({ success: true, data: prescription });
  } catch (error) {
    console.error('Get prescription error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a prescription. Header fields patch individually; when
// `items` is sent it REPLACES the line set wholesale (delete + create
// in one transaction), the same contract as purchase updates (A2).
// Voided records are frozen — they can no longer be edited.
export const updatePrescription = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updatePrescriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePrescriptionCompanyId(req);
    const existing = await prisma.prescription.findFirst({
      where: prescriptionScopeWhere(req, req.params.id),
      select: { id: true, isActive: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    if (!existing.isActive) {
      return res.status(400).json({
        success: false,
        message: 'A voided prescription can no longer be edited',
        code: 'PRESCRIPTION_VOIDED'
      });
    }

    let itemsData: ReturnType<typeof buildItemsData> | undefined;
    if (value.items) {
      const productsById = await resolveItemProducts(prisma, companyId, value.items);
      if (!productsById) {
        return res.status(400).json({
          success: false,
          message: 'One or more prescription items refer to a product that does not exist in this business'
        });
      }
      itemsData = buildItemsData(value.items, productsById);
    }

    if (value.branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: String(value.branchId), companyId },
        select: { id: true }
      });
      if (!branch) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
    }

    const data: any = {};
    if (value.branchId !== undefined) data.branchId = value.branchId || null;
    if (value.patientName !== undefined) data.patientName = value.patientName;
    if (value.patientPhone !== undefined) data.patientPhone = value.patientPhone ? String(value.patientPhone).trim() : null;
    if (value.doctorName !== undefined) data.doctorName = value.doctorName ? String(value.doctorName).trim() : null;
    if (value.doctorReg !== undefined) data.doctorReg = value.doctorReg ? String(value.doctorReg).trim() : null;
    if (value.notes !== undefined) data.notes = value.notes ? String(value.notes).trim() : null;
    if (value.imageUrl !== undefined) data.imageUrl = value.imageUrl || null;
    if (value.issuedDate !== undefined) data.issuedDate = new Date(value.issuedDate);

    const prescription = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.prescription.update({
        where: { id: existing.id },
        data
      });
      if (itemsData) {
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: existing.id } });
        await tx.prescriptionItem.createMany({
          data: itemsData.map(item => ({ ...item, prescriptionId: existing.id }))
        });
      }
      return tx.prescription.findUnique({
        where: { id: updated.id },
        include: prescriptionInclude
      });
    });

    return res.json({
      success: true,
      data: prescription,
      message: 'Prescription updated successfully'
    });
  } catch (error) {
    console.error('Update prescription error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Void a prescription (the register's "delete"): the row, its items
// and its sales links all survive; the record is marked void with a
// reason and can no longer be edited or attached to a new sale.
// OWNER/MANAGER/ADMIN only — this alters a legal record.
export const voidPrescription = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = voidPrescriptionSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'A reason is required to void a prescription record',
        errors: error.details.map(detail => detail.message)
      });
    }

    const existing = await prisma.prescription.findFirst({
      where: prescriptionScopeWhere(req, req.params.id),
      select: { id: true, isActive: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    if (!existing.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This prescription is already voided',
        code: 'PRESCRIPTION_VOIDED'
      });
    }

    const prescription = await prisma.prescription.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        voidReason: value.reason,
        voidedAt: new Date(),
        voidedBy: req.user?.id || null
      },
      include: prescriptionInclude
    });

    return res.json({
      success: true,
      data: prescription,
      message: 'Prescription voided'
    });
  } catch (error) {
    console.error('Void prescription error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Pharmacist review of a prescription (Wave C5 — gap item 5).
// OWNER/MANAGER/ADMIN only — there is no PHARMACIST role (same call
// as the narcotics register, gap item 2). This is the step that
// unblocks dispensing for a customer upload: a PENDING upload cannot
// be attached to any sale (see the gate in sale.controller) until
// this marks it REVIEWED; REJECTED refuses it with a note the patient
// can see on the storefront status check. Approving without items is
// allowed only when the record already has items (staff-entered or
// previously transcribed) — an upload with no items must be
// transcribed in the same call, otherwise the approval would unlock
// a prescription that covers nothing and every Rx checkout against
// it would fail PRESCRIPTION_MISMATCH.
export const reviewPrescription = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = reviewPrescriptionSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePrescriptionCompanyId(req);
    const existing = await prisma.prescription.findFirst({
      where: prescriptionScopeWhere(req, req.params.id),
      include: { items: { select: { id: true } } }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    if (!existing.isActive) {
      return res.status(400).json({
        success: false,
        message: 'A voided prescription can no longer be reviewed',
        code: 'PRESCRIPTION_VOIDED'
      });
    }

    let itemsData: ReturnType<typeof buildItemsData> | undefined;
    if (value.items) {
      const productsById = await resolveItemProducts(prisma, companyId, value.items);
      if (!productsById) {
        return res.status(400).json({
          success: false,
          message: 'One or more prescription items refer to a product that does not exist in this business'
        });
      }
      itemsData = buildItemsData(value.items, productsById);
    }
    if (value.decision === 'REVIEWED' && !itemsData && (existing.items || []).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'This prescription has no medicines listed yet — transcribe its items to approve it.',
        code: 'PRESCRIPTION_NO_ITEMS'
      });
    }

    const prescription = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.prescription.update({
        where: { id: existing.id },
        data: {
          reviewStatus: value.decision,
          reviewedBy: req.user?.id || null,
          reviewedAt: new Date(),
          reviewNote: value.note ? String(value.note).trim() : null
        }
      });
      if (itemsData) {
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: existing.id } });
        await tx.prescriptionItem.createMany({
          data: itemsData.map(item => ({ ...item, prescriptionId: existing.id }))
        });
      }
      return tx.prescription.findUnique({
        where: { id: updated.id },
        include: prescriptionInclude
      });
    });

    return res.json({
      success: true,
      data: prescription,
      message:
        value.decision === 'REVIEWED'
          ? 'Prescription approved — it can now be dispensed against'
          : 'Prescription rejected'
    });
  } catch (error) {
    console.error('Review prescription error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import {
  consultationProductName,
  consultationProductSku,
  round2,
  summarizeDoctorSettlement
} from '../utils/clinic.util';

// ─── Doctors + share settlement (Wave C4 — Clinic pack) ──────────────
// A doctor's consultationFee and sharePercent are DEFAULTS for future
// visits only: completing a visit snapshots the fee actually charged
// and the doctor-share it produced onto the Appointment, and every
// number in the settlement report below comes from those snapshots
// (plus DoctorSettlement payout rows) — never from the doctor's
// current fee/share. Editing a doctor therefore never rewrites
// history.
//
// The consultation fee reaches the visit invoice as a sale line on
// the doctor's auto-ensured SERVICE product ("Consultation — Dr
// <name>", Product.isService = true): the sale engine stores the line
// with batchId null and deducts no stock, because there is nothing to
// stock. See ensureDoctorServiceProduct below and the isService
// branch in sale.controller.

const resolveDoctorCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const doctorScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveDoctorCompanyId(req)
});

const requireManagerRole = (req: AuthRequest, res: Response, action: string): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: `Only the owner or a manager can ${action}`
    });
    return false;
  }
  return true;
};

export const CONSULTATION_CATEGORY_NAME = 'Services';

/**
 * Find-or-create the doctor's consultation service product.
 *
 * Identity is the SKU (`CONSULT-<doctorId>`, globally unique): the
 * first ensure creates the product (under a find-or-created "Services"
 * category at the given branch) and links Doctor.serviceProductId;
 * later ensures reuse it and keep its display name in step with the
 * doctor's current name. Product.branchId records the branch of
 * first ensure — the sale engine does not scope products by branch
 * for stock purposes, and a service has no stock, so one product
 * serves the doctor at every branch.
 */
export const ensureDoctorServiceProduct = async (
  prisma: any,
  args: {
    companyId: string;
    branchId: string;
    doctor: { id: string; name: string; serviceProductId?: string | null };
    createdBy?: string | null;
  }
): Promise<any> => {
  const { companyId, branchId, doctor } = args;
  const sku = consultationProductSku(doctor.id);
  const name = consultationProductName(doctor.name);

  let product: any = null;
  if (doctor.serviceProductId) {
    product = await prisma.product.findFirst({
      where: { id: doctor.serviceProductId, companyId }
    });
  }
  if (!product) {
    const bySku = await prisma.product.findFirst({ where: { sku } });
    if (bySku && bySku.companyId === companyId) product = bySku;
  }

  if (!product) {
    let category = await prisma.category.findFirst({
      where: { companyId, branchId, name: CONSULTATION_CATEGORY_NAME }
    });
    if (!category) {
      category = await prisma.category.create({
        data: {
          name: CONSULTATION_CATEGORY_NAME,
          description: 'Consultations and other non-stock services',
          type: 'GENERAL',
          companyId,
          branchId,
          createdBy: args.createdBy || null
        }
      });
    }
    try {
      product = await prisma.product.create({
        data: {
          name,
          sku,
          description: `Consultation fee for Dr ${doctor.name} (auto-managed service item)`,
          categoryId: category.id,
          branchId,
          companyId,
          createdBy: args.createdBy || null,
          isService: true,
          isActive: true,
          minStock: 0
        }
      });
    } catch (createError: any) {
      // SKU unique race: another ensure created it first — reuse it.
      if (createError?.code !== 'P2002') throw createError;
      product = await prisma.product.findFirst({ where: { sku, companyId } });
      if (!product) throw createError;
    }
  } else {
    const patch: any = {};
    if (product.name !== name) patch.name = name;
    if (!product.isService) patch.isService = true;
    if (!product.isActive) patch.isActive = true;
    if (Object.keys(patch).length > 0) {
      product = await prisma.product.update({ where: { id: product.id }, data: patch });
    }
  }

  if (doctor.serviceProductId !== product.id) {
    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { serviceProductId: product.id }
    });
  }
  return product;
};

/** Best-effort ensure at doctor create/update when a branch context exists. */
const ensureServiceProductQuietly = async (prisma: any, req: AuthRequest, doctor: any) => {
  const branchId = req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null;
  if (!branchId) return;
  try {
    await ensureDoctorServiceProduct(prisma, {
      companyId: doctor.companyId,
      branchId,
      doctor,
      createdBy: req.user?.createdBy || req.user?.id || null
    });
  } catch (error) {
    console.warn('Could not ensure doctor service product:', error);
  }
};

const doctorFields = {
  name: Joi.string().trim().min(1).max(160).required(),
  specialization: Joi.string().trim().max(120).allow('', null).optional(),
  phone: Joi.string().trim().max(40).allow('', null).optional(),
  consultationFee: Joi.number().min(0).default(0),
  sharePercent: Joi.number().min(0).max(100).default(0)
};

const createDoctorSchema = Joi.object(doctorFields);

const updateDoctorSchema = Joi.object({
  ...doctorFields,
  name: Joi.string().trim().min(1).max(160).optional(),
  consultationFee: Joi.number().min(0).optional(),
  sharePercent: Joi.number().min(0).max(100).optional(),
  isActive: Joi.boolean().optional()
}).min(1);

const nullIfEmpty = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

// Create a doctor
export const createDoctor = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createDoctorSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const doctor = await prisma.doctor.create({
      data: {
        companyId: resolveDoctorCompanyId(req),
        name: value.name,
        specialization: nullIfEmpty(value.specialization),
        phone: nullIfEmpty(value.phone),
        consultationFee: value.consultationFee ?? 0,
        sharePercent: value.sharePercent ?? 0,
        createdBy: req.user?.createdBy || req.user?.id || null
      }
    });

    await ensureServiceProductQuietly(prisma, req, doctor);
    const fresh = await prisma.doctor.findUnique({ where: { id: doctor.id } });

    return res.status(201).json({
      success: true,
      data: fresh || doctor,
      message: 'Doctor added successfully'
    });
  } catch (error) {
    console.error('Create doctor error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List doctors for the caller's business.
// Filters: search (name / specialization), isActive.
export const getDoctors = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 50, search, isActive } = req.query;

    const where: any = { companyId: resolveDoctorCompanyId(req) };
    if (isActive !== undefined) where.isActive = String(isActive) === 'true';
    if (search) {
      const term = String(search);
      where.OR = [
        { name: { contains: term } },
        { specialization: { contains: term } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [doctors, total] = await Promise.all([
      prisma.doctor.findMany({
        where,
        include: { _count: { select: { appointments: true } } },
        orderBy: { name: 'asc' },
        skip,
        take: Number(limit)
      }),
      prisma.doctor.count({ where })
    ]);

    return res.json({
      success: true,
      data: doctors,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get doctors error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one doctor (tenancy-scoped).
export const getDoctorById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const doctor = await prisma.doctor.findFirst({
      where: doctorScopeWhere(req, req.params.id),
      include: { _count: { select: { appointments: true, settlements: true } } }
    });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }
    return res.json({ success: true, data: doctor });
  } catch (error) {
    console.error('Get doctor error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a doctor. consultationFee / sharePercent changes apply to
// FUTURE visits only — completed visits keep their snapshots.
export const updateDoctor = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updateDoctorSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const existing = await prisma.doctor.findFirst({
      where: doctorScopeWhere(req, req.params.id),
      select: { id: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const data: any = {};
    if (value.name !== undefined) data.name = value.name;
    if (value.specialization !== undefined) data.specialization = nullIfEmpty(value.specialization);
    if (value.phone !== undefined) data.phone = nullIfEmpty(value.phone);
    if (value.consultationFee !== undefined) data.consultationFee = value.consultationFee;
    if (value.sharePercent !== undefined) data.sharePercent = value.sharePercent;
    if (value.isActive !== undefined) data.isActive = value.isActive;

    const doctor = await prisma.doctor.update({
      where: { id: existing.id },
      data
    });

    await ensureServiceProductQuietly(prisma, req, doctor);
    const fresh = await prisma.doctor.findUnique({ where: { id: doctor.id } });

    return res.json({
      success: true,
      data: fresh || doctor,
      message: 'Doctor updated successfully'
    });
  } catch (error) {
    console.error('Update doctor error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Deactivate a doctor (soft — history and settlements survive, and
// already-booked appointments can still be completed/billed).
// OWNER/MANAGER/ADMIN only.
export const deactivateDoctor = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res, 'deactivate a doctor')) return;
    const prisma = await getPrisma();

    const existing = await prisma.doctor.findFirst({
      where: doctorScopeWhere(req, req.params.id),
      select: { id: true, isActive: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }
    if (!existing.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This doctor is already inactive',
        code: 'DOCTOR_INACTIVE'
      });
    }

    const doctor = await prisma.doctor.update({
      where: { id: existing.id },
      data: { isActive: false }
    });

    return res.json({
      success: true,
      data: doctor,
      message: 'Doctor deactivated'
    });
  } catch (error) {
    console.error('Deactivate doctor error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── Settlement ──────────────────────────────────────────────────────

// Parse ?from&to (date-only strings) into an inclusive window,
// following the list-filter convention of the other controllers.
const parsePeriod = (req: AuthRequest): { fromDate: Date; toDate: Date } => {
  const { from, to } = req.query;
  const now = new Date();
  const fromDate = from
    ? new Date(String(from))
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = to ? new Date(String(to)) : now;
  toDate.setHours(23, 59, 59, 999);
  return { fromDate, toDate };
};

// GET /doctors/settlement-report?from&to[&doctorId]
// Per doctor: completed visits in the window, consultation revenue
// (Σ feeCharged snapshots), doctor share earned (Σ doctorShareAmount
// snapshots), the clinic's remainder, settlements PAID in the window
// (by payout date), and outstanding = earned − settled.
export const getDoctorSettlementReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveDoctorCompanyId(req);
    const { fromDate, toDate } = parsePeriod(req);
    const doctorId = req.query.doctorId ? String(req.query.doctorId) : null;

    const doctors = await prisma.doctor.findMany({
      where: { companyId, ...(doctorId ? { id: doctorId } : {}) },
      select: { id: true, name: true, specialization: true, isActive: true },
      orderBy: { name: 'asc' }
    });
    const doctorIds = doctors.map((d: any) => d.id);

    const [visits, payments] = await Promise.all([
      doctorIds.length
        ? prisma.appointment.findMany({
            where: {
              companyId,
              doctorId: { in: doctorIds },
              status: 'COMPLETED',
              appointmentDate: { gte: fromDate, lte: toDate }
            },
            select: { doctorId: true, feeCharged: true, doctorShareAmount: true }
          })
        : Promise.resolve([]),
      doctorIds.length
        ? prisma.doctorSettlement.findMany({
            where: {
              companyId,
              doctorId: { in: doctorIds },
              createdAt: { gte: fromDate, lte: toDate }
            },
            select: { doctorId: true, amount: true }
          })
        : Promise.resolve([])
    ]);

    const rows = doctors.map((doctor: any) => ({
      doctor: {
        id: doctor.id,
        name: doctor.name,
        specialization: doctor.specialization,
        isActive: doctor.isActive
      },
      ...summarizeDoctorSettlement(doctor.id, visits as any, payments as any)
    }));

    const totals = rows.reduce(
      (acc: any, row: any) => ({
        visits: acc.visits + row.visits,
        consultationRevenue: round2(acc.consultationRevenue + row.consultationRevenue),
        doctorShare: round2(acc.doctorShare + row.doctorShare),
        clinicShare: round2(acc.clinicShare + row.clinicShare),
        settled: round2(acc.settled + row.settled),
        outstanding: round2(acc.outstanding + row.outstanding)
      }),
      { visits: 0, consultationRevenue: 0, doctorShare: 0, clinicShare: 0, settled: 0, outstanding: 0 }
    );

    return res.json({
      success: true,
      data: {
        period: { from: fromDate.toISOString(), to: toDate.toISOString() },
        doctors: rows,
        totals
      }
    });
  } catch (error) {
    console.error('Doctor settlement report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const createSettlementSchema = Joi.object({
  doctorId: Joi.string().required(),
  from: Joi.date().required(),
  to: Joi.date().required(),
  amount: Joi.number().positive().required(),
  note: Joi.string().trim().max(500).allow('', null).optional()
});

// POST /doctors/settlements — record a share payout to a doctor.
// OWNER/MANAGER/ADMIN only (money leaving the clinic).
export const createDoctorSettlement = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res, 'record a doctor settlement')) return;
    const prisma = await getPrisma();
    const { error, value } = createSettlementSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    if (new Date(value.to).getTime() < new Date(value.from).getTime()) {
      return res.status(400).json({ success: false, message: 'The settlement period end must not be before its start' });
    }

    const companyId = resolveDoctorCompanyId(req);
    const doctor = await prisma.doctor.findFirst({
      where: { id: value.doctorId, companyId },
      select: { id: true, name: true }
    });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    const settlement = await prisma.doctorSettlement.create({
      data: {
        companyId,
        doctorId: doctor.id,
        periodFrom: new Date(value.from),
        periodTo: new Date(value.to),
        amount: round2(value.amount),
        note: nullIfEmpty(value.note),
        createdBy: req.user?.createdBy || req.user?.id || null
      },
      include: { doctor: { select: { id: true, name: true, specialization: true } } }
    });

    return res.status(201).json({
      success: true,
      data: settlement,
      message: 'Settlement recorded successfully'
    });
  } catch (error) {
    console.error('Create doctor settlement error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /doctors/settlements[?doctorId&from&to] — payout history,
// newest first. from/to filter the PAYOUT date (createdAt).
export const getDoctorSettlements = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 50, doctorId, from, to } = req.query;

    const where: any = { companyId: resolveDoctorCompanyId(req) };
    if (doctorId) where.doctorId = String(doctorId);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(String(from));
      if (to) {
        const toDate = new Date(String(to));
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [settlements, total] = await Promise.all([
      prisma.doctorSettlement.findMany({
        where,
        include: { doctor: { select: { id: true, name: true, specialization: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit)
      }),
      prisma.doctorSettlement.count({ where })
    ]);

    return res.json({
      success: true,
      data: settlements,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get doctor settlements error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

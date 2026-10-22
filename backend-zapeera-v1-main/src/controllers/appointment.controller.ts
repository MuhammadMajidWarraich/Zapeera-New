import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { createSale, SALE_PAYMENT_METHODS } from './sale.controller';
import { ensureDoctorServiceProduct } from './doctor.controller';
import {
  canTransitionAppointment,
  computeDoctorShare,
  isAppointmentStatus,
  nextTokenNumber,
  normalizeAppointmentDate,
  round2
} from '../utils/clinic.util';

// ─── Appointments + OPD queue (Wave C4 — Clinic pack) ────────────────
// Booking assigns the patient's token in the doctor's queue for the
// day (per doctor+date sequence, server-side, never reused — a
// cancelled token leaves a gap, exactly like a paper token book).
// The status flow is BOOKED → CHECKED_IN → IN_VISIT → COMPLETED, with
// CANCELLED / NO_SHOW reachable from BOOKED / CHECKED_IN. COMPLETED
// is only reachable through complete-visit, because completion IS
// billing: it creates the visit invoice through the normal sale
// engine (createSale itself — totals, tender allocations, tax,
// promotions, FBR outbox and receipts all behave exactly as at the
// POS), snapshots feeCharged + doctorShareAmount onto the
// appointment, and links the sale + any prescription it wrote.

const resolveAppointmentCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const appointmentScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveAppointmentCompanyId(req)
});

const appointmentInclude = {
  patient: { select: { id: true, name: true, phone: true, age: true, gender: true } },
  doctor: { select: { id: true, name: true, specialization: true } }
};

const createAppointmentSchema = Joi.object({
  patientId: Joi.string().required(),
  doctorId: Joi.string().required(),
  branchId: Joi.string().allow(null, '').optional(),
  appointmentDate: Joi.date().required(),
  reason: Joi.string().trim().max(500).allow('', null).optional(),
  notes: Joi.string().trim().max(1000).allow('', null).optional()
});

const updateStatusSchema = Joi.object({
  status: Joi.string().trim().uppercase().required()
});

const completeVisitSchema = Joi.object({
  // Defaults to the doctor's current consultationFee; an explicit 0
  // is a free visit (no fee line, and no sale at all when nothing
  // else is billed either).
  feeCharged: Joi.number().min(0).optional(),
  items: Joi.array().items(Joi.object({
    productId: Joi.string().required(),
    quantity: Joi.number().min(1).required(),
    unitPrice: Joi.number().min(0).required(),
    batchId: Joi.string().allow(null, '').optional()
  })).optional(),
  prescriptionItems: Joi.array().items(Joi.object({
    productId: Joi.string().required(),
    quantity: Joi.number().positive().required(),
    dosage: Joi.string().trim().max(60).allow('', null).optional(),
    durationDays: Joi.number().integer().min(1).max(3650).allow(null).optional()
  })).optional(),
  prescriptionNotes: Joi.string().trim().max(1000).allow('', null).optional(),
  paymentMethod: Joi.string().valid(...SALE_PAYMENT_METHODS).optional(),
  paymentStatus: Joi.string().valid('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED').optional(),
  paidAmount: Joi.number().min(0).optional(),
  payments: Joi.array().items(Joi.object({
    method: Joi.string().valid(...SALE_PAYMENT_METHODS).required(),
    amount: Joi.number().positive().required(),
    reference: Joi.string().allow('', null).max(120).optional()
  })).optional()
});

/** Every prescription item product must exist inside the business (mirrors C1). */
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

/**
 * Run the real sale engine for a composed payload, in-process.
 * createSale is an Express handler; we lend it this request (auth,
 * membership and tenancy context are already resolved by this
 * router's middleware) with the body swapped for the visit payload,
 * and capture its response. While it runs, the caller's selected
 * branch is pinned to the visit's branch so stock and the invoice
 * land where the visit happened. Both are restored afterwards.
 */
const invokeCreateSale = async (
  req: AuthRequest,
  companyId: string,
  payload: any
): Promise<{ status: number; body: any }> => {
  const originalBody = (req as any).body;
  const originalUser = (req as any).user;
  let status = 500;
  let body: any = null;
  const captureRes: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(responseBody: any) {
      body = responseBody;
      return this;
    }
  };
  try {
    (req as any).body = payload;
    if (originalUser && payload.branchId) {
      (req as any).user = {
        ...originalUser,
        selectedCompanyId: companyId,
        selectedBranchId: payload.branchId
      };
    }
    await createSale(req as any, captureRes);
  } finally {
    (req as any).body = originalBody;
    (req as any).user = originalUser;
  }
  return { status, body };
};

// Book an appointment — assigns the next token for doctor + date.
export const createAppointment = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createAppointmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveAppointmentCompanyId(req);

    const [patient, doctor] = await Promise.all([
      prisma.patient.findFirst({
        where: { id: value.patientId, companyId },
        select: { id: true, isActive: true }
      }),
      prisma.doctor.findFirst({
        where: { id: value.doctorId, companyId },
        select: { id: true, isActive: true }
      })
    ]);
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    if (!patient.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This patient record is inactive and cannot be booked',
        code: 'PATIENT_INACTIVE'
      });
    }
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }
    if (!doctor.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This doctor is inactive and cannot take new bookings',
        code: 'DOCTOR_INACTIVE'
      });
    }

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

    const appointmentDate = normalizeAppointmentDate(value.appointmentDate);
    const createdBy = req.user?.createdBy || req.user?.id || null;

    // Token assignment: next after the day's current maximum. The
    // (doctorId, appointmentDate, tokenNumber) unique constraint is
    // the backstop — on a collision (two desks booking at once) we
    // recompute and retry instead of failing the booking.
    let appointment: any = null;
    for (let attempt = 0; attempt < 5 && !appointment; attempt++) {
      const existing = await prisma.appointment.findMany({
        where: { companyId, doctorId: doctor.id, appointmentDate },
        select: { tokenNumber: true }
      });
      const tokenNumber = nextTokenNumber(existing.map((a: any) => a.tokenNumber));
      try {
        appointment = await prisma.appointment.create({
          data: {
            companyId,
            branchId,
            patientId: patient.id,
            doctorId: doctor.id,
            appointmentDate,
            tokenNumber,
            status: 'BOOKED',
            reason: value.reason ? String(value.reason).trim() : null,
            notes: value.notes ? String(value.notes).trim() : null,
            createdBy
          },
          include: appointmentInclude
        });
      } catch (createError: any) {
        if (createError?.code === 'P2002' && attempt < 4) continue;
        throw createError;
      }
    }

    return res.status(201).json({
      success: true,
      data: appointment,
      message: `Appointment booked — token ${appointment.tokenNumber}`
    });
  } catch (error) {
    console.error('Create appointment error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List appointments. Filters: date (single day), from/to (range),
// doctorId, patientId, status. Ordered as the day queue reads:
// date, then token.
export const getAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 100, date, from, to, doctorId, patientId, status } = req.query;

    const where: any = { companyId: resolveAppointmentCompanyId(req) };
    if (doctorId) where.doctorId = String(doctorId);
    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status).toUpperCase();
    if (date) {
      const day = normalizeAppointmentDate(String(date));
      where.appointmentDate = {
        gte: day,
        lt: new Date(day.getTime() + 24 * 60 * 60 * 1000)
      };
    } else if (from || to) {
      where.appointmentDate = {};
      if (from) where.appointmentDate.gte = normalizeAppointmentDate(String(from));
      if (to) {
        const toDay = normalizeAppointmentDate(String(to));
        where.appointmentDate.lt = new Date(toDay.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: appointmentInclude,
        orderBy: [{ appointmentDate: 'asc' }, { tokenNumber: 'asc' }],
        skip,
        take: Number(limit)
      }),
      prisma.appointment.count({ where })
    ]);

    return res.json({
      success: true,
      data: appointments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get appointments error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one appointment (tenancy-scoped) with its billing links.
export const getAppointmentById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const appointment = await prisma.appointment.findFirst({
      where: appointmentScopeWhere(req, req.params.id),
      include: {
        ...appointmentInclude,
        sale: {
          select: { id: true, invoiceNumber: true, totalAmount: true, paymentStatus: true, createdAt: true }
        },
        prescription: {
          select: { id: true, patientName: true, doctorName: true, issuedDate: true }
        }
      }
    });
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    return res.json({ success: true, data: appointment });
  } catch (error) {
    console.error('Get appointment error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Move an appointment along the OPD flow. COMPLETED is refused here —
// completion bills the visit, so it must go through complete-visit.
export const updateAppointmentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updateStatusSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    const target = value.status;
    if (!isAppointmentStatus(target)) {
      return res.status(400).json({
        success: false,
        message: `Unknown appointment status "${target}"`,
        code: 'INVALID_STATUS'
      });
    }
    if (target === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'A visit is completed through complete-visit, which bills it — not through a status change',
        code: 'USE_COMPLETE_VISIT'
      });
    }

    const existing = await prisma.appointment.findFirst({
      where: appointmentScopeWhere(req, req.params.id),
      select: { id: true, status: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    if (!canTransitionAppointment(existing.status, target)) {
      return res.status(400).json({
        success: false,
        message: `An appointment in status ${existing.status} cannot move to ${target}`,
        code: 'INVALID_TRANSITION'
      });
    }

    const appointment = await prisma.appointment.update({
      where: { id: existing.id },
      data: { status: target },
      include: appointmentInclude
    });

    return res.json({
      success: true,
      data: appointment,
      message: `Appointment marked ${target}`
    });
  } catch (error) {
    console.error('Update appointment status error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Complete a visit: bill it and close it.
//   · Reachable from CHECKED_IN or IN_VISIT (a small clinic may not
//     use the IN_VISIT step; the visit plainly happened either way).
//   · The fee line rides the doctor's service product — no stock.
//   · Extra items are ordinary stock lines through the sale engine.
//   · prescriptionItems (optional) write a C1 Prescription first —
//     patient/doctor names from the records — which is then attached
//     to the sale (Sale.prescriptionId) AND linked here. The register
//     record stands even if billing then fails: the doctor did write
//     it; only the appointment stays un-completed in that case.
//   · A zero fee with no extra items completes WITHOUT a sale
//     (a free visit bills nothing) — saleId stays null.
export const completeVisit = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = completeVisitSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveAppointmentCompanyId(req);
    const appointment = await prisma.appointment.findFirst({
      where: appointmentScopeWhere(req, req.params.id),
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        doctor: true
      }
    });
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    if (appointment.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'This visit is already completed and billed',
        code: 'APPOINTMENT_COMPLETED'
      });
    }
    if (!['CHECKED_IN', 'IN_VISIT'].includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: `A visit in status ${appointment.status} cannot be completed — check the patient in first`,
        code: 'APPOINTMENT_NOT_IN_VISIT'
      });
    }

    const doctor = appointment.doctor;
    const patient = appointment.patient;
    const createdBy = req.user?.createdBy || req.user?.id || null;

    const branchId: string | null =
      appointment.branchId ||
      (req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null);
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'No branch context for this visit — open the clinic from a branch first',
        code: 'NO_BRANCH_CONTEXT'
      });
    }

    const feeCharged = round2(
      value.feeCharged !== undefined ? value.feeCharged : (doctor.consultationFee || 0)
    );

    // 1) The prescription the doctor wrote (C1 register), if any.
    let prescription: any = null;
    if (Array.isArray(value.prescriptionItems) && value.prescriptionItems.length > 0) {
      const productsById = await resolveItemProducts(prisma, companyId, value.prescriptionItems);
      if (!productsById) {
        return res.status(400).json({
          success: false,
          message: 'One or more prescription items refer to a product that does not exist in this business'
        });
      }
      prescription = await prisma.prescription.create({
        data: {
          companyId,
          branchId,
          patientName: patient.name,
          patientPhone: patient.phone || null,
          doctorName: doctor.name,
          doctorReg: null,
          notes: value.prescriptionNotes ? String(value.prescriptionNotes).trim() : null,
          issuedDate: new Date(),
          createdBy,
          items: {
            create: value.prescriptionItems.map((item: any) => ({
              productId: item.productId,
              productName: productsById.get(item.productId)?.name || '',
              quantity: item.quantity,
              dosage: item.dosage ? String(item.dosage).trim() : null,
              durationDays: item.durationDays ?? null
            }))
          }
        }
      });
    }

    // 2) Compose the visit invoice: fee line (service, no stock) +
    //    any extra stock lines.
    const saleItems: any[] = [];
    if (feeCharged > 0) {
      const serviceProduct = await ensureDoctorServiceProduct(prisma, {
        companyId,
        branchId,
        doctor,
        createdBy
      });
      saleItems.push({
        productId: serviceProduct.id,
        quantity: 1,
        unitPrice: feeCharged
      });
    }
    for (const item of value.items || []) {
      saleItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        ...(item.batchId ? { batchId: item.batchId } : {})
      });
    }

    // 3) Bill it through the real sale engine (skipped only when
    //    there is genuinely nothing to bill).
    let sale: any = null;
    if (saleItems.length > 0) {
      const payload: any = {
        branchId,
        items: saleItems,
        paymentMethod: value.paymentMethod || 'CASH'
      };
      if (value.paymentStatus) payload.paymentStatus = value.paymentStatus;
      if (value.paidAmount !== undefined) payload.paidAmount = value.paidAmount;
      if (Array.isArray(value.payments) && value.payments.length > 0) payload.payments = value.payments;
      if (prescription) payload.prescriptionId = prescription.id;

      const outcome = await invokeCreateSale(req, companyId, payload);
      if (outcome.status !== 201 || !outcome.body?.success) {
        // Billing failed (stock, tender mismatch, Rx enforcement…):
        // surface the sale engine's own status + message untouched;
        // the appointment stays un-completed so the desk can retry.
        return res.status(outcome.status || 500).json(
          outcome.body || { success: false, message: 'Visit billing failed' }
        );
      }
      sale = outcome.body.data;
    }

    // 4) Snapshot the money split and close the visit.
    const { doctorShare } = computeDoctorShare(feeCharged, doctor.sharePercent);
    const updated = await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'COMPLETED',
        saleId: sale?.id || null,
        prescriptionId: prescription?.id || appointment.prescriptionId || null,
        feeCharged,
        doctorShareAmount: doctorShare
      },
      include: appointmentInclude
    });

    return res.status(201).json({
      success: true,
      data: {
        appointment: updated,
        sale,
        prescription: prescription
          ? { id: prescription.id, patientName: prescription.patientName, doctorName: prescription.doctorName }
          : null
      },
      message: 'Visit completed'
    });
  } catch (error) {
    console.error('Complete visit error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';

// ─── Patients (Wave C4 — Clinic pack) ────────────────────────────────
// Patient-Lite: the clinic's register of the people it treats. It is
// deliberately NOT the sales Customer register — a patient record is
// clinical (age/gender/CNIC/notes), carries no khata or loyalty, and a
// visit invoice never points at it (the Appointment links patient ↔
// sale instead). Conventions mirror the prescription controller:
//   · Every query is scoped to the caller's business (A-02); an id
//     from another tenant reads as "not found".
//   · No hard delete: DELETE deactivates (isActive = false) and is
//     OWNER/MANAGER/ADMIN only; the record and its visit history stay
//     readable and it can be reactivated by an update.

const resolvePatientCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const patientScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolvePatientCompanyId(req)
});

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can deactivate a patient record'
    });
    return false;
  }
  return true;
};

const patientFields = {
  branchId: Joi.string().allow(null, '').optional(),
  name: Joi.string().trim().min(1).max(160).required(),
  phone: Joi.string().trim().max(40).allow('', null).optional(),
  age: Joi.number().integer().min(0).max(130).allow(null).optional(),
  gender: Joi.string().trim().max(20).allow('', null).optional(),
  cnic: Joi.string().trim().max(20).allow('', null).optional(),
  address: Joi.string().trim().max(500).allow('', null).optional(),
  notes: Joi.string().trim().max(1000).allow('', null).optional()
};

const createPatientSchema = Joi.object(patientFields);

const updatePatientSchema = Joi.object({
  ...patientFields,
  name: Joi.string().trim().min(1).max(160).optional(),
  isActive: Joi.boolean().optional()
}).min(1);

const nullIfEmpty = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

// Create a patient record
export const createPatient = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createPatientSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePatientCompanyId(req);

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

    const patient = await prisma.patient.create({
      data: {
        companyId,
        branchId,
        name: value.name,
        phone: nullIfEmpty(value.phone),
        age: value.age ?? null,
        gender: nullIfEmpty(value.gender),
        cnic: nullIfEmpty(value.cnic),
        address: nullIfEmpty(value.address),
        notes: nullIfEmpty(value.notes),
        createdBy: req.user?.createdBy || req.user?.id || null
      }
    });

    return res.status(201).json({
      success: true,
      data: patient,
      message: 'Patient registered successfully'
    });
  } catch (error) {
    console.error('Create patient error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List patients for the caller's business.
// Filters: search (name / phone / CNIC), isActive.
export const getPatients = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 20, search, isActive } = req.query;

    const where: any = { companyId: resolvePatientCompanyId(req) };
    if (isActive !== undefined) where.isActive = String(isActive) === 'true';
    if (search) {
      const term = String(search);
      where.OR = [
        { name: { contains: term } },
        { phone: { contains: term } },
        { cnic: { contains: term } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        include: { _count: { select: { appointments: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit)
      }),
      prisma.patient.count({ where })
    ]);

    return res.json({
      success: true,
      data: patients,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get patients error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one patient (tenancy-scoped) with their visit history.
export const getPatientById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const patient = await prisma.patient.findFirst({
      where: patientScopeWhere(req, req.params.id),
      include: {
        appointments: {
          include: {
            doctor: { select: { id: true, name: true, specialization: true } }
          },
          orderBy: [{ appointmentDate: 'desc' }, { tokenNumber: 'desc' }],
          take: 50
        }
      }
    });
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    return res.json({ success: true, data: patient });
  } catch (error) {
    console.error('Get patient error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a patient record (fields patch individually).
export const updatePatient = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updatePatientSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePatientCompanyId(req);
    const existing = await prisma.patient.findFirst({
      where: patientScopeWhere(req, req.params.id),
      select: { id: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
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
    if (value.name !== undefined) data.name = value.name;
    if (value.phone !== undefined) data.phone = nullIfEmpty(value.phone);
    if (value.age !== undefined) data.age = value.age ?? null;
    if (value.gender !== undefined) data.gender = nullIfEmpty(value.gender);
    if (value.cnic !== undefined) data.cnic = nullIfEmpty(value.cnic);
    if (value.address !== undefined) data.address = nullIfEmpty(value.address);
    if (value.notes !== undefined) data.notes = nullIfEmpty(value.notes);
    if (value.isActive !== undefined) data.isActive = value.isActive;

    const patient = await prisma.patient.update({
      where: { id: existing.id },
      data
    });

    return res.json({
      success: true,
      data: patient,
      message: 'Patient updated successfully'
    });
  } catch (error) {
    console.error('Update patient error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Deactivate a patient (the register's "delete"): the row and its
// visit history survive; the patient simply stops appearing in
// active lists and cannot be booked until reactivated.
// OWNER/MANAGER/ADMIN only.
export const deactivatePatient = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();

    const existing = await prisma.patient.findFirst({
      where: patientScopeWhere(req, req.params.id),
      select: { id: true, isActive: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    if (!existing.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This patient is already inactive',
        code: 'PATIENT_INACTIVE'
      });
    }

    const patient = await prisma.patient.update({
      where: { id: existing.id },
      data: { isActive: false }
    });

    return res.json({
      success: true,
      data: patient,
      message: 'Patient deactivated'
    });
  } catch (error) {
    console.error('Deactivate patient error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

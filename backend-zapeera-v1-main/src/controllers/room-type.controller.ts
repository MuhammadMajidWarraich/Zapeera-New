import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';

// ─── Room types (Wave C5 — Hotel pack) ───────────────────────────────
// A room type is a category of room plus its nightly rate. The rate
// is only a default for future stays: check-in snapshots it onto the
// Folio, so editing a type never reprices a guest already in-house.
// Conventions mirror the clinic pack (patients/doctors):
//   · Every query is scoped to the caller's business; an id from
//     another tenant reads as "not found".
//   · No hard delete: DELETE deactivates (isActive = false) and is
//     OWNER/MANAGER/ADMIN only; rooms of the type keep working and
//     the type can be reactivated by an update.

const resolveRoomTypeCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const roomTypeScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveRoomTypeCompanyId(req)
});

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can deactivate a room type'
    });
    return false;
  }
  return true;
};

const roomTypeFields = {
  name: Joi.string().trim().min(1).max(120).required(),
  ratePerNight: Joi.number().min(0).default(0),
  capacity: Joi.number().integer().min(1).max(50).allow(null).optional(),
  description: Joi.string().trim().max(500).allow('', null).optional()
};

const createRoomTypeSchema = Joi.object(roomTypeFields);

const updateRoomTypeSchema = Joi.object({
  ...roomTypeFields,
  name: Joi.string().trim().min(1).max(120).optional(),
  ratePerNight: Joi.number().min(0).optional(),
  isActive: Joi.boolean().optional()
}).min(1);

const nullIfEmpty = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

// Create a room type
export const createRoomType = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createRoomTypeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveRoomTypeCompanyId(req);

    const roomType = await prisma.roomType.create({
      data: {
        companyId,
        name: value.name,
        ratePerNight: value.ratePerNight ?? 0,
        capacity: value.capacity ?? null,
        description: nullIfEmpty(value.description),
        createdBy: req.user?.createdBy || req.user?.id || null
      }
    });

    return res.status(201).json({
      success: true,
      data: roomType,
      message: 'Room type created successfully'
    });
  } catch (error) {
    console.error('Create room type error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List room types for the caller's business. Filter: isActive.
export const getRoomTypes = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { isActive } = req.query;

    const where: any = { companyId: resolveRoomTypeCompanyId(req) };
    if (isActive !== undefined) where.isActive = String(isActive) === 'true';

    const roomTypes = await prisma.roomType.findMany({
      where,
      include: { _count: { select: { rooms: true } } },
      orderBy: { name: 'asc' }
    });

    return res.json({ success: true, data: roomTypes });
  } catch (error) {
    console.error('Get room types error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one room type (tenancy-scoped).
export const getRoomTypeById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const roomType = await prisma.roomType.findFirst({
      where: roomTypeScopeWhere(req, req.params.id),
      include: { _count: { select: { rooms: true } } }
    });
    if (!roomType) {
      return res.status(404).json({ success: false, message: 'Room type not found' });
    }
    return res.json({ success: true, data: roomType });
  } catch (error) {
    console.error('Get room type error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a room type (rate changes apply to future check-ins only —
// in-house folios keep their snapshot).
export const updateRoomType = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updateRoomTypeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const existing = await prisma.roomType.findFirst({
      where: roomTypeScopeWhere(req, req.params.id),
      select: { id: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Room type not found' });
    }

    const data: any = {};
    if (value.name !== undefined) data.name = value.name;
    if (value.ratePerNight !== undefined) data.ratePerNight = value.ratePerNight;
    if (value.capacity !== undefined) data.capacity = value.capacity ?? null;
    if (value.description !== undefined) data.description = nullIfEmpty(value.description);
    if (value.isActive !== undefined) data.isActive = value.isActive;

    const roomType = await prisma.roomType.update({
      where: { id: existing.id },
      data
    });

    return res.json({
      success: true,
      data: roomType,
      message: 'Room type updated successfully'
    });
  } catch (error) {
    console.error('Update room type error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Deactivate a room type (the register's "delete"). Rooms already
// created under it are untouched. OWNER/MANAGER/ADMIN only.
export const deactivateRoomType = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();

    const existing = await prisma.roomType.findFirst({
      where: roomTypeScopeWhere(req, req.params.id),
      select: { id: true, isActive: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Room type not found' });
    }
    if (!existing.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This room type is already inactive',
        code: 'ROOM_TYPE_INACTIVE'
      });
    }

    const roomType = await prisma.roomType.update({
      where: { id: existing.id },
      data: { isActive: false }
    });

    return res.json({
      success: true,
      data: roomType,
      message: 'Room type deactivated'
    });
  } catch (error) {
    console.error('Deactivate room type error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

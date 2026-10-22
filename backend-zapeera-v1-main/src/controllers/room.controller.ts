import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import { canTransitionRoomStatus, isRoomStatus } from '../utils/hotel.util';

// ─── Rooms (Wave C5 — Hotel pack) ────────────────────────────────────
// One physical room, unique door number per business. The room's
// `status` is the front-desk board state:
//   AVAILABLE → OCCUPIED (check-in) → DIRTY (check-out) → AVAILABLE
//   (housekeeping "mark cleaned"); AVAILABLE/DIRTY ⇄ MAINTENANCE.
// OCCUPIED is owned by the check-in/check-out flows: the status
// endpoint here enforces hotel.util's manual machine and refuses to
// set or clear OCCUPIED by hand, so the board can never disagree
// with the folio register about who is in-house.
// Soft-deactivate for delete, OWNER/MANAGER/ADMIN only — as the rest
// of the pack.

const resolveRoomCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const roomScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveRoomCompanyId(req)
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

const roomInclude = {
  roomType: { select: { id: true, name: true, ratePerNight: true, capacity: true } }
};

const roomFields = {
  roomTypeId: Joi.string().required(),
  number: Joi.string().trim().min(1).max(20).required(),
  branchId: Joi.string().allow(null, '').optional(),
  floor: Joi.string().trim().max(20).allow('', null).optional()
};

const createRoomSchema = Joi.object(roomFields);

const updateRoomSchema = Joi.object({
  ...roomFields,
  roomTypeId: Joi.string().optional(),
  number: Joi.string().trim().min(1).max(20).optional(),
  isActive: Joi.boolean().optional()
}).min(1);

const updateRoomStatusSchema = Joi.object({
  status: Joi.string().trim().uppercase().required()
});

const nullIfEmpty = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

const duplicateNumberError = (res: Response) =>
  res.status(409).json({
    success: false,
    message: 'A room with this number already exists in this business',
    code: 'ROOM_NUMBER_TAKEN'
  });

// Create a room. The door number is unique per business (schema
// unique constraint is the backstop; the pre-check gives a clean 409).
export const createRoom = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createRoomSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveRoomCompanyId(req);

    const roomType = await prisma.roomType.findFirst({
      where: { id: value.roomTypeId, companyId },
      select: { id: true, isActive: true }
    });
    if (!roomType) {
      return res.status(404).json({ success: false, message: 'Room type not found' });
    }
    if (!roomType.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This room type is inactive and cannot take new rooms',
        code: 'ROOM_TYPE_INACTIVE'
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

    const clash = await prisma.room.findFirst({
      where: { companyId, number: value.number },
      select: { id: true }
    });
    if (clash) return duplicateNumberError(res);

    try {
      const room = await prisma.room.create({
        data: {
          companyId,
          branchId,
          roomTypeId: roomType.id,
          number: value.number,
          floor: nullIfEmpty(value.floor),
          createdBy: req.user?.createdBy || req.user?.id || null
        },
        include: roomInclude
      });
      return res.status(201).json({
        success: true,
        data: room,
        message: 'Room created successfully'
      });
    } catch (createError: any) {
      if (createError?.code === 'P2002') return duplicateNumberError(res);
      throw createError;
    }
  } catch (error) {
    console.error('Create room error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List rooms. Filters: roomTypeId, status, isActive, search (number).
export const getRooms = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { roomTypeId, status, isActive, search } = req.query;

    const where: any = { companyId: resolveRoomCompanyId(req) };
    if (roomTypeId) where.roomTypeId = String(roomTypeId);
    if (status) where.status = String(status).toUpperCase();
    if (isActive !== undefined) where.isActive = String(isActive) === 'true';
    if (search) where.number = { contains: String(search) };

    const rooms = await prisma.room.findMany({
      where,
      include: roomInclude,
      orderBy: [{ floor: 'asc' }, { number: 'asc' }]
    });

    return res.json({ success: true, data: rooms });
  } catch (error) {
    console.error('Get rooms error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one room (tenancy-scoped), with its current stay if occupied.
export const getRoomById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const room = await prisma.room.findFirst({
      where: roomScopeWhere(req, req.params.id),
      include: {
        ...roomInclude,
        folios: {
          where: { status: 'OPEN' },
          select: { id: true, guestName: true, openedAt: true },
          take: 1
        }
      }
    });
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    return res.json({ success: true, data: room });
  } catch (error) {
    console.error('Get room error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a room (type, number, floor, branch, active flag).
export const updateRoom = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updateRoomSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveRoomCompanyId(req);
    const existing = await prisma.room.findFirst({
      where: roomScopeWhere(req, req.params.id),
      select: { id: true, number: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if (value.roomTypeId) {
      const roomType = await prisma.roomType.findFirst({
        where: { id: value.roomTypeId, companyId },
        select: { id: true }
      });
      if (!roomType) {
        return res.status(404).json({ success: false, message: 'Room type not found' });
      }
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
    if (value.number && value.number !== existing.number) {
      const clash = await prisma.room.findFirst({
        where: { companyId, number: value.number, id: { not: existing.id } },
        select: { id: true }
      });
      if (clash) return duplicateNumberError(res);
    }

    const data: any = {};
    if (value.roomTypeId !== undefined) data.roomTypeId = value.roomTypeId;
    if (value.number !== undefined) data.number = value.number;
    if (value.branchId !== undefined) data.branchId = value.branchId || null;
    if (value.floor !== undefined) data.floor = nullIfEmpty(value.floor);
    if (value.isActive !== undefined) data.isActive = value.isActive;

    try {
      const room = await prisma.room.update({
        where: { id: existing.id },
        data,
        include: roomInclude
      });
      return res.json({
        success: true,
        data: room,
        message: 'Room updated successfully'
      });
    } catch (updateError: any) {
      if (updateError?.code === 'P2002') return duplicateNumberError(res);
      throw updateError;
    }
  } catch (error) {
    console.error('Update room error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Housekeeping / board status moves. Only the manual machine in
// hotel.util is reachable here: OCCUPIED can be neither set (use
// check-in) nor cleared (use check-out) from this endpoint.
export const updateRoomStatus = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updateRoomStatusSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    const target = value.status;
    if (!isRoomStatus(target)) {
      return res.status(400).json({
        success: false,
        message: `Unknown room status "${target}"`,
        code: 'INVALID_STATUS'
      });
    }
    if (target === 'OCCUPIED') {
      return res.status(400).json({
        success: false,
        message: 'A room becomes occupied through check-in, which opens its folio — not through a status change',
        code: 'USE_CHECK_IN'
      });
    }

    const existing = await prisma.room.findFirst({
      where: roomScopeWhere(req, req.params.id),
      select: { id: true, status: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    if (existing.status === 'OCCUPIED') {
      return res.status(400).json({
        success: false,
        message: 'This room is occupied — its status changes through check-out, not by hand',
        code: 'ROOM_OCCUPIED'
      });
    }
    if (!canTransitionRoomStatus(existing.status, target)) {
      return res.status(400).json({
        success: false,
        message: `A room in status ${existing.status} cannot move to ${target}`,
        code: 'INVALID_TRANSITION'
      });
    }

    const room = await prisma.room.update({
      where: { id: existing.id },
      data: { status: target },
      include: roomInclude
    });

    return res.json({
      success: true,
      data: room,
      message: `Room marked ${target}`
    });
  } catch (error) {
    console.error('Update room status error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Deactivate a room. Refused while a guest is in-house — the stay
// must be checked out first. OWNER/MANAGER/ADMIN only.
export const deactivateRoom = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res, 'deactivate a room')) return;
    const prisma = await getPrisma();

    const existing = await prisma.room.findFirst({
      where: roomScopeWhere(req, req.params.id),
      select: { id: true, isActive: true, status: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    if (!existing.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This room is already inactive',
        code: 'ROOM_INACTIVE'
      });
    }
    if (existing.status === 'OCCUPIED') {
      return res.status(400).json({
        success: false,
        message: 'This room is occupied — check the guest out before deactivating it',
        code: 'ROOM_OCCUPIED'
      });
    }

    const room = await prisma.room.update({
      where: { id: existing.id },
      data: { isActive: false },
      include: roomInclude
    });

    return res.json({
      success: true,
      data: room,
      message: 'Room deactivated'
    });
  } catch (error) {
    console.error('Deactivate room error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

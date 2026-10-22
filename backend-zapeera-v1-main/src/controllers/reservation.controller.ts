import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  BLOCKING_RESERVATION_STATUSES,
  canTransitionReservation,
  isReservationStatus,
  isRoomBookable,
  isValidStayRange,
  normalizeHotelDate,
  rangeIncludesDay,
  rangesOverlap,
  DAY_MS
} from '../utils/hotel.util';

// ─── Reservations + check-in (Wave C5 — Hotel pack) ──────────────────
// A reservation books ONE room for a normalized date range. Creation
// refuses a range that overlaps a BOOKED/CHECKED_IN reservation of
// the same room (409 RESERVATION_CONFLICT) — the overlap test is
// half-open, so a same-day turnover (out on the 12th, in on the 12th)
// is fine. Check-in is a flow, not a status: it opens the stay's
// Folio at the room type's current rate (snapshotted), posts the
// first night's ROOM_NIGHT charge, flips the room to OCCUPIED and
// links reservation ↔ folio from both sides, all in one transaction.

const resolveReservationCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const reservationScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveReservationCompanyId(req)
});

const reservationInclude = {
  room: {
    select: {
      id: true,
      number: true,
      floor: true,
      status: true,
      roomType: { select: { id: true, name: true, ratePerNight: true } }
    }
  }
};

const reservationFields = {
  guestName: Joi.string().trim().min(1).max(160).required(),
  guestPhone: Joi.string().trim().max(40).allow('', null).optional(),
  guestCnic: Joi.string().trim().max(20).allow('', null).optional(),
  roomId: Joi.string().required(),
  branchId: Joi.string().allow(null, '').optional(),
  checkInDate: Joi.date().required(),
  checkOutDate: Joi.date().required(),
  adults: Joi.number().integer().min(1).max(20).allow(null).optional(),
  children: Joi.number().integer().min(0).max(20).allow(null).optional(),
  source: Joi.string().trim().max(30).allow('', null).optional(),
  notes: Joi.string().trim().max(1000).allow('', null).optional()
};

const createReservationSchema = Joi.object(reservationFields);

const updateReservationSchema = Joi.object({
  ...reservationFields,
  guestName: Joi.string().trim().min(1).max(160).optional(),
  roomId: Joi.string().optional(),
  checkInDate: Joi.date().optional(),
  checkOutDate: Joi.date().optional()
}).min(1);

const updateStatusSchema = Joi.object({
  status: Joi.string().trim().uppercase().required()
});

const nullIfEmpty = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

/** Blocking reservations of one room that overlap [checkIn, checkOut). */
const findBlockingOverlaps = async (
  prisma: any,
  companyId: string,
  roomId: string,
  checkIn: Date,
  checkOut: Date,
  excludeReservationId?: string
): Promise<any[]> => {
  const candidates = await prisma.reservation.findMany({
    where: {
      companyId,
      roomId,
      status: { in: [...BLOCKING_RESERVATION_STATUSES] },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {})
    },
    select: {
      id: true,
      guestName: true,
      checkInDate: true,
      checkOutDate: true,
      status: true
    }
  });
  return candidates.filter((r: any) =>
    rangesOverlap(checkIn, checkOut, r.checkInDate, r.checkOutDate)
  );
};

const conflictError = (res: Response, conflicts: any[]) =>
  res.status(409).json({
    success: false,
    message: `This room is already booked for part of that range (${conflicts
      .map(c => `${c.guestName}, ${new Date(c.checkInDate).toISOString().slice(0, 10)} → ${new Date(c.checkOutDate).toISOString().slice(0, 10)}`)
      .join('; ')})`,
    code: 'RESERVATION_CONFLICT',
    data: { conflicts }
  });

// Create a reservation.
export const createReservation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createReservationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveReservationCompanyId(req);
    const checkInDate = normalizeHotelDate(value.checkInDate);
    const checkOutDate = normalizeHotelDate(value.checkOutDate);
    if (!isValidStayRange(checkInDate, checkOutDate)) {
      return res.status(400).json({
        success: false,
        message: 'Check-out must be at least one night after check-in',
        code: 'INVALID_STAY_RANGE'
      });
    }

    const room = await prisma.room.findFirst({
      where: { id: value.roomId, companyId },
      select: { id: true, branchId: true, isActive: true, status: true }
    });
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }
    if (!room.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This room is inactive and cannot be booked',
        code: 'ROOM_INACTIVE'
      });
    }

    let branchId: string | null = value.branchId ? String(value.branchId) : null;
    if (!branchId) branchId = room.branchId || null;
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

    const overlaps = await findBlockingOverlaps(prisma, companyId, room.id, checkInDate, checkOutDate);
    if (overlaps.length > 0) return conflictError(res, overlaps);

    if (
      room.status === 'MAINTENANCE' &&
      rangeIncludesDay(checkInDate, checkOutDate, new Date())
    ) {
      return res.status(400).json({
        success: false,
        message: 'This room is under maintenance and cannot be booked for a stay that includes today',
        code: 'ROOM_MAINTENANCE'
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        companyId,
        branchId,
        guestName: value.guestName,
        guestPhone: nullIfEmpty(value.guestPhone),
        guestCnic: nullIfEmpty(value.guestCnic),
        roomId: room.id,
        checkInDate,
        checkOutDate,
        adults: value.adults ?? null,
        children: value.children ?? null,
        source: nullIfEmpty(value.source),
        notes: nullIfEmpty(value.notes),
        status: 'BOOKED',
        createdBy: req.user?.createdBy || req.user?.id || null
      },
      include: reservationInclude
    });

    return res.status(201).json({
      success: true,
      data: reservation,
      message: 'Reservation created successfully'
    });
  } catch (error) {
    console.error('Create reservation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Availability for a range: every active room with its bookable flag
// and the reservations that block it. Optional roomTypeId narrows the
// list. This is what the booking dialog renders.
export const getAvailability = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { from, to, roomTypeId } = req.query;
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Both from and to dates are required',
        code: 'DATES_REQUIRED'
      });
    }
    const checkInDate = normalizeHotelDate(String(from));
    const checkOutDate = normalizeHotelDate(String(to));
    if (!isValidStayRange(checkInDate, checkOutDate)) {
      return res.status(400).json({
        success: false,
        message: 'Check-out must be at least one night after check-in',
        code: 'INVALID_STAY_RANGE'
      });
    }

    const companyId = resolveReservationCompanyId(req);
    const where: any = { companyId, isActive: true };
    if (roomTypeId) where.roomTypeId = String(roomTypeId);

    const rooms = await prisma.room.findMany({
      where,
      include: {
        roomType: { select: { id: true, name: true, ratePerNight: true, capacity: true } },
        reservations: {
          where: { status: { in: [...BLOCKING_RESERVATION_STATUSES] } },
          select: { id: true, guestName: true, checkInDate: true, checkOutDate: true, status: true }
        }
      },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }]
    });

    const includesToday = rangeIncludesDay(checkInDate, checkOutDate, new Date());
    const data = rooms.map((room: any) => {
      const conflicts = (room.reservations || []).filter((r: any) =>
        rangesOverlap(checkInDate, checkOutDate, r.checkInDate, r.checkOutDate)
      );
      const { reservations, ...roomData } = room;
      return {
        ...roomData,
        bookable: isRoomBookable({
          status: room.status,
          isActive: room.isActive,
          hasBlockingOverlap: conflicts.length > 0,
          rangeIncludesToday: includesToday
        }),
        conflicts
      };
    });

    return res.json({
      success: true,
      data,
      range: {
        from: checkInDate.toISOString().slice(0, 10),
        to: checkOutDate.toISOString().slice(0, 10),
        nights: Math.round((checkOutDate.getTime() - checkInDate.getTime()) / DAY_MS)
      }
    });
  } catch (error) {
    console.error('Get availability error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List reservations. Filters: date (arrivals that day), from/to
// (check-in range), roomId, status, search (guest name/phone/CNIC).
export const getReservations = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 100, date, from, to, roomId, status, search } = req.query;

    const where: any = { companyId: resolveReservationCompanyId(req) };
    if (roomId) where.roomId = String(roomId);
    if (status) where.status = String(status).toUpperCase();
    if (date) {
      const day = normalizeHotelDate(String(date));
      where.checkInDate = { gte: day, lt: new Date(day.getTime() + DAY_MS) };
    } else if (from || to) {
      where.checkInDate = {};
      if (from) where.checkInDate.gte = normalizeHotelDate(String(from));
      if (to) {
        const toDay = normalizeHotelDate(String(to));
        where.checkInDate.lt = new Date(toDay.getTime() + DAY_MS);
      }
    }
    if (search) {
      const term = String(search);
      where.OR = [
        { guestName: { contains: term } },
        { guestPhone: { contains: term } },
        { guestCnic: { contains: term } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [reservations, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        include: reservationInclude,
        orderBy: [{ checkInDate: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: Number(limit)
      }),
      prisma.reservation.count({ where })
    ]);

    return res.json({
      success: true,
      data: reservations,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get reservations error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one reservation (tenancy-scoped), with its folio summary.
export const getReservationById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const reservation = await prisma.reservation.findFirst({
      where: reservationScopeWhere(req, req.params.id),
      include: {
        ...reservationInclude,
        folio: {
          select: { id: true, status: true, openedAt: true, closedAt: true, rateSnapshot: true }
        }
      }
    });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    return res.json({ success: true, data: reservation });
  } catch (error) {
    console.error('Get reservation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a BOOKED reservation (guest details, room, dates). The new
// range is re-checked for overlaps, excluding the reservation
// itself. Checked-in stays are not editable here — their facts live
// on the folio from check-in on.
export const updateReservation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = updateReservationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveReservationCompanyId(req);
    const existing = await prisma.reservation.findFirst({
      where: reservationScopeWhere(req, req.params.id)
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    if (existing.status !== 'BOOKED') {
      return res.status(400).json({
        success: false,
        message: `A reservation in status ${existing.status} can no longer be edited`,
        code: 'RESERVATION_LOCKED'
      });
    }

    const roomId = value.roomId || existing.roomId;
    const checkInDate = value.checkInDate ? normalizeHotelDate(value.checkInDate) : existing.checkInDate;
    const checkOutDate = value.checkOutDate ? normalizeHotelDate(value.checkOutDate) : existing.checkOutDate;
    if (!isValidStayRange(checkInDate, checkOutDate)) {
      return res.status(400).json({
        success: false,
        message: 'Check-out must be at least one night after check-in',
        code: 'INVALID_STAY_RANGE'
      });
    }

    if (value.roomId || value.checkInDate || value.checkOutDate) {
      const room = await prisma.room.findFirst({
        where: { id: roomId, companyId },
        select: { id: true, isActive: true }
      });
      if (!room) {
        return res.status(404).json({ success: false, message: 'Room not found' });
      }
      if (!room.isActive) {
        return res.status(400).json({
          success: false,
          message: 'This room is inactive and cannot be booked',
          code: 'ROOM_INACTIVE'
        });
      }
      const overlaps = await findBlockingOverlaps(
        prisma, companyId, roomId, checkInDate, checkOutDate, existing.id
      );
      if (overlaps.length > 0) return conflictError(res, overlaps);
    }

    const data: any = {};
    if (value.guestName !== undefined) data.guestName = value.guestName;
    if (value.guestPhone !== undefined) data.guestPhone = nullIfEmpty(value.guestPhone);
    if (value.guestCnic !== undefined) data.guestCnic = nullIfEmpty(value.guestCnic);
    if (value.roomId !== undefined) data.roomId = value.roomId;
    if (value.branchId !== undefined) data.branchId = value.branchId || null;
    if (value.checkInDate !== undefined) data.checkInDate = checkInDate;
    if (value.checkOutDate !== undefined) data.checkOutDate = checkOutDate;
    if (value.adults !== undefined) data.adults = value.adults ?? null;
    if (value.children !== undefined) data.children = value.children ?? null;
    if (value.source !== undefined) data.source = nullIfEmpty(value.source);
    if (value.notes !== undefined) data.notes = nullIfEmpty(value.notes);

    const reservation = await prisma.reservation.update({
      where: { id: existing.id },
      data,
      include: reservationInclude
    });

    return res.json({
      success: true,
      data: reservation,
      message: 'Reservation updated successfully'
    });
  } catch (error) {
    console.error('Update reservation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Cancel / no-show a BOOKED reservation. CHECKED_IN and COMPLETED
// refuse — they move through check-out, never sideways.
export const updateReservationStatus = async (req: AuthRequest, res: Response) => {
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
    if (!isReservationStatus(target)) {
      return res.status(400).json({
        success: false,
        message: `Unknown reservation status "${target}"`,
        code: 'INVALID_STATUS'
      });
    }
    if (target === 'CHECKED_IN') {
      return res.status(400).json({
        success: false,
        message: 'A guest is checked in through the check-in endpoint, which opens the folio — not through a status change',
        code: 'USE_CHECK_IN'
      });
    }
    if (target === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'A reservation completes through folio check-out — not through a status change',
        code: 'USE_CHECK_OUT'
      });
    }

    const existing = await prisma.reservation.findFirst({
      where: reservationScopeWhere(req, req.params.id),
      select: { id: true, status: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    if (!canTransitionReservation(existing.status, target)) {
      return res.status(400).json({
        success: false,
        message: `A reservation in status ${existing.status} cannot move to ${target}`,
        code: 'INVALID_TRANSITION'
      });
    }

    const reservation = await prisma.reservation.update({
      where: { id: existing.id },
      data: { status: target },
      include: reservationInclude
    });

    return res.json({
      success: true,
      data: reservation,
      message: `Reservation marked ${target}`
    });
  } catch (error) {
    console.error('Update reservation status error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Check the guest in: open the folio.
//   · Only from BOOKED, and only when the room is free to occupy
//     (not OCCUPIED by another stay, not MAINTENANCE).
//   · The folio snapshots the room type's CURRENT ratePerNight;
//     every room-night charge of this stay posts at that snapshot.
//   · The FIRST night's charge posts immediately (chargeDate =
//     the reservation's check-in day); later nights post through
//     the folio's post-night-charge (the night-audit action).
export const checkInReservation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveReservationCompanyId(req);

    const reservation = await prisma.reservation.findFirst({
      where: reservationScopeWhere(req, req.params.id),
      include: {
        room: { include: { roomType: { select: { id: true, name: true, ratePerNight: true } } } }
      }
    });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    if (reservation.status !== 'BOOKED') {
      return res.status(400).json({
        success: false,
        message: `A reservation in status ${reservation.status} cannot be checked in`,
        code: 'RESERVATION_NOT_BOOKED'
      });
    }

    const room = reservation.room;
    if (!room.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This room is inactive and cannot be occupied',
        code: 'ROOM_INACTIVE'
      });
    }
    if (room.status === 'OCCUPIED') {
      return res.status(409).json({
        success: false,
        message: `Room ${room.number} is occupied — check the current guest out first`,
        code: 'ROOM_OCCUPIED'
      });
    }
    if (room.status === 'MAINTENANCE') {
      return res.status(400).json({
        success: false,
        message: `Room ${room.number} is under maintenance and cannot be occupied`,
        code: 'ROOM_MAINTENANCE'
      });
    }

    const createdBy = req.user?.createdBy || req.user?.id || null;
    const rateSnapshot = room.roomType?.ratePerNight || 0;
    const branchId = reservation.branchId || room.branchId || null;

    const result = await prisma.$transaction(async (tx: any) => {
      const folio = await tx.folio.create({
        data: {
          companyId,
          branchId,
          reservationId: reservation.id,
          roomId: room.id,
          guestName: reservation.guestName,
          guestPhone: reservation.guestPhone || null,
          rateSnapshot,
          status: 'OPEN',
          createdBy
        }
      });

      const firstNight = await tx.folioCharge.create({
        data: {
          folioId: folio.id,
          description: `Room night — ${room.roomType?.name || 'Room'} ${room.number} (${new Date(reservation.checkInDate).toISOString().slice(0, 10)})`,
          amount: rateSnapshot,
          kind: 'ROOM_NIGHT',
          chargeDate: normalizeHotelDate(reservation.checkInDate),
          createdBy
        }
      });

      const updatedReservation = await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: 'CHECKED_IN', folioId: folio.id },
        include: reservationInclude
      });

      await tx.room.update({
        where: { id: room.id },
        data: { status: 'OCCUPIED' }
      });

      return { folio, firstNight, reservation: updatedReservation };
    });

    return res.status(201).json({
      success: true,
      data: result,
      message: `Checked in — folio opened for room ${room.number}`
    });
  } catch (error) {
    console.error('Check-in error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

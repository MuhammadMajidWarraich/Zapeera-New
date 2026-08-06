import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { createNotification } from './notification.controller';
import Joi from 'joi';
import logger from '../utils/logger';

const checkInSchema = Joi.object({
  staffProfileId: Joi.string().required(),
  branchId: Joi.string().required(),
  notes: Joi.string().optional()
});

const checkOutSchema = Joi.object({
  attendanceId: Joi.string().required(),
  notes: Joi.string().optional()
});

const updateAttendanceSchema = Joi.object({
  status: Joi.string().valid('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE').optional(),
  notes: Joi.string().optional()
});

export const checkIn = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error } = checkInSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { staffProfileId, branchId, notes } = req.body;

    const staffProfile = await prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
      include: {
        membership: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          }
        }
      }
    });

    if (!staffProfile) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    if (!staffProfile.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Staff is not active'
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        staffProfileId,
        checkIn: {
          gte: today,
          lt: tomorrow
        },
        checkOut: null
      }
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: 'Staff is already checked in today'
      });
    }

    const attendance = await prisma.attendance.create({
      data: {
        staffProfileId,
        membershipId: staffProfile.membershipId,
        branchId,
        checkIn: new Date(),
        status: 'PRESENT',
        notes
      },
      include: {
        staffProfile: {
          include: {
            membership: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    syncAfterOperation('attendance', 'create', attendance).catch((err: any) => {
      logger.error('[Sync] Attendance check-in sync failed:', { message: err.message });
    });

    // Notify business owner/manager about check-in
    const staffName = staffProfile.membership?.user?.name || 'Staff member';
    const businessId = staffProfile.membership?.businessId;
    const ownerId = businessId ? (await prisma.business.findUnique({ where: { id: businessId }, select: { createdBy: true } }))?.createdBy : null;
    if (ownerId && businessId) {
      createNotification({
        userId: ownerId,
        businessId,
        type: 'staff_checkin',
        title: 'Staff Checked In',
        body: `${staffName} checked in at ${new Date().toLocaleTimeString()}`,
        actionUrl: `/staff`,
      }).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      data: attendance,
      message: 'Check-in successful'
    });
  } catch (error) {
    logger.error('Error checking in staff:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const checkOut = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error } = checkOutSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { attendanceId, notes } = req.body;

    const attendance = await prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        staffProfile: {
          include: {
            membership: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    if (attendance.checkOut) {
      return res.status(400).json({
        success: false,
        message: 'Staff is already checked out'
      });
    }

    const checkOutTime = new Date();
    const checkInTime = new Date(attendance.checkIn);
    const totalHours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);

    const updatedAttendance = await prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOut: checkOutTime,
        totalHours: Math.round(totalHours * 100) / 100,
        notes: notes || attendance.notes
      },
      include: {
        staffProfile: {
          include: {
            membership: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Notify business owner/manager about check-out
    const staffName = attendance.staffProfile?.membership?.user?.name || 'Staff member';
    const businessId = attendance.staffProfile?.membership?.businessId;
    const ownerId = businessId ? (await prisma.business.findUnique({ where: { id: businessId }, select: { createdBy: true } }))?.createdBy : null;
    if (ownerId && businessId) {
      createNotification({
        userId: ownerId,
        businessId,
        type: 'staff_checkout',
        title: 'Staff Checked Out',
        body: `${staffName} checked out at ${new Date().toLocaleTimeString()} (${totalHours.toFixed(1)} hours worked)`,
        actionUrl: `/staff`,
      }).catch(() => {});
    }

    return res.json({
      success: true,
      data: updatedAttendance,
      message: 'Check-out successful'
    });
  } catch (error) {
    logger.error('Error checking out staff:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAttendance = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      staffProfileId = '',
      branchId = '',
      startDate = '',
      endDate = '',
      status = ''
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};

    if (staffProfileId) {
      where.staffProfileId = staffProfileId;
    }

    if (branchId) {
      where.branchId = branchId;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.checkIn = {};
      if (startDate) {
        where.checkIn.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateObj = new Date(endDate as string);
        endDateObj.setHours(23, 59, 59, 999);
        where.checkIn.lte = endDateObj;
      }
    }

    const [attendance, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take,
        include: {
          staffProfile: {
            include: {
              membership: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true
                    }
                  }
                }
              }
            }
          },
          branch: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { checkIn: 'desc' }
      }),
      prisma.attendance.count({ where })
    ]);

    return res.json({
      success: true,
      data: {
        attendance,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching attendance:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getTodayAttendance = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { staffProfileId } = req.params;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendance = await prisma.attendance.findFirst({
      where: {
        staffProfileId,
        checkIn: {
          gte: today,
          lt: tomorrow
        }
      },
      include: {
        staffProfile: {
          include: {
            membership: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return res.json({
      success: true,
      data: attendance
    });
  } catch (error) {
    logger.error('Error fetching today\'s attendance:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateAttendance = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateAttendanceSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const existingAttendance = await prisma.attendance.findUnique({
      where: { id }
    });

    if (!existingAttendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    const attendance = await prisma.attendance.update({
      where: { id },
      data: req.body,
      include: {
        staffProfile: {
          include: {
            membership: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    syncAfterOperation('attendance', 'update', attendance).catch((err: any) => {
      logger.error('[Sync] Attendance update sync failed:', { message: err.message });
    });

    return res.json({
      success: true,
      data: attendance,
      message: 'Attendance updated successfully'
    });
  } catch (error) {
    logger.error('Error updating attendance:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAttendanceStats = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { branchId, startDate, endDate } = req.query;

    const where: any = {};
    if (branchId) {
      where.branchId = branchId;
    }

    if (startDate || endDate) {
      where.checkIn = {};
      if (startDate) {
        where.checkIn.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateObj = new Date(endDate as string);
        endDateObj.setHours(23, 59, 59, 999);
        where.checkIn.lte = endDateObj;
      }
    }

    const [
      totalRecords,
      presentCount,
      absentCount,
      lateCount,
      halfDayCount,
      leaveCount
    ] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.count({ where: { ...where, status: 'PRESENT' } }),
      prisma.attendance.count({ where: { ...where, status: 'ABSENT' } }),
      prisma.attendance.count({ where: { ...where, status: 'LATE' } }),
      prisma.attendance.count({ where: { ...where, status: 'HALF_DAY' } }),
      prisma.attendance.count({ where: { ...where, status: 'LEAVE' } })
    ]);

    return res.json({
      success: true,
      data: {
        totalRecords,
        presentCount,
        absentCount,
        lateCount,
        halfDayCount,
        leaveCount
      }
    });
  } catch (error) {
    logger.error('Error fetching attendance stats:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

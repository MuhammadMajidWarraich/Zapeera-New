import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';
import logger from '../utils/logger';

// Validation schemas
const createScheduledShiftSchema = Joi.object({
  name: Joi.string().required(),
  startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
  endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
  date: Joi.date().required(),
  branchId: Joi.string().required(),
  maxUsers: Joi.number().min(1).optional(),
  notes: Joi.string().optional().allow(''),
  assignedUserIds: Joi.array().items(Joi.string()).optional()
});

const updateScheduledShiftSchema = Joi.object({
  name: Joi.string().optional(),
  startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  date: Joi.date().optional(),
  branchId: Joi.string().allow('', null).optional(),
  maxUsers: Joi.number().min(1).optional(),
  notes: Joi.string().optional(),
  assignedUserIds: Joi.array().items(Joi.string()).optional()
});

// Create a new scheduled shift
export const createScheduledShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();

    const { error } = createScheduledShiftSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { name, startTime, endTime, date, branchId, maxUsers = 1, notes, assignedUserIds = [] } = req.body;

    // Check if branch exists
    const branch = await prisma.branch.findUnique({
      where: { id: branchId }
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    // Create the scheduled shift
    const scheduledShift: any = await prisma.scheduledShift.create({
      data: {
        name,
        startTime,
        endTime,
        date: new Date(date),
        branchId,
        maxUsers,
        notes: notes || null,
        status: 'SCHEDULED',
        ...(assignedUserIds.length > 0 && {
          assignedUsers: {
            create: assignedUserIds.map((userId: string) => ({
              userId
            }))
          }
        })
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        },
        assignedUsers: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // Transform the data to match frontend expectations
    const transformedShift = {
      id: scheduledShift.id,
      name: scheduledShift.name,
      startTime: scheduledShift.startTime,
      endTime: scheduledShift.endTime,
      date: scheduledShift.date.toISOString().split('T')[0],
      branchId: scheduledShift.branchId,
      branchName: scheduledShift.branch?.name || 'Unknown Branch',
      assignedUsers: scheduledShift.assignedUsers.map((su: any) => ({
        id: su.user.id,
        name: su.user.name
      })),
      maxUsers: scheduledShift.maxUsers,
      status: scheduledShift.status.toLowerCase(),
      notes: scheduledShift.notes,
      createdAt: scheduledShift.createdAt.toISOString(),
      updatedAt: scheduledShift.updatedAt.toISOString()
    };

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('scheduledShift', 'create', scheduledShift).catch(err => {
      logger.error('[Sync] ScheduledShift create sync failed:', { message: err.message });
    });

    return res.status(201).json({
      success: true,
      data: transformedShift,
      message: 'Scheduled shift created successfully'
    });
  } catch (error) {
    logger.error('Error creating scheduled shift:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all scheduled shifts
export const getScheduledShifts = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      branchId = '',
      status = '',
      startDate = '',
      endDate = ''
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};

    if (branchId) {
      where.branchId = branchId;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateObj = new Date(endDate as string);
        endDateObj.setHours(23, 59, 59, 999);
        where.date.lte = endDateObj;
      }
    }

    const [scheduledShifts, total] = await Promise.all([
      prisma.scheduledShift.findMany({
        where,
        skip,
        take,
        include: {
          branch: {
            select: {
              id: true,
              name: true
            }
          },
          assignedUsers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: { date: 'desc' }
      }),
      prisma.scheduledShift.count({ where })
    ]);

    // Transform the data to match frontend expectations
    const transformedShifts = scheduledShifts.map((shift: any) => ({
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      date: shift.date.toISOString().split('T')[0],
      branchId: shift.branchId,
      branchName: shift.branch.name,
      assignedUsers: shift.assignedUsers.map((su: any) => ({
        id: su.user.id,
        name: su.user.name
      })),
      maxUsers: shift.maxUsers,
      status: shift.status.toLowerCase(),
      notes: shift.notes,
      createdAt: shift.createdAt.toISOString(),
      updatedAt: shift.updatedAt.toISOString()
    }));

    return res.json({
      success: true,
      data: transformedShifts,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Error fetching scheduled shifts:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get a single scheduled shift
export const getScheduledShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const scheduledShift: any = await prisma.scheduledShift.findUnique({
      where: { id },
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        },
        assignedUsers: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!scheduledShift) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled shift not found'
      });
    }

    // Transform the data to match frontend expectations
    const transformedShift = {
      id: scheduledShift.id,
      name: scheduledShift.name,
      startTime: scheduledShift.startTime,
      endTime: scheduledShift.endTime,
      date: scheduledShift.date.toISOString().split('T')[0],
      branchId: scheduledShift.branchId,
      branchName: scheduledShift.branch.name,
      assignedUsers: scheduledShift.assignedUsers.map((su: any) => ({
        id: su.user.id,
        name: su.user.name
      })),
      maxUsers: scheduledShift.maxUsers,
      status: scheduledShift.status.toLowerCase(),
      notes: scheduledShift.notes,
      createdAt: scheduledShift.createdAt.toISOString(),
      updatedAt: scheduledShift.updatedAt.toISOString()
    };

    return res.json({
      success: true,
      data: transformedShift
    });
  } catch (error) {
    logger.error('Error fetching scheduled shift:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update a scheduled shift
export const updateScheduledShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateScheduledShiftSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const updateData = req.body;
    const { assignedUserIds, ...shiftData } = updateData;

    // Check if scheduled shift exists
    const existingShift = await prisma.scheduledShift.findUnique({
      where: { id }
    });

    if (!existingShift) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled shift not found'
      });
    }

    // Update the scheduled shift
    const updatedShift: any = await prisma.scheduledShift.update({
      where: { id },
      data: {
        ...shiftData,
        ...(shiftData.date && { date: new Date(shiftData.date) }),
        ...(assignedUserIds !== undefined && {
          assignedUsers: {
            deleteMany: {},
            create: assignedUserIds.map((userId: string) => ({
              userId
            }))
          }
        })
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        },
        assignedUsers: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // Transform the data to match frontend expectations
    const transformedShift = {
      id: updatedShift.id,
      name: updatedShift.name,
      startTime: updatedShift.startTime,
      endTime: updatedShift.endTime,
      date: updatedShift.date.toISOString().split('T')[0],
      branchId: updatedShift.branchId,
      branchName: updatedShift.branch.name,
      assignedUsers: updatedShift.assignedUsers.map((su: any) => ({
        id: su.user.id,
        name: su.user.name
      })),
      maxUsers: updatedShift.maxUsers,
      status: updatedShift.status.toLowerCase(),
      notes: updatedShift.notes,
      createdAt: updatedShift.createdAt.toISOString(),
      updatedAt: updatedShift.updatedAt.toISOString()
    };

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('scheduledShift', 'update', updatedShift).catch(err => {
      logger.error('[Sync] ScheduledShift update sync failed:', { message: err.message });
    });

    return res.json({
      success: true,
      data: transformedShift,
      message: 'Scheduled shift updated successfully'
    });
  } catch (error) {
    logger.error('Error updating scheduled shift:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete a scheduled shift
export const deleteScheduledShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Check if scheduled shift exists
    const existingShift = await prisma.scheduledShift.findUnique({
      where: { id }
    });

    if (!existingShift) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled shift not found'
      });
    }

    // Delete the scheduled shift (cascade will handle assigned users)
    await prisma.scheduledShift.delete({
      where: { id }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('scheduledShift', 'delete', { id }).catch(err => {
      logger.error('[Sync] ScheduledShift delete sync failed:', { message: err.message });
    });

    return res.json({
      success: true,
      message: 'Scheduled shift deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting scheduled shift:', { error: String(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

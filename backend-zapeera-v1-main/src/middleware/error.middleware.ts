import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = { ...err };
  error.message = err.message;

  // Log error with context for debugging
  logger.error('Error occurred:', {
    message: err.message,
    name: err.name,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Prisma unique constraint error
  if (err.name === 'UniqueConstraintViolationError' || ((err as any).code === 'P2002')) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 } as AppError;
  }

  // Prisma validation error
  if (err.name === 'ValidationError' || (err as any).code === 'P2014') {
    const message = 'Invalid data provided';
    error = { message, statusCode: 400 } as AppError;
  }

  // Prisma record not found
  if ((err as any).code === 'P2025') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 } as AppError;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 } as AppError;
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 } as AppError;
  }

  // SECURITY FIX: Sanitize error messages in production
  // In production, only show generic error messages to prevent information disclosure
  const isProduction = process.env.NODE_ENV === 'production';
  const errorMessage = isProduction ? 'An error occurred' : (error.message || 'Server Error');

  res.status(error.statusCode || 500).json({
    success: false,
    error: errorMessage,
  });
};

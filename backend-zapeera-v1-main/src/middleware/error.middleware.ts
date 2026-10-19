import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

/**
 * Central error mapping (QA A-12).
 *
 * Most controllers catch their own errors and respond directly with
 * `res.status(500).json({ success: false, message: err.message })` — those
 * responses never reach `errorHandler`, which is how raw Prisma text
 * ("Invalid `prisma.product.create()` invocation: Unique constraint failed
 * on the fields: (`sku`)") leaked to clients. Two layers fix this without
 * editing every controller:
 *
 *   1. `errorHandler` — for errors that DO arrive via next(err): maps
 *      Prisma codes / multer / body-parser failures to proper statuses and
 *      never returns ORM internals.
 *   2. `sanitizeErrorResponses` — middleware that wraps res.json and applies
 *      the same classification to direct controller error responses:
 *      unique-constraint text → 409, record-not-found text → 404, Prisma
 *      validation text → 400, and any 5xx body is scrubbed of ORM internals
 *      (in production every 5xx message becomes a generic one).
 */

const GENERIC_500_MESSAGE = 'Internal server error';
const UNIQUE_EXISTS_MESSAGE = 'A record with the same value already exists';
const NOT_FOUND_MESSAGE = 'Resource not found';
const INVALID_DATA_MESSAGE = 'Invalid data provided';

// Text signatures of ORM internals that must never reach a client.
const ORM_INTERNAL_PATTERNS: RegExp[] = [
  /invalid `prisma\./i,
  /prisma\.client/i,
  /prisma-client/i,
  /\bP\d{4}\b/,
  /does not exist in the current database/i,
  /the column .{0,60} does not exist/i,
  /foreign key constraint (failed|violat)/i,
  /invalid value for argument/i,
  /argument .{0,40} is missing/i,
  /unknown argument/i,
];

const UNIQUE_CONSTRAINT_PATTERNS: RegExp[] = [
  /unique constraint failed/i,
  /\bP2002\b/,
];

const RECORD_NOT_FOUND_PATTERNS: RegExp[] = [
  /record to (update|delete) (does not exist|not found)/i,
  /record .* required but not found/i,
  /\bP2025\b/,
];

// NOTE: deliberately NOT the bare `Invalid \`prisma.x()\` invocation:` prefix —
// almost every Prisma failure starts with it, including server-side ones
// (missing table/column) that must stay scrubbed 500s, not become 400s.
// Only the argument-validation signatures below classify as client errors.
const ORM_VALIDATION_PATTERNS: RegExp[] = [
  /invalid value for argument/i,
  /argument .{0,40} is missing/i,
  /unknown argument/i,
  /unknown field .{0,40} for/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** Returns true when a string carries ORM internals (codes, table/field detail, invocation text). */
export function containsOrmInternals(text: string): boolean {
  return matchesAny(text, ORM_INTERNAL_PATTERNS);
}

/**
 * Classify leaked ORM error text into a proper HTTP status + safe message.
 * Returns null when the text is not a recognisable ORM failure.
 */
export function classifyOrmErrorText(
  text: string
): { statusCode: number; message: string } | null {
  if (!text) return null;
  if (matchesAny(text, UNIQUE_CONSTRAINT_PATTERNS)) {
    return { statusCode: 409, message: UNIQUE_EXISTS_MESSAGE };
  }
  if (matchesAny(text, RECORD_NOT_FOUND_PATTERNS)) {
    return { statusCode: 404, message: NOT_FOUND_MESSAGE };
  }
  if (matchesAny(text, ORM_VALIDATION_PATTERNS)) {
    return { statusCode: 400, message: INVALID_DATA_MESSAGE };
  }
  return null;
}

/** Map a thrown error (Prisma / multer / body-parser / JWT / typed) to status + safe message. */
export function mapKnownError(err: any): { statusCode: number; message: string } {
  const code = err?.code as string | undefined;

  // Prisma known-request errors, by code.
  if (typeof code === 'string' && /^P\d{4}$/.test(code)) {
    switch (code) {
      case 'P2002':
        return { statusCode: 409, message: UNIQUE_EXISTS_MESSAGE };
      case 'P2025':
      case 'P2001':
        return { statusCode: 404, message: NOT_FOUND_MESSAGE };
      case 'P2003':
        return { statusCode: 409, message: 'Operation conflicts with an existing record' };
      case 'P2014':
        return { statusCode: 422, message: 'Invalid data provided: a required relation is missing' };
      case 'P2000':
      case 'P2006':
      case 'P2007':
        return { statusCode: 422, message: INVALID_DATA_MESSAGE };
      default:
        // Any other Prisma code is an internal failure from the client's view.
        return { statusCode: 500, message: GENERIC_500_MESSAGE };
    }
  }

  // Prisma validation errors (no P-code; class name / message signature).
  if (
    err?.name === 'PrismaClientValidationError' ||
    err?.name === 'ValidationError' ||
    (typeof err?.message === 'string' && matchesAny(err.message, ORM_VALIDATION_PATTERNS))
  ) {
    return { statusCode: 400, message: INVALID_DATA_MESSAGE };
  }

  // Legacy custom names kept from the previous handler.
  if (err?.name === 'UniqueConstraintViolationError') {
    return { statusCode: 409, message: UNIQUE_EXISTS_MESSAGE };
  }

  // Multer upload failures (file size / count / field).
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return { statusCode: 413, message: 'File too large' };
    }
    return { statusCode: 400, message: 'Invalid file upload' };
  }

  // body-parser failures.
  if (err?.type === 'entity.too.large') {
    return { statusCode: 413, message: 'Request body too large' };
  }
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && (err as any).status === 400)) {
    return { statusCode: 400, message: 'Invalid JSON in request body' };
  }

  // JWT errors.
  if (err?.name === 'JsonWebTokenError') {
    return { statusCode: 401, message: 'Invalid token' };
  }
  if (err?.name === 'TokenExpiredError') {
    return { statusCode: 401, message: 'Token expired' };
  }

  // Typed domain errors (e.g. the sale controller's HttpError) carry a status.
  const typedStatus = err?.statusCode || err?.status;
  if (typeof typedStatus === 'number' && typedStatus >= 400 && typedStatus < 600) {
    const msg = typeof err.message === 'string' ? err.message : '';
    if (typedStatus >= 500) {
      return { statusCode: typedStatus, message: containsOrmInternals(msg) ? GENERIC_500_MESSAGE : msg || GENERIC_500_MESSAGE };
    }
    return { statusCode: typedStatus, message: msg || 'Error' };
  }

  // Untyped errors: still classify leaked ORM text (controllers sometimes
  // wrap an ORM failure in a plain Error and forward it).
  if (typeof err?.message === 'string') {
    const classified = classifyOrmErrorText(err.message);
    if (classified) return classified;
  }

  return { statusCode: 500, message: GENERIC_500_MESSAGE };
}

/**
 * Scrub an outgoing error body in place. Applies the ORM-text classification
 * (which may raise `out.statusCode`) and strips internals from 5xx bodies.
 */
function sanitizeErrorBody(
  body: any,
  out: { statusCode: number }
): any {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;

  const isProduction = process.env.NODE_ENV === 'production';
  const clone = { ...body };
  if ('stack' in clone) delete clone.stack;

  const fields = ['message', 'error'] as const;
  const texts = fields
    .map((f) => clone[f])
    .filter((v): v is string => typeof v === 'string');

  // 1. Recognisable ORM failures get a proper status + safe message,
  //    even when a controller surfaced them as a bare 500.
  if (out.statusCode >= 400) {
    for (const text of texts) {
      const classified = classifyOrmErrorText(text);
      if (classified && out.statusCode >= 500) {
        out.statusCode = classified.statusCode;
        for (const f of fields) {
          if (typeof clone[f] === 'string' && classifyOrmErrorText(clone[f] as string)) {
            clone[f] = classified.message;
          }
        }
        break;
      }
    }
  }

  // 2. 5xx bodies never carry ORM internals; in production they are fully generic.
  if (out.statusCode >= 500) {
    for (const f of fields) {
      const value = clone[f];
      if (typeof value !== 'string') continue;
      if (containsOrmInternals(value)) {
        clone[f] = GENERIC_500_MESSAGE;
      } else if (isProduction && f === 'message') {
        clone[f] = GENERIC_500_MESSAGE;
      } else if (
        isProduction &&
        f === 'error' &&
        (value.length > 80 || /\s/.test(value))
      ) {
        // Long/prose `error` strings are internal detail; short codes
        // (e.g. 'RATE_LIMITED') are part of the API contract and stay.
        clone[f] = GENERIC_500_MESSAGE;
      }
    }
  }

  return clone;
}

/**
 * Express middleware: wraps res.json so error responses produced directly by
 * controllers get the same mapping/scrubbing as errorHandler responses.
 * Register before the routes (see server.ts).
 */
export const sanitizeErrorResponses = (
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode >= 400) {
      const out = { statusCode: res.statusCode };
      const sanitized = sanitizeErrorBody(body, out);
      if (out.statusCode !== res.statusCode) res.status(out.statusCode);
      return originalJson(sanitized);
    }
    return originalJson(body);
  };
  next();
};

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  void next;
  const { statusCode, message } = mapKnownError(err);

  // Log full detail server-side; clients only ever see the mapped message.
  logger.error('Error occurred:', {
    message: err.message,
    name: err.name,
    code: (err as any)?.code,
    statusCode,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  res.status(statusCode).json({
    success: false,
    error: message,
  });
};

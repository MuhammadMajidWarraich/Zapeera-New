import { Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { resolveReservationCompanyId } from './reservation.controller';
import {
  RESERVATION_DOCUMENT_DIR,
  RESERVATION_DOCUMENT_REF_PREFIX,
  MAX_DOCUMENT_FILE_SIZE,
  documentFilename,
  isPdfRef
} from '../utils/reservation-documents.util';

// ─── Reservation guest documents (CNIC scan + person photos) ─────────
// Upload + serving for the files a reservation carries. This follows
// the payment-proof security pattern (QA A-09) exactly:
//   · 128-bit random stored names (never the client's filename)
//   · the client-declared mimetype is only a first-pass filter — the
//     REAL type is sniffed from magic bytes and the stored name is
//     renamed to the canonical extension for that type
//   · files are served ONLY through the authenticated, business-
//     scoped route below, as attachments with nosniff — the public
//     /uploads static mount is gone and must never come back.

if (!fs.existsSync(RESERVATION_DOCUMENT_DIR)) {
  fs.mkdirSync(RESERVATION_DOCUMENT_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RESERVATION_DOCUMENT_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `rdoc_${crypto.randomBytes(16).toString('hex')}${ext}`);
  }
});

// First-pass filter only; magic bytes in the handler are authoritative.
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  allowed.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only JPEG, PNG, WEBP or PDF files are allowed'));
};

const documentUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_DOCUMENT_FILE_SIZE }
});

/**
 * Multer wrapper that answers with the app's JSON error shape instead
 * of Express' default HTML error page (oversize file, wrong type).
 */
export const handleReservationDocumentUpload = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  documentUpload.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File is too large — the limit is ${MAX_DOCUMENT_FILE_SIZE / (1024 * 1024)} MB`,
        code: 'FILE_TOO_LARGE'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message || 'Upload failed',
      code: 'INVALID_FILE_TYPE'
    });
  });
};

type DetectedFileType = { ext: string; mime: string };

/**
 * Sniff the real file type from magic bytes — the same check the
 * payment-proof upload performs (payment-proof.controller.ts).
 */
function detectFileType(filePath: string): DetectedFileType | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    const b = buf.subarray(0, read);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return { ext: '.jpg', mime: 'image/jpeg' };
    }
    if (
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    ) {
      return { ext: '.png', mime: 'image/png' };
    }
    if (
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { ext: '.webp', mime: 'image/webp' };
    }
    if (b.length >= 4 && b.toString('ascii', 0, 4) === '%PDF') {
      return { ext: '.pdf', mime: 'application/pdf' };
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function safeUnlink(filePath?: string) {
  if (filePath) try { fs.unlinkSync(filePath); } catch {}
}

/**
 * POST /api/reservations/documents/upload
 * Multipart: `file` + `kind` ('cnic' | 'photo'). Stores the file and
 * returns its ref; the reservation create/update then attaches the
 * ref (and re-validates its shape + the 5-photo cap). Photos are
 * images only; the CNIC document may also be a PDF. The business
 * context (router middleware) gates who can upload at all.
 */
export const uploadReservationDocument = async (req: AuthRequest, res: Response) => {
  let filePath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A file is required',
        code: 'FILE_REQUIRED'
      });
    }

    const kind = String(req.body?.kind || '');
    if (kind !== 'cnic' && kind !== 'photo') {
      safeUnlink(filePath);
      return res.status(400).json({
        success: false,
        message: 'kind must be "cnic" or "photo"',
        code: 'INVALID_DOCUMENT_KIND'
      });
    }

    const detected = detectFileType(req.file.path);
    if (!detected || (kind === 'photo' && detected.ext === '.pdf')) {
      safeUnlink(filePath);
      return res.status(400).json({
        success: false,
        message:
          kind === 'photo'
            ? 'Guest photos must be JPEG, PNG or WEBP images'
            : 'The CNIC document must be a JPEG, PNG, WEBP or PDF file',
        code: 'INVALID_FILE_TYPE'
      });
    }

    // Canonical extension for the sniffed type (kills the stored-XSS-
    // via-extension path when the file is later downloaded).
    if (path.extname(req.file.filename).toLowerCase() !== detected.ext) {
      const canonicalName = req.file.filename.replace(/\.[^.]*$/, '') + detected.ext;
      const canonicalPath = path.join(RESERVATION_DOCUMENT_DIR, canonicalName);
      fs.renameSync(req.file.path, canonicalPath);
      req.file.filename = canonicalName;
      req.file.path = canonicalPath;
      filePath = canonicalPath;
    }

    return res.status(201).json({
      success: true,
      data: {
        ref: `${RESERVATION_DOCUMENT_REF_PREFIX}${req.file.filename}`,
        kind,
        mime: detected.mime
      },
      message: 'Document uploaded'
    });
  } catch (error) {
    safeUnlink(filePath);
    console.error('Upload reservation document error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /api/reservations/:id/documents/:filename
 * The ONLY way a stored document leaves the server. The reservation
 * must belong to the caller's business, and the filename must be one
 * of that reservation's attached refs — anything else is a 404, so
 * the route cannot be used to probe other tenants' files. Served as
 * an attachment with nosniff, exactly like proof screenshots.
 */
export const serveReservationDocument = async (req: AuthRequest, res: Response) => {
  try {
    const filename = documentFilename(
      `${RESERVATION_DOCUMENT_REF_PREFIX}${path.basename(req.params.filename)}`
    );
    if (!filename) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const prisma = await getPrisma();
    const reservation = await prisma.reservation.findFirst({
      where: { id: req.params.id, companyId: resolveReservationCompanyId(req) },
      select: { cnicDocumentUrl: true, guestPhotoUrls: true }
    });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const attached = new Set<string>();
    const cnicName = documentFilename(reservation.cnicDocumentUrl);
    if (cnicName) attached.add(cnicName);
    const photos = Array.isArray(reservation.guestPhotoUrls)
      ? (reservation.guestPhotoUrls as unknown[])
      : [];
    for (const ref of photos) {
      const name = documentFilename(ref);
      if (name) attached.add(name);
    }
    if (!attached.has(filename)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const filePath = path.join(RESERVATION_DOCUMENT_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isPdfRef(filename)) res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Serve reservation document error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

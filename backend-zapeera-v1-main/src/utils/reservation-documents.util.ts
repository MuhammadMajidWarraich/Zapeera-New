import path from 'path';

// ─── Reservation guest documents ─────────────────────────────────────
// A reservation can carry two kinds of uploaded documents, captured
// in the New Reservation dialog:
//   · the guest's CNIC document (one file: image or PDF)
//   · photos of the persons staying (up to MAX_GUEST_PHOTOS images)
//
// The storage + serving model deliberately mirrors the payment-proof
// pattern (QA A-09): files land on disk under uploads/ with a 128-bit
// random name and the canonical extension of their MAGIC-BYTE type,
// and they are NEVER served statically — the only way out is the
// authenticated, business-scoped GET /reservations/:id/documents/:file
// route, which checks the file is attached to a reservation of the
// caller's business. The DB stores refs of the form
// `reservation-documents/<filename>`.

export const RESERVATION_DOCUMENT_DIR = path.join(
  process.cwd(),
  'uploads',
  'reservation-documents'
);

export const RESERVATION_DOCUMENT_REF_PREFIX = 'reservation-documents/';

export const MAX_GUEST_PHOTOS = 5;

// Same per-file cap as the payment-proof uploads.
export const MAX_DOCUMENT_FILE_SIZE = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp'];
const DOCUMENT_EXTENSIONS = [...IMAGE_EXTENSIONS, 'pdf'];

// rdoc_<32 hex>.<ext> — the only shape an upload can produce.
const FILENAME_PATTERN = /^rdoc_[0-9a-f]{32}\.(jpg|png|webp|pdf)$/;

export const documentFilename = (ref: unknown): string | null => {
  if (typeof ref !== 'string') return null;
  if (!ref.startsWith(RESERVATION_DOCUMENT_REF_PREFIX)) return null;
  const name = ref.slice(RESERVATION_DOCUMENT_REF_PREFIX.length);
  return FILENAME_PATTERN.test(name) ? name : null;
};

/** A ref that may be attached as the CNIC document (image or PDF). */
export const isCnicDocumentRef = (ref: unknown): boolean =>
  documentFilename(ref) !== null;

/** A ref that may be attached as a person photo (images only). */
export const isGuestPhotoRef = (ref: unknown): boolean => {
  const name = documentFilename(ref);
  if (!name) return false;
  const ext = name.split('.').pop() || '';
  return IMAGE_EXTENSIONS.includes(ext);
};

export const isPdfRef = (ref: unknown): boolean => {
  const name = documentFilename(ref);
  return !!name && name.endsWith('.pdf');
};

export { DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS };

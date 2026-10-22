import path from 'path';

// ─── Backup safety snapshots (storage) ───────────────────────────────
// Before a backup UPDATE touches a business, the service writes a full
// export of that business's CURRENT state to a file here and records
// a BackupSafetySnapshot row. The storage model mirrors the
// reservation-documents pattern: files live on disk under uploads/
// with server-generated names, and they are NEVER served statically —
// the only way out is the authenticated, owner-scoped download route
// in backup.controller.ts.

export const BACKUP_SAFETY_DIR = path.join(process.cwd(), 'uploads', 'backup-safety');

/** Stored name for a snapshot id: `safety_<id>.json` (id = cuid). */
export const safetySnapshotFileName = (snapshotId: string): string => `safety_${snapshotId}.json`;

const FILENAME_PATTERN = /^safety_[a-zA-Z0-9_-]+\.json$/;

/** Validate a stored file name coming back from the DB before use. */
export const isSafetySnapshotFileName = (name: unknown): name is string =>
  typeof name === 'string' && FILENAME_PATTERN.test(name);

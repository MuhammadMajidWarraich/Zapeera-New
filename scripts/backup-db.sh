#!/usr/bin/env bash
# ============================================================================
# Zapeera single-host — PostgreSQL backup
#
# Dumps the compose `postgres` service to a timestamped, gzipped SQL file.
# Run from the repo root on the host VM (cron example in MIGRATION.md):
#
#   ./scripts/backup-db.sh
#
# Env overrides:
#   BACKUP_DIR              default: <repo>/backups
#   BACKUP_RETENTION_DAYS   default: 14 (older zapeera-*.sql.gz are deleted)
#   OCI_BUCKET              if set, the dump is ALSO uploaded to that OCI
#                           Object Storage bucket (requires the OCI CLI,
#                           configured on the VM — see TODO in MIGRATION.md)
#
# Restore (see MIGRATION.md for the full, safe procedure):
#   gunzip -c backups/zapeera-YYYYMMDD-HHMMSS.sql.gz | \
#     docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/zapeera-$TS.sql.gz"

echo "[backup] dumping PostgreSQL (compose service: postgres) -> $OUT"
# POSTGRES_USER / POSTGRES_DB are expanded INSIDE the container, where the
# postgres image already has them in its environment.
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "[backup] wrote $OUT ($(du -h "$OUT" | cut -f1))"

# --- Optional off-VM copy: OCI Object Storage (Always Free 20 GB) ----------
# TODO (deploy day): install + configure the OCI CLI on the VM
# (`bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"`),
# create a bucket, set OCI_BUCKET=<bucket-name>, and this block goes live.
if [[ -n "${OCI_BUCKET:-}" ]]; then
  if command -v oci >/dev/null 2>&1; then
    echo "[backup] uploading to OCI bucket: $OCI_BUCKET"
    oci os object put --bucket-name "$OCI_BUCKET" --file "$OUT" \
      --name "zapeera/$(basename "$OUT")" --force >/dev/null
    echo "[backup] upload complete"
  else
    echo "[backup] WARNING: OCI_BUCKET is set but the OCI CLI is not installed — skipping upload" >&2
  fi
fi

# --- Retention ---------------------------------------------------------------
find "$BACKUP_DIR" -name 'zapeera-*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -print -delete || true
echo "[backup] done (retention: ${RETENTION_DAYS} days in $BACKUP_DIR)"

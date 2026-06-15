#!/bin/sh
# SQLite online backup for DMR-X.
#
# This is a shell script (not a TS file) so it runs inside the
# `alpine:3.20` backup container with no Node/Bun runtime. It uses
# the `sqlite3` CLI's `.backup` command, which takes a consistent
# snapshot of the database while the gateway is still writing — no
# need to stop the gateway or take a lock.
#
# The script:
#   1. Locates the SQLite database in /source
#   2. Creates a timestamped backup in /backups
#   3. Verifies the backup integrity with `PRAGMA integrity_check`
#   4. Optionally uploads to S3 (if S3_BACKUP_BUCKET is set)
#   5. Prunes backups older than BACKUP_RETENTION_DAYS
#
# Exit codes:
#   0   success
#   1   could not find the source DB
#   2   backup failed
#   3   integrity check failed (corrupt backup — investigate!)
#   4   upload failed (kept local copy)

set -eu

SOURCE_DIR="${SOURCE_DIR:-/source}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="dmr-x-${TIMESTAMP}.db"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
LOG_PREFIX="[backup $(date -u +%H:%M:%S)]"

log() { echo "${LOG_PREFIX} $*"; }

# 1) Locate the source DB
SOURCE_DB="${SOURCE_DIR}/data.db"
if [ ! -f "${SOURCE_DB}" ]; then
    log "ERROR: source database not found at ${SOURCE_DB}"
    exit 1
fi

# Make sure we have a sqlite3 binary
if ! command -v sqlite3 >/dev/null 2>&1; then
    log "ERROR: sqlite3 not installed in this image"
    exit 1
fi

# 2) Create the backup. `.backup` is a SQLite online backup API —
# it copies the database page-by-page while the gateway continues
# to serve traffic. No exclusive lock is held.
log "Starting backup of ${SOURCE_DB} -> ${BACKUP_PATH}"
if ! sqlite3 "${SOURCE_DB}" ".backup '${BACKUP_PATH}'"; then
    log "ERROR: sqlite3 .backup failed"
    exit 2
fi

# 3) Verify integrity. A corrupt backup is worse than no backup
# at all — it gives false confidence. Fail fast so the operator
# notices.
log "Verifying backup integrity"
INTEGRITY=$(sqlite3 "${BACKUP_PATH}" "PRAGMA integrity_check;" 2>&1)
if [ "${INTEGRITY}" != "ok" ]; then
    log "ERROR: integrity_check failed: ${INTEGRITY}"
    exit 3
fi
log "Integrity check passed"

# Show backup size
BACKUP_SIZE=$(stat -c '%s' "${BACKUP_PATH}" 2>/dev/null || stat -f '%z' "${BACKUP_PATH}")
log "Backup size: ${BACKUP_SIZE} bytes"

# 4) Optional: upload to S3
if [ -n "${S3_BACKUP_BUCKET:-}" ] && [ -n "${S3_BACKUP_ACCESS_KEY:-}" ] && [ -n "${S3_BACKUP_SECRET_KEY:-}" ]; then
    log "Uploading to s3://${S3_BACKUP_BUCKET}/${BACKUP_NAME}"
    export AWS_ACCESS_KEY_ID="${S3_BACKUP_ACCESS_KEY}"
    export AWS_SECRET_ACCESS_KEY="${S3_BACKUP_SECRET_KEY}"
    export AWS_DEFAULT_REGION="${S3_BACKUP_REGION:-us-east-1}"
    if aws s3 cp "${BACKUP_PATH}" "s3://${S3_BACKUP_BUCKET}/${BACKUP_NAME}"; then
        log "Upload complete"
    else
        log "ERROR: S3 upload failed (local copy retained at ${BACKUP_PATH})"
        exit 4
    fi
fi

# 5) Prune old backups. Only files we created — leave S3 / external
# copies alone.
log "Pruning local backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -maxdepth 1 -name 'dmr-x-*.db' -type f -mtime +"${RETENTION_DAYS}" -delete -print | while read -r f; do
    log "Pruned: $(basename "$f")"
done

# Report the surviving set
SURVIVING=$(find "${BACKUP_DIR}" -maxdepth 1 -name 'dmr-x-*.db' -type f | wc -l)
log "Done. ${SURVIVING} local backup(s) retained."

exit 0

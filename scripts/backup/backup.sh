#!/bin/sh
# SQLite online backup for DMR-X.
#
# This is a shell script (not a TS file) so it runs inside the
# `alpine:3.20` backup container with no Node/Bun runtime.
#
# The gateway writes either:
#   data.db        plaintext SQLite   (dev / no DMRX_ENCRYPTION_KEY)
#   data.db.enc    AES-256-GCM blob   (production, DMRX_ENCRYPTION_KEY set)
#
# We back up whichever one exists:
#   - plaintext:  `sqlite3 .backup` takes a consistent online snapshot of the
#                 SQLite database while the gateway is still writing — no
#                 need to stop the gateway or take a lock.
#   - encrypted:  `sqlite3 .backup` cannot read the blob, so the file is
#                 copied byte-for-byte (the gateway serializes on its own
#                 debounced save, and a live copy is still the shipped-cron
#                 expectation; a fully consistent snapshot is out of scope
#                 for an encrypted blob).
#
# The script:
#   1. Locates the SQLite database (data.db or data.db.enc) in /source
#   2. Creates a timestamped backup in /backups
#   3. Verifies the backup integrity with `PRAGMA integrity_check`
#      (plaintext only)
#   4. Optionally uploads to S3 (if S3_BACKUP_BUCKET is set)
#   5. Prunes backups older than BACKUP_RETENTION_DAYS
#
# Exit codes:
#   0   success
#   1   could not find the source DB (neither data.db nor data.db.enc)
#   2   backup failed
#   3   integrity check failed (corrupt backup — investigate!)
#   4   upload failed (kept local copy)

set -eu

SOURCE_DIR="${SOURCE_DIR:-/source}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_PREFIX="[backup $(date -u +%H:%M:%S)]"

log() { echo "${LOG_PREFIX} $*"; }

# 1) Locate the source DB — encrypted first (production), plaintext fallback
SOURCE_DB="${SOURCE_DIR}/data.db"
SOURCE_DB_ENC="${SOURCE_DIR}/data.db.enc"
BACKUP_NAME="dmr-x-${TIMESTAMP}.db"
if [ -f "${SOURCE_DB_ENC}" ]; then
    SOURCE_DB="${SOURCE_DB_ENC}"
    BACKUP_NAME="dmr-x-${TIMESTAMP}.db.enc"
    ENCRYPTED=1
elif [ -f "${SOURCE_DB}" ]; then
    ENCRYPTED=0
else
    log "ERROR: no source database found (looked for ${SOURCE_DB} and ${SOURCE_DB_ENC})"
    exit 1
fi
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# 2) Create the backup.
log "Starting backup of ${SOURCE_DB} -> ${BACKUP_PATH}"
if [ "${ENCRYPTED}" = "1" ]; then
    # Encrypted blob — sqlite3 .backup cannot read it; copy the bytes.
    if ! cp "${SOURCE_DB}" "${BACKUP_PATH}"; then
        log "ERROR: failed to copy encrypted database"
        exit 2
    fi
else
    # Make sure we have a sqlite3 binary
    if ! command -v sqlite3 >/dev/null 2>&1; then
        log "ERROR: sqlite3 not installed in this image"
        exit 1
    fi
    # `.backup` is a SQLite online backup API — it copies the database
    # page-by-page while the gateway continues to serve traffic. No
    # exclusive lock is held.
    if ! sqlite3 "${SOURCE_DB}" ".backup '${BACKUP_PATH}'"; then
        log "ERROR: sqlite3 .backup failed"
        exit 2
    fi
fi

# 3) Verify integrity. A corrupt backup is worse than no backup
# at all — it gives false confidence. Fail fast so the operator
# notices. (Not possible for an encrypted blob.)
if [ "${ENCRYPTED}" = "1" ]; then
    log "Skipping integrity check (encrypted database — sqlite3 cannot read it)"
else
    log "Verifying backup integrity"
    INTEGRITY=$(sqlite3 "${BACKUP_PATH}" "PRAGMA integrity_check;" 2>&1)
    if [ "${INTEGRITY}" != "ok" ]; then
        log "ERROR: integrity_check failed: ${INTEGRITY}"
        exit 3
    fi
    log "Integrity check passed"
fi

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
find "${BACKUP_DIR}" -maxdepth 1 \( -name 'dmr-x-*.db' -o -name 'dmr-x-*.db.enc' \) -type f -mtime +"${RETENTION_DAYS}" -delete -print | while read -r f; do
    log "Pruned: $(basename "$f")"
done

# Report the surviving set
SURVIVING=$(find "${BACKUP_DIR}" -maxdepth 1 \( -name 'dmr-x-*.db' -o -name 'dmr-x-*.db.enc' \) -type f | wc -l)
log "Done. ${SURVIVING} local backup(s) retained."

exit 0

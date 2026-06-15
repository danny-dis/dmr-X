# SQLite Backup Strategy

DMR-X persists everything (providers, conversations, API keys, routing
state) to a single SQLite file at `data.db`. The backup container in
`docker-compose.prod.yml` takes online snapshots of this file on a
configurable cron schedule.

## How it works

The `backup` container in `docker-compose.prod.yml`:

1. Mounts the gateway's data volume read-only at `/source`
2. Runs `sqlite3 data.db ".backup /backups/..."` on schedule
3. Verifies the snapshot with `PRAGMA integrity_check`
4. Optionally uploads to S3
5. Prunes local copies older than `BACKUP_RETENTION_DAYS`

The `.backup` command is SQLite's online backup API — it copies the
database page-by-page while the gateway is still serving traffic. No
exclusive lock is held and the gateway never needs to be stopped.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `BACKUP_CRON` | `0 */6 * * *` (every 6h) | Standard 5-field cron |
| `BACKUP_RETENTION_DAYS` | `14` | Local retention window |
| `S3_BACKUP_BUCKET` | unset | If set, snapshots uploaded here |
| `S3_BACKUP_ACCESS_KEY` | unset | S3 credential |
| `S3_BACKUP_SECRET_KEY` | unset | S3 credential |
| `S3_BACKUP_REGION` | `us-east-1` | S3 region |

## Disaster recovery

To restore from a backup:

```sh
# 1. Stop the gateway
docker compose -f docker-compose.prod.yml stop gateway

# 2. Replace the data.db on the gateway's volume
docker run --rm \
  -v dmr-x_dmr-x-data:/target \
  -v dmr-x_dmr-x-backups:/backups:ro \
  alpine:3.20 \
  sh -c "apk add --no-cache sqlite && \
         cp /backups/dmr-x-20260615T120000Z.db /target/data.db && \
         sqlite3 /target/data.db 'PRAGMA integrity_check;'"

# 3. Restart the gateway
docker compose -f docker-compose.prod.yml start gateway
```

## Recommended backup cadence

| Workload | Cadence | Retention | Why |
|----------|---------|-----------|-----|
| Personal / dev | Daily | 7 days | Cheap, infrequent changes |
| Small business (production) | Every 6h | 14 days | Reasonable RPO, week-plus history |
| Regulated / multi-tenant | Hourly | 90 days + S3 versioning | Compliance + low RPO |
| Mission-critical | Every 15m, replicated to a second region | 30 days | Sub-hour RPO |

Adjust `BACKUP_CRON` accordingly. For sub-hour backups, also enable
S3 versioning on the bucket so you can recover from an accidental
overwrite.

## Verifying backups

The script does an automatic integrity check on every snapshot. To
manually verify a backup:

```sh
sqlite3 /path/to/backup.db "PRAGMA integrity_check;"
# Should print: ok
```

For a deeper check (row counts, expected tables):

```sh
sqlite3 /path/to/backup.db <<EOF
.headers on
.mode column
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
SELECT COUNT(*) AS conversations FROM conversations;
SELECT COUNT(*) AS messages FROM messages;
SELECT COUNT(*) AS providers FROM providers;
SELECT COUNT(*) AS api_keys FROM api_keys;
EOF
```

## Restoring from S3

```sh
# Download
aws s3 cp s3://my-bucket/dmr-x-20260615T120000Z.db /tmp/restore.db

# Verify before restoring
sqlite3 /tmp/restore.db "PRAGMA integrity_check;"

# Stop the gateway, copy into place, restart (as above)
```

# Runbook — Backup & Restore (US-E19-01, D-BKP)

**Targets (D-BKP):** PITR · RPO ≤ 15 min · RTO ≤ 4 h · retention 35 days · restore test every quarter.

## What runs (staging `infra/staging/docker-compose.yml`)

| Service | Script | What it does |
|---|---|---|
| `backup-wal` | `infra/backup/wal-stream.sh` | Streams WAL continuously (`pg_receivewal --synchronous`, replication slot `fleet_backup`) into the `backups` volume → RPO of seconds. Adds a `replication` line to `pg_hba.conf` once if missing. |
| `backup` | `infra/backup/backup.sh` | Every 24 h: base backup (`pg_basebackup -Ft -z`) of the whole cluster (control + every tenant DB), a copy of the document files, 35-day retention (always keeps the newest), prunes WAL older than the oldest kept base backup, and records `backup / base_backup_ok \| base_backup_failed` in `ops_events`. |

The **Operations** page (platform admin → المراقبة) shows the last backup; a failed backup appears there as an error.

> ⚠️ The `backups` volume is on the same server. Copy it off-site daily (Hetzner Storage Box or Object Storage, e.g. `rclone sync /var/lib/docker/volumes/fleet-staging_backups/_data remote:fleet-backups`). Production (Architecture §11) uses a separate DB server and Object Storage.

Files are **write-once** (each upload gets a new key, nothing is overwritten), so a files copy taken after a base backup is consistent with any restore point at or before it; extra files are unreferenced and harmless.

## Restore to a point in time

Never restore over the running database. Build a new data directory, check it, then switch.

```bash
docker compose --env-file /opt/fleet/.env -f /opt/fleet/docker-compose.yml stop api jobs worker web
```

```bash
docker run --rm -it --network fleet-staging_default -v fleet-staging_backups:/backup -v /srv/fleet/restore:/restore -v /opt/fleet/backup:/scripts:ro \
  --user postgres --entrypoint bash postgres:16 -c 'PATH=/usr/lib/postgresql/16/bin:$PATH FILES_RESTORE_DIR=/restore/files /scripts/restore.sh /restore/pgdata "2026-11-12 14:05:00+00" 5433'
```

Check the restored data (row counts of the latest records, a known fuel entry, `SELECT max(at) FROM audit_log` in a tenant DB). Then stop Postgres, swap the `pgdata` volume content for `/srv/fleet/restore/pgdata` (and `files` for `/srv/fleet/restore/files`), start everything, and run `pnpm db:migrate` (no-op if versions match).

Without a target time the restore replays all archived WAL (latest state).

## Restore drill (quarterly, and before Pilot Wave 0)

`infra/backup/drill-local.sh` runs the **same three scripts** against a throw-away cluster: it writes rows before and after a target time, takes a base backup while WAL streams, restores to the target, and checks that exactly the "before" rows and the files came back. Run as the `postgres` user on any machine with PostgreSQL 16:

```bash
su postgres -c "bash infra/backup/drill-local.sh"
```

| Date | Where | Result | Restore time | Notes |
|---|---|---|---|---|
| 12 Nov 2026 | Dev container (PG 16) | ✅ DRILL PASSED — 1,500 rows before the target restored, 300 after excluded, files identical | ~1 s (small DB) | Scripts and PITR mechanics verified. **Still to do:** the same drill on the Hetzner staging volume with production-sized data, and the off-site copy. |

Record each drill here (date, data size, restore time, problems).

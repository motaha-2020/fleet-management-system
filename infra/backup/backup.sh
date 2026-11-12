#!/usr/bin/env bash
# Base backup + retention (D-BKP: PITR, 35 days). Run nightly (backup container loop) or by hand.
# Each run writes $BACKUP_DIR/base/<UTC stamp>/{base.tar.gz,backup_manifest,start_wal}, a copy of the
# document files when FILES_DIR is set, prunes what is older than RETENTION_DAYS (keeping the newest),
# removes WAL no longer needed, and records the result in ops_events (shown on the Operations page).
set -euo pipefail
: "${PGHOST:?}" "${PGUSER:=postgres}" "${BACKUP_DIR:=/backup}" "${RETENTION_DAYS:=35}" "${CONTROL_DB:=fleet_control}"
export PGHOST PGUSER
started=$(date +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="$BACKUP_DIR/base/$stamp"
mkdir -p "$dest"

record() { # severity code detail-json
  psql -d "$CONTROL_DB" -qc "INSERT INTO ops_events (kind, severity, code, detail) VALUES ('backup', '$1', '$2', '$3'::jsonb)" >/dev/null 2>&1 \
    || echo "[backup] could not record ops event" >&2
}
fail() { record error base_backup_failed "{\"stamp\":\"$stamp\",\"step\":\"$1\"}"; echo "[backup] FAILED at $1" >&2; exit 1; }
trap 'fail "${BASH_COMMAND%% *}"' ERR

pg_basebackup -D "$dest" -Ft -z -X none --checkpoint=fast -l "fleet-$stamp" 2>&1 | grep -v "WAL archiving is not enabled" || true
[[ -f "$dest/base.tar.gz" && -f "$dest/backup_manifest" ]] || fail pg_basebackup
# backup_manifest → "WAL-Ranges": [{ "Timeline": 1, "Start-LSN": "0/2000028", ... }] → first WAL file this backup needs
tli=$(grep -oE '"Timeline": *[0-9]+' "$dest/backup_manifest" | head -1 | grep -oE '[0-9]+$')
lsn=$(grep -oE '"Start-LSN": *"[0-9A-F]+/[0-9A-F]+"' "$dest/backup_manifest" | head -1 | grep -oE '[0-9A-F]+/[0-9A-F]+')
[[ -n "$tli" && -n "$lsn" ]] || fail manifest
hi=${lsn%/*}; lo=${lsn#*/}
printf '%08X%08X%08X\n' "$tli" "$((16#$hi))" "$(( 16#$lo >> 24 ))" > "$dest/start_wal"
if [[ -n "${FILES_DIR:-}" ]]; then
  # Files are write-once (a new key per upload), so a copy taken after the base backup is consistent with any
  # restore point at or before it; extra files are unreferenced and harmless.
  tar -C "$FILES_DIR" -czf "$dest/files.tar.gz" .
fi
touch "$dest/COMPLETE"

# Retention: drop complete backups older than RETENTION_DAYS, always keeping the newest one.
mapfile -t all < <(ls -1 "$BACKUP_DIR/base" | sort)
cutoff=$(date -u -d "-$RETENTION_DAYS days" +%Y%m%dT%H%M%SZ)
for b in "${all[@]:0:${#all[@]}-1}"; do if [[ "$b" < "$cutoff" ]]; then rm -rf "$BACKUP_DIR/base/$b"; fi; done
oldest=$(ls -1 "$BACKUP_DIR/base" | sort | head -1)
pg_archivecleanup "$BACKUP_DIR/wal" "$(cat "$BACKUP_DIR/base/$oldest/start_wal")"

size=$(du -sb "$dest" | cut -f1)
secs=$(( $(date +%s) - started ))
record info base_backup_ok "{\"stamp\":\"$stamp\",\"bytes\":$size,\"seconds\":$secs,\"oldest\":\"$oldest\"}"
echo "[backup] $stamp ok (${size} bytes, ${secs}s); oldest kept: $oldest"

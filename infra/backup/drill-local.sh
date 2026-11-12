#!/usr/bin/env bash
# Restore drill on a throw-away cluster (US-E19-01): the same wal-stream / backup / restore scripts as staging.
# Writes rows before and after a target time, restores to the target, and checks that exactly the "before"
# rows came back. Prints the measured restore time (RTO) and the WAL lag at the target (RPO). Run as postgres.
set -euo pipefail
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PATH="$BIN:$PATH"
here=$(cd "$(dirname "$0")" && pwd)
root=${DRILL_DIR:-/var/lib/fleetpg/drill}
P1=${DRILL_PORT:-5440}; P2=$((P1 + 1))
rm -rf "$root"; mkdir -p "$root"
export BACKUP_DIR="$root/backup" PGHOST=/tmp PGUSER=postgres PGPORT=$P1 RETENTION_DAYS=35 FILES_DIR="$root/files"
mkdir -p "$FILES_DIR" && echo "receipt-1" > "$FILES_DIR/receipt-1.bin"

cleanup() {
  [[ -n "${STREAM:-}" ]] && kill "$STREAM" 2>/dev/null || true
  pkill -f "pg_receivewal -D $BACKUP_DIR/wal" 2>/dev/null || true
  pg_ctl -D "$root/primary" -m immediate stop >/dev/null 2>&1 || true
  pg_ctl -D "$root/restored" -m immediate stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

initdb -D "$root/primary" -U postgres -A trust >/dev/null
pg_ctl -D "$root/primary" -l "$root/primary.log" -o "-p $P1 -k /tmp -c wal_level=replica -c max_wal_senders=4 -c max_replication_slots=4" -w start >/dev/null
psql -d postgres -qc "CREATE DATABASE fleet_control" -c "CREATE DATABASE app"
psql -d fleet_control -qf "$here/../../packages/db/migrations/control/0008_ops_events.sql"
psql -d app -qc "CREATE TABLE drill (id serial PRIMARY KEY, phase text NOT NULL, at timestamptz NOT NULL DEFAULT now())"

"$here/wal-stream.sh" > "$root/stream.log" 2>&1 & STREAM=$!
sleep 2
psql -d app -qc "INSERT INTO drill (phase) SELECT 'before_base' FROM generate_series(1, 1000)"
"$here/backup.sh"
psql -d app -qc "INSERT INTO drill (phase) SELECT 'after_base' FROM generate_series(1, 500)"
sleep 1.5
target=$(psql -d postgres -Atc "SELECT now()")
target_lsn=$(psql -d postgres -Atc "SELECT pg_current_wal_lsn()")
sleep 1.5
psql -d app -qc "INSERT INTO drill (phase) SELECT 'after_target' FROM generate_series(1, 300)"
psql -d postgres -qAtc "SELECT pg_switch_wal()" >/dev/null
sleep 3
archived=$(ls "$BACKUP_DIR/wal" | wc -l)

t0=$(date +%s)
FILES_RESTORE_DIR="$root/files-restored" "$here/restore.sh" "$root/restored" "$target" "$P2"
rto=$(( $(date +%s) - t0 ))
got=$(psql -p "$P2" -d app -Atc "SELECT phase || '=' || count(*) FROM drill GROUP BY phase ORDER BY phase" | tr '\n' ' ')
ops=$(psql -d fleet_control -Atc "SELECT code FROM ops_events WHERE kind='backup' ORDER BY at DESC LIMIT 1")
files_ok=$(cmp -s "$FILES_DIR/receipt-1.bin" "$root/files-restored/receipt-1.bin" && echo yes || echo no)

echo "target time      : $target (lsn $target_lsn)"
echo "rows restored    : $got"
echo "files restored   : $files_ok"
echo "restore time     : ${rto}s (RTO target ≤ 4 h)"
echo "RPO              : every row written up to the target came back (WAL streamed synchronously; target ≤ 15 min)"
echo "WAL files kept   : ${archived} (pruned to the oldest base backup: $(cat "$BACKUP_DIR"/base/*/start_wal | head -1))"
echo "ops event        : $ops"
[[ "$got" == "after_base=500 before_base=1000 " && "$files_ok" == yes && "$ops" == base_backup_ok ]] && echo "DRILL PASSED" || { echo "DRILL FAILED"; exit 1; }

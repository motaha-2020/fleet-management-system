#!/usr/bin/env bash
# Point-in-time restore (US-E19-01). Builds a NEW data directory from the newest base backup taken before the
# target time, replays archived WAL up to the target, and promotes. The running database is never touched:
# switch the app over only after verify.sql looks right.
#   restore.sh <target data dir> [target time, e.g. "2026-11-12 14:05:00+00"] [port]
set -euo pipefail
: "${BACKUP_DIR:=/backup}"
target_dir=${1:?target data directory}
target_time=${2:-}
port=${3:-5433}
if [[ -e "$target_dir" && -n "$(ls -A "$target_dir" 2>/dev/null)" ]]; then echo "target $target_dir is not empty" >&2; exit 1; fi
started=$(date +%s)

pick=""
for b in $(ls -1 "$BACKUP_DIR/base" | sort); do
  [[ -f "$BACKUP_DIR/base/$b/COMPLETE" ]] || continue
  if [[ -n "$target_time" ]]; then
    bt=$(date -u -d "$(sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3 \4:\5:\6Z/' <<<"$b")" +%s)
    [[ $bt -le $(date -u -d "$target_time" +%s) ]] || continue
  fi
  pick=$b
done
[[ -n "$pick" ]] || { echo "no complete base backup before the target" >&2; exit 1; }
echo "[restore] base backup $pick → $target_dir"

mkdir -p "$target_dir" && chmod 700 "$target_dir"
tar -xzf "$BACKUP_DIR/base/$pick/base.tar.gz" -C "$target_dir"
mkdir -p "$target_dir/pg_wal"
# pg_receivewal keeps the segment it is writing as .partial: offer it under its final name as a last resort.
cat >> "$target_dir/postgresql.auto.conf" <<CONF
restore_command = 'cp "$BACKUP_DIR/wal/%f" "%p" 2>/dev/null || cp "$BACKUP_DIR/wal/%f.partial" "%p"'
recovery_target_action = 'promote'
port = $port
archive_mode = off
CONF
if [[ -n "$target_time" ]]; then echo "recovery_target_time = '$target_time'" >> "$target_dir/postgresql.auto.conf"; fi
touch "$target_dir/recovery.signal"

if [[ -n "${FILES_RESTORE_DIR:-}" && -f "$BACKUP_DIR/base/$pick/files.tar.gz" ]]; then
  mkdir -p "$FILES_RESTORE_DIR" && tar -xzf "$BACKUP_DIR/base/$pick/files.tar.gz" -C "$FILES_RESTORE_DIR"
fi

pg_ctl -D "$target_dir" -l "$target_dir/restore.log" -o "-p $port -k /tmp" -w -t 600 start
until [[ "$(psql -h /tmp -p "$port" -U "${PGUSER:-postgres}" -d postgres -Atc 'SELECT pg_is_in_recovery()')" == "f" ]]; do sleep 1; done
echo "[restore] promoted after $(( $(date +%s) - started ))s on port $port"

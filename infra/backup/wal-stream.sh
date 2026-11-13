#!/usr/bin/env bash
# Continuous WAL archive (D-BKP: RPO ≤ 15 min — streaming gives seconds). Runs in a postgres:16 container
# next to the database and writes completed WAL segments to $BACKUP_DIR/wal through a replication slot,
# so the server keeps WAL until it is safely copied.
set -euo pipefail
: "${PGHOST:?}" "${PGUSER:=postgres}" "${BACKUP_DIR:=/backup}" "${SLOT:=fleet_backup}"
export PGHOST PGUSER
mkdir -p "$BACKUP_DIR/wal"
until pg_isready -q; do sleep 2; done
# The official postgres image's pg_hba.conf allows replication only locally (local socket, 127.0.0.1, ::1),
# and this container connects over the network: add a host line for any address once (superuser only).
if ! psql -d postgres -Atqc "SELECT 1 FROM pg_hba_file_rules WHERE type = 'host' AND 'replication' = ANY(database) AND address = 'all'" | grep -q 1; then
  psql -d postgres -qc "COPY (SELECT 'host replication all all scram-sha-256') TO PROGRAM 'cat >> \"\$PGDATA/pg_hba.conf\"'" -c "SELECT pg_reload_conf()" >/dev/null
  echo "[wal-stream] added a replication line to pg_hba.conf"
fi
psql -d postgres -Atqc "SELECT 1 FROM pg_replication_slots WHERE slot_name = '$SLOT'" | grep -q 1 \
  || psql -d postgres -qc "SELECT pg_create_physical_replication_slot('$SLOT', true)" >/dev/null
echo "[wal-stream] streaming to $BACKUP_DIR/wal via slot $SLOT"
while true; do
  pg_receivewal -D "$BACKUP_DIR/wal" -S "$SLOT" --synchronous -n || echo "[wal-stream] receiver stopped ($?); restarting in 5 s" >&2
  sleep 5
done

#!/bin/sh
# Takes a consistent copy of the SQLite database, stores it as a restic snapshot and thins out old
# snapshots. Runs once at start and then every night at BACKUP_TIME (UTC). "backup.sh once" runs once.
set -eu
export RESTIC_REPOSITORY=/repo RESTIC_CACHE_DIR=/tmp/restic-cache HOME=/tmp

snapshot() {
  work=/tmp/snapshot
  rm -rf "$work" && mkdir -p "$work"
  # .backup gives a consistent file even while the app is writing
  sqlite3 /state/analyzer.db ".backup '$work/analyzer.db'"
  [ "$(sqlite3 "$work/analyzer.db" 'PRAGMA integrity_check;')" = "ok" ] || { echo "$(date -u +%FT%TZ) database copy failed the integrity check"; return 1; }
  cp /state/providers.json "$work/" 2>/dev/null || true
  restic cat config >/dev/null 2>&1 || restic init
  (cd "$work" && restic backup --quiet --host analyzer --tag nightly .)
  restic forget --quiet --host analyzer --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
  rm -rf "$work"
  echo "$(date -u +%FT%TZ) snapshot stored; repository now holds $(restic snapshots --json | grep -o '"short_id"' | wc -l) snapshots"
}

snapshot || echo "$(date -u +%FT%TZ) backup failed"
[ "${1:-}" = "once" ] && exit 0
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%F) ${BACKUP_TIME:-02:30}" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  snapshot || echo "$(date -u +%FT%TZ) backup failed"
done

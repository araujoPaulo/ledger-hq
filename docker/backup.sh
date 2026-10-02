#!/usr/bin/env bash
# Nightly encrypted backup. Records its own outcome so the application can
# show a failing backup instead of failing silently.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a && . ./.env && set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_LOCAL_DIR}/ledger-hq-${STAMP}.dump.age"
FILES_ARCHIVE="${BACKUP_LOCAL_DIR}/ledger-hq-${STAMP}.files.tar.age"
STATUS="OK"
DETAIL=""

# Appends rather than assigns: the dump and the attachment archive are two
# independent failure points below, and a night where both fail must report
# both causes, not have the second overwrite the first.
note() {
  DETAIL="${DETAIL:+${DETAIL}; }$1"
}

mkdir -p "${BACKUP_LOCAL_DIR}"

if docker compose exec -T postgres pg_dump \
      --format=custom --username "${POSTGRES_USER}" "${POSTGRES_DB}" \
    | age --recipient "${BACKUP_AGE_RECIPIENT}" --output "${ARCHIVE}"
then
  find "${BACKUP_LOCAL_DIR}" -name 'ledger-hq-*.dump.age' -mtime +30 -delete
  rclone copy "${ARCHIVE}" "${BACKUP_REMOTE}" || { STATUS="FAILED"; note "offsite copy failed"; }
else
  STATUS="FAILED"
  note "pg_dump or encryption failed"
  rm -f "${ARCHIVE}"
fi

# The two artifacts share ${STAMP} on purpose: different stamps describe
# different moments, and restoring across them produces exactly the orphan
# files and orphan rows the runbook's reconciliation looks for.
if docker compose exec -T api tar -cf - -C /var/lib/ledger-hq attachments \
    | age --recipient "${BACKUP_AGE_RECIPIENT}" --output "${FILES_ARCHIVE}"
then
  find "${BACKUP_LOCAL_DIR}" -name 'ledger-hq-*.files.tar.age' -mtime +30 -delete
  rclone copy "${FILES_ARCHIVE}" "${BACKUP_REMOTE}" || { STATUS="FAILED"; note "offsite copy failed"; }
else
  STATUS="FAILED"
  note "attachment archive failed"
  rm -f "${FILES_ARCHIVE}"
fi

# Passed as psql variables (`:'name'`), not interpolated into the SQL text,
# so a value can never break out of its quoting — even though STATUS and
# DETAIL are always one of a few fixed literals set above, never
# attacker-controlled input. `--command`/`-c` does not perform variable
# substitution, so the statement is fed on stdin instead.
# `-v ON_ERROR_STOP=1` matters here specifically: without it, psql exits 0
# even when the INSERT itself fails (schema drift, permissions, disk full),
# which would make this script silently report success while never having
# recorded anything — exactly the "failing silently" this script exists to
# prevent.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set=status="${STATUS}" --set=detail="${DETAIL}" <<'SQL'
INSERT INTO "SystemHealth" (id, "check", status, detail)
VALUES (gen_random_uuid(), 'backup', :'status', NULLIF(:'detail', ''));
SQL

[ "${STATUS}" = "OK" ]

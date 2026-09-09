# Operations runbook

Ledger HQ runs as three containers (`postgres`, `api`, `web`) behind Caddy,
reachable only over Tailscale. This document is the practice owner's (or
whoever administers the box's) reference for running it day to day.

## First-time setup

```bash
git clone <repo-url> ledger-hq
cd ledger-hq
cp .env.example .env
```

Edit `.env` and fill in real values:

- `POSTGRES_PASSWORD` — a long random password (`openssl rand -base64 24`).
- `AUTH_SALT_SECRET` — 32 random bytes, base64-encoded (`openssl rand -base64 32`).
- `BACKUP_AGE_RECIPIENT` — the public key from an `age-keygen` keypair. **Write
  the private key down on paper and store it off-site** (see "What is stored
  where" below) — it is the only way to decrypt a backup, and it is never
  stored on this machine.
- `BACKUP_LOCAL_DIR` — where nightly dumps land before being copied offsite,
  e.g. `/var/backups/ledger-hq`.
- `BACKUP_REMOTE` — an `rclone` remote (`rclone config` first), e.g.
  `remote:ledger-hq`.

Bring the stack up:

```bash
docker compose up -d --build
curl -s localhost:8080/api/v1/health   # {"status":"ok"}
```

Expose it over Tailscale:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

The status output should show `https://<machine>.<tailnet>.ts.net` proxying to
`127.0.0.1:8080`. Open that URL on the phone with Tailscale connected — the
browser must show a valid certificate, which is what makes WebCrypto and the
service worker (needed for offline use and the vault) available. A plain
`http://` origin will not register a service worker at all.

Then, in the browser at that URL:

1. Create the account (this is the one-time bootstrap — there is exactly one
   user in this system).
2. **Write the recovery code down on paper and store it off-site**, separately
   from the `age` private key. Losing both the master password and the
   recovery code makes the vault permanently unrecoverable — there is no
   password-reset flow, by design.

Schedule the nightly backup:

```bash
chmod +x docker/backup.sh
crontab -e
# add:
0 3 * * * /path/to/ledger-hq/docker/backup.sh >> /var/log/ledger-hq-backup.log 2>&1
```

## Daily operation

- **Logs**: `docker compose logs -f api`, `docker compose logs -f web`, or
  `docker compose logs -f` for all three services. The API logs structured
  JSON (one line per request); the web container logs Caddy's access log.
  `docker compose logs --since 1h <service>` narrows to recent output.
- **Connection banner**: the web app shows an offline/online banner driven by
  `navigator.onLine` and a periodic health check. If it reads "offline" while
  the phone has a normal internet connection, check the Tailscale connection
  on the phone first (Settings → Tailscale), then `tailscale serve status` on
  the host, then `docker compose ps` for a crashed container.
- **Health report**: `GET /api/v1/system/health-report` (behind login) returns
  `{ lastBackup: { status, occurredAt } | null, consecutiveFailures: number }`.
  A `consecutiveFailures` count above 0, or a `lastBackup.occurredAt` older
  than a day, means the nightly cron job needs attention — check
  `/var/log/ledger-hq-backup.log` first.

## Update

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically at API container startup
(`prisma migrate deploy`, wired into `docker/Dockerfile.api`'s `CMD`) — no
separate migration step is needed.

## Rollback

If an update causes a regression:

```bash
docker compose down
# restore the most recent dump if the update also changed data in a way that
# needs undoing (see "Restore drill" below for the restore commands)
git checkout <previous tag>
docker compose up -d --build
```

## Restore drill (quarterly)

Run this against a throwaway database, never production, to prove the
backups are actually restorable:

```bash
# 1. Decrypt the most recent dump.
age --decrypt -i /path/to/age-private-key.txt \
  -o /tmp/restore-test.dump \
  "${BACKUP_LOCAL_DIR}/ledger-hq-<timestamp>.dump.age"

# 2. Restore into a throwaway database (not the running "ledger_hq" one).
docker compose exec -T postgres createdb -U "${POSTGRES_USER}" restore_drill
docker cp /tmp/restore-test.dump "$(docker compose ps -q postgres)":/tmp/restore-test.dump
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER}" \
  -d restore_drill --no-owner /tmp/restore-test.dump

# 3. Compare row counts against production for a couple of tables that
#    change often, e.g.:
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d restore_drill \
  -c 'SELECT count(*) FROM "Client";'
docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d ledger_hq \
  -c 'SELECT count(*) FROM "Client";'

# 4. Drop the throwaway database.
docker compose exec -T postgres dropdb -U "${POSTGRES_USER}" restore_drill
rm -f /tmp/restore-test.dump
```

If the counts don't match (accounting for the time between the dump and the
comparison), the backup pipeline is broken — investigate before the next
scheduled backup runs, not after a real incident forces the issue.

## What is stored where

| What | Where | Notes |
|---|---|---|
| Live database | `postgres-data` Docker volume, on this host | Mounted at `/var/lib/postgresql` (not `/var/lib/postgresql/data` — see `docker-compose.yml`'s comment on why). |
| Nightly encrypted dumps | `${BACKUP_LOCAL_DIR}` on this host | Pruned after 30 days by `docker/backup.sh`. Encrypted with `age`; useless without the private key. |
| Offsite copy of dumps | `${BACKUP_REMOTE}` (an `rclone` remote) | Same encrypted files, copied off this host in case it is lost entirely. |
| `age` private key | **Paper only, stored off-site** | Never written to disk on this host or any backup target. Without it, no dump — local or offsite — can be decrypted. |
| Vault recovery code | **Paper only, stored off-site**, separate from the `age` key | Generated at account bootstrap. Without it and without the master password, the vault's contents are permanently unrecoverable. |

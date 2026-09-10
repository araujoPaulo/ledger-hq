# Security model

This states plainly what Ledger HQ protects against and what it does not.
It covers two things that are at different stages of completion, and says
which is which throughout:

1. **The login/session layer** — built and live today.
2. **The credential vault** (key envelope, item encryption, recovery code) —
   designed in the [spec](superpowers/specs/2026-09-04-ledger-hq-design.md#9-vault-and-offline)
   and depended on by the login flow's own key derivation, but not built:
   it is Phase 1 scope. Every claim below about the vault, the recovery
   code, or anything downstream of the `stretched` key is a description of
   *design intent*, not of running code — marked as such inline.

## What is mitigated

Theft of the office machine, theft of backup files, a database copy, disk
level access to the server. In every one of these the attacker holds
AES-256-GCM ciphertext (once the vault exists) and, even today, only an
Argon2id hash of a hash — never a password, never a key.

## What is not mitigated

- **A lost or stolen phone with cached client data.** The PWA's read cache
  (`apps/web/vite.config.ts`'s Workbox `runtimeCaching` for `GET
  /api/v1/*`) stores every cached API response — the complete client
  register: names, Portuguese tax numbers, social security numbers, dates
  of birth, emails, phone numbers, free-text notes — **unencrypted**, in
  the browser's Cache Storage, for up to 24 hours (`maxAgeSeconds`). This
  is plain personal data, not credential material: the Argon2id-hash-of-a-
  hash reasoning above does not apply to it. A device that is lost or
  stolen while its browser profile is unlocked and unwiped exposes this
  cached data, in full, for up to that 24-hour window. There is no
  encryption at rest over this cache today; closing that gap depends on
  the vault (Phase 1) and is out of scope for the current phase.
- **A compromised server serving malicious JavaScript to an unlocked
  session.** The server delivers the application's own code; if that code
  is malicious, it runs with whatever key material the session holds
  unlocked, in the same browser context. No web-based zero-knowledge
  design solves this — it is a structural limit of the model, not a bug
  Ledger HQ could fix. The mitigations that do apply are cheap and already
  in place: `docker/Caddyfile` sends a strict CSP (`script-src 'self'
  'wasm-unsafe-eval'`, no external origins at all — the only externally
  reachable script source is the app's own bundle plus WebAssembly), and
  the server is never exposed to the public internet in the first place
  (Tailscale-only, see `docs/operations.md`). That second point is the
  strongest defence in the whole model: an attacker who cannot reach the
  server at all cannot serve it anything.
- **A keylogger, or any other compromise of the device itself while the
  session is unlocked.** Nothing in this design — or any comparable
  product's — defends against the device the user is typing into being
  already compromised.

## Key derivation, as actually implemented

`packages/crypto/src/derive.ts` and `apps/api/src/auth/auth.service.ts`
implement a four-stage pipeline. Stages 1 and 3 run in the browser; the
`authHash` produced by stage 3 is the only thing that ever reaches the
server.

```
1. masterKey  = Argon2id(masterPassword, salt = userKdfSalt,
                          m = 65536 KiB, t = 3, p = 1)     [browser, KDF_PARAMS]

2. stretched  = HKDF-SHA256(masterKey, info = "ledger-hq:vault") -> 32 bytes
                                                            [browser, deriveStretchedKey]

3. authHash   = Argon2id(masterKey, salt = utf8(masterPassword),
                          m = 16384 KiB, t = 1, p = 1)     [browser, AUTH_HASH_PARAMS]
                → travels to the server, over HTTPS via Tailscale, in the
                  bootstrap/login request body

4. stored     = Argon2id(authHash, m = 19456 KiB, t = 2, p = 1)
                                                            [server, SERVER_HASH_PARAMS]
                → this, not authHash itself, is what `User.authHashDigest` holds
```

The master password itself never leaves `deriveAuthCredentials`'s local
scope in `apps/web/src/auth/credentials.ts` — it is read from the form,
used to derive `masterKey` and then `authHash`, and discarded. Stage 4 —
"hash of a hash" — means that even a full copy of the `User` table gives an
attacker only `Argon2id(authHash)`, one more expensive step away from
`authHash` itself, which in turn is one non-invertible step away from
`masterKey`.

**Stage 2 (`stretched`) is implemented but not yet consumed anywhere.** No
code path in this repository currently calls `deriveStretchedKey`'s result
for anything — it exists in `packages/crypto` ready for Phase 1, which will
use it to unwrap the vault key described below. Today, the login flow only
ever uses stages 1, 3 and 4.

### Why 64 MiB is a ceiling, not a target

`KDF_PARAMS` (`packages/crypto/src/params.ts`) fixes stage 1 at 64 MiB
(`memorySizeKiB: 65536`), 3 iterations, 1 degree of parallelism. This is
deliberately *not* pushed higher for extra margin: 64 MiB is documented in
the source as the safe ceiling for Safari on iPhone — a more aggressive
parameter set crashes the tab on mobile, and a design goal (offline
credential access, see the spec's section 9.6) depends on the vault opening
on a phone. A parameter change here is not free: it must be re-verified on
a real device before landing, per the comment directly on `KDF_PARAMS`.

Stage 3 (`AUTH_HASH_PARAMS`) is deliberately far cheaper (16 MiB, 1
iteration): its input is already a 32-byte high-entropy key, not a
human-chosen password, so it needs far less work — and doubling the cost of
every login on top of the already-paid stage 1 cost would hurt the mobile
case for no security benefit.

## Login hardening actually implemented

Two measures exist specifically so that the login endpoint cannot be used
to enumerate which email addresses have an account — both are covered by
tests, not just comments:

- **`GET /auth/kdf?email=...`** returns the real `kdfSalt` for a known
  address, and a **deterministic decoy** for an unknown one: an HMAC-SHA256
  of the email keyed by the server-only `AUTH_SALT_SECRET` (validated at
  process startup by `validateEnv` — the process refuses to boot at all
  without it, rather than silently becoming an oracle in production). A
  decoy salt is indistinguishable from a real one to the caller.
- **`AuthService#login` always calls `argon2Verify`, even when the user
  does not exist**, against a fixed dummy digest computed once and memoised
  for the process's lifetime. `auth.service.test.ts` pins this behaviour
  directly — its own comment records that the brief's original
  implementation short-circuited on a missing user, skipping the expensive
  verification and turning response latency into exactly the oracle this
  exists to prevent. Both branches — real user, wrong password; no such
  user at all — pay the same Argon2id cost and return the same
  `auth.invalid_credentials` code.

## Sessions

`auth.login` / `auth.bootstrap` set an `httpOnly`, `SameSite=Strict` cookie
holding a random 32-byte token (`crypto.randomBytes(32)`, base64url). The
server never stores the raw token — only `sha256(token)` in
`Session.tokenHash` — so a database copy does not hand out valid session
tokens either. `secure` is controlled by `COOKIE_SECURE` (`true` in
production, over Tailscale's TLS; `false` only for local HTTP development)
and lifetime by `SESSION_TTL_DAYS` (30 by default).

## The vault (Phase 1 — design only, not built)

This section describes what the spec commits to building, so that the
threat model above reads completely even before the code exists. **None of
this is implemented in `apps/api` or `apps/web` today** beyond the
`stretched` key derivation already described.

Credentials will not be encrypted directly with a password-derived key.
Instead, a random 256-bit `vaultKey` is generated once and stored wrapped
two ways:

```
vaultKey          = random(32)
protectedVaultKey = AES-KW(vaultKey, stretched)              // unwrapped with the master password
recoveryVaultKey  = AES-KW(vaultKey, HKDF(recoveryCode))     // unwrapped with the recovery code
```

The indirection is what makes changing the master password cheap: only the
32-byte `protectedVaultKey` envelope is re-wrapped, not every stored
credential. Without it, a password change would have to decrypt and
re-encrypt every credential of every client in one operation that can fail
midway and leave the vault inconsistent.

**Recovery code:** 128 random bits, shown exactly once at account setup in
a human-transcribable form. It is the only other way to unwrap `vaultKey`.

> **Warning, once the vault ships:** losing both the master password and
> the recovery code means permanently losing every stored credential. There
> is no password reset and no backdoor — that is the property zero-knowledge
> buys, and this is its cost. The recovery code must be written on paper and
> stored off-site. The application will require explicit confirmation that
> it has been stored before the first credential can be created.

The web app's setup screen already ships this warning's copy today
(`auth.recoveryWarning` in both locale bundles, shown on `SetupPage`), ahead
of the feature that will make it literally true — there is no vault yet to
lose access to.

Independently of the vault, one thing is already true today and will
remain true after Phase 1 ships: **there is no password-reset flow of any
kind, for anyone.** This is a deliberate consequence of being a
single-user system with no email or SMS integration (see the design
spec's non-goals). Forgetting the master password today means the account
cannot be logged into again — there is nothing encrypted with it yet, so
nothing beyond access itself is lost, but that access is not recoverable
either. The spec is explicit that this is by design ("there is no reset
and no backdoor") rather than a gap Phase 1 is expected to close.

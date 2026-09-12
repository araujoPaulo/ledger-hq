# Security model

This states plainly what Ledger HQ protects against and what it does not.
It covers two things, both built and live today:

1. **The login/session layer.**
2. **The credential vault** (key envelope, item encryption, recovery code) —
   designed in the [spec](superpowers/specs/2026-09-04-ledger-hq-design.md#9-vault-and-offline)
   and implemented in Phase 1 (`packages/crypto`, `apps/api/src/vault`,
   `apps/api/src/auth`'s envelope/recovery endpoints, `apps/web/src/vault`).

## What is mitigated

Theft of the office machine, theft of backup files, a database copy, disk
level access to the server. Every one of these hands the attacker
AES-256-GCM ciphertext for every vault credential, and an Argon2id hash of
a hash for login — never a password, never a key.

This does **not** extend to the plaintext client register cached for
offline reads — see the next section. An office machine and a lost phone
are exposed identically there; that cache is not part of what this section
covers.

## What is not mitigated

- **A lost or stolen device — phone, laptop, or the office machine itself —
  with cached client-register data.** The PWA's read cache
  (`apps/web/vite.config.ts`'s Workbox `runtimeCaching` for `GET
  /api/v1/*`) stores every cached API response — the complete client
  register: names, Portuguese tax numbers, social security numbers, dates
  of birth, emails, phone numbers, free-text notes — **unencrypted**, in
  the browser's Cache Storage, for up to 24 hours (`maxAgeSeconds`). This
  is plain personal data, not credential material: the Argon2id-hash-of-a-
  hash reasoning above does not apply to it, and the vault's own
  ciphertext-only IndexedDB cache (below) does not narrow this gap either
  — the client register and the vault are two different caches, holding
  two different kinds of data. Any device that is lost or stolen while its
  browser profile is unlocked and unwiped exposes this cached data, in
  full, for up to that 24-hour window — whether that device is a phone in
  a coat pocket or the practice's own office computer. This remains an
  open gap after Phase 1; closing it would mean encrypting the client
  register cache too, which is out of scope for this phase.
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

**Stage 2 (`stretched`) unwraps the vault key.** `apps/web/src/vault/setup.ts`,
`unlock.ts` and `recover.ts` are the three places `deriveStretchedKey`'s
result is used — to wrap `protectedVaultKey` at setup, and to unwrap it on
every unlock. It never reaches the server and is held only for the
duration of these three operations.

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

## The vault

`packages/crypto/src/vault-key.ts` and `item.ts` implement the envelope
this section describes; `apps/api/src/vault/` (`Platform`, `Credential`,
`CredentialVersion`) and `apps/api/src/auth/` (the envelope fields on
`User`) persist it; `apps/web/src/vault/` is the browser side.

Credentials are not encrypted directly with a password-derived key.
Instead, a random 256-bit `vaultKey` is generated once, at setup, and
stored wrapped two ways:

```
vaultKey          = random(32)
protectedVaultKey = AES-KW(vaultKey, stretched)              // unwrapped with the master password
recoveryVaultKey  = AES-KW(vaultKey, HKDF(recoveryCode))     // unwrapped with the recovery code
```

The indirection is what makes changing the master password cheap in
principle (a future feature, not built yet): only the 32-byte
`protectedVaultKey` envelope would need re-wrapping, not every stored
credential.

Each credential's current and prior values (`CredentialVersion`) are
AES-256-GCM, a fresh random 96-bit IV per encryption, authenticated —
`packages/crypto/src/item.test.ts` proves a single flipped ciphertext byte,
or the wrong key, makes decryption fail rather than silently return
garbage. TOTP codes (`totp.ts`) are generated client-side from a secret
that itself lives only inside the encrypted item; nothing server-side ever
sees it in the clear.

**The unwrapped `vaultKey` is a non-extractable WebCrypto `CryptoKey`**
(`unwrapVaultKey`, `importVaultSessionKey`) — even this application's own
code cannot read its raw bytes back out once unlocked, only use it to
encrypt or decrypt. It lives in a module-level store
(`apps/web/src/vault/vault-session.ts`), never in `localStorage` or
IndexedDB, and is dropped after 5 minutes of inactivity or when the tab is
hidden and reappears past that window. Copying a revealed password to the
clipboard clears it again 30 seconds later, to the extent the browser
permits (`CredentialRow.tsx`).

**Recovery code:** 128 random bits, shown exactly once on `VaultSetupPage`
in a human-transcribable, dash-grouped form, with an explicit checkbox
gating continuation. It is the only other way to unwrap `vaultKey` — and,
since Task 6, the only way to regain access to the *account* at all once
the master password is lost (see "Recovery, not just reset" below).

> **Warning.** Losing both the master password and the recovery code means
> permanently losing every stored credential. There is no backdoor — that
> is the property zero-knowledge buys, and this is its cost. The recovery
> code must be written on paper and stored off-site.

**Offline reads, no offline writes.** `apps/web/src/vault/vault-db.ts`
caches ciphertext, IVs and non-sensitive metadata (never plaintext —
enforced at runtime by `putCachedCredentials`'s field-shape guard, not
just by a test) in IndexedDB, refreshed opportunistically by
`useVaultSync` whenever the app is online (`sync.ts`, cursor-based on
`updatedAt`). With the network down entirely, `VaultUnlockGate` falls back
to that cache to unlock and decrypt — the server takes no part. Writing
(creating or rotating a credential) always requires a live connection;
there is no offline write queue for credentials, deliberately, to avoid
two divergent plaintexts for the same password with no way to know which
one a portal actually accepts.

### Recovery, not just reset

The spec's own risk table calls out "master password and recovery code
both lost" as a named risk, which only makes sense if the recovery code
alone is enough to regain access when *just* the master password is lost.
Doing that safely — without the server ever seeing `vaultKey` or the
recovery code — needed one more piece the spec's crypto section did not
specify: a way for the server to verify *possession* of the recovery code.
`docs/adr/0005-recovery-code-verification.md` records that decision.

In short: `recoveryAuthHash = Argon2id(vaultKey, salt = recoveryCode)` is
computed the same way `authHash` already is, stored server-side as
`Argon2id(recoveryAuthHash)`, and verified the same timing-safe way login
verifies `authHash` (`AuthService#recoverVault`, `auth.service.test.ts` —
`argon2Verify` runs exactly once whether or not a vault was ever set up).
A successful verification is what authorises resetting `kdfSalt`,
`authHashDigest` and `protectedVaultKey` in the same request — the one
case in this system where an unauthenticated endpoint can change login
credentials, because proving the recovery code stands in for a session.

There is still no password-reset flow that does not require the recovery
code — that remains deliberate, a consequence of being a single-user
system with no email or SMS integration (see the design spec's
non-goals). Forgetting the master password *and* losing the recovery code
together is unrecoverable, by design: nothing server-side can stand in
for either, because the server never has enough information to
reconstruct `vaultKey` on its own. What Phase 1 changes is that forgetting
*just* the master password is no longer permanent, provided the recovery
code was kept — see "Recovery, not just reset" above.

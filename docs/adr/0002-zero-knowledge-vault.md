# 0002 — Zero-knowledge vault via one password, two derivations

## Status

Design decided; key derivation implemented and live in the login flow;
the vault itself (key envelope, item encryption, recovery code) is Phase 1
and not built yet. See `docs/security-model.md` for the line between the
two.

## Context

Goal 2 of the design spec requires that neither the server nor its backups
can expose stored credentials — a compromise of the server, or theft of its
disk or backups, must yield only ciphertext. At the same time, credentials
must be readable with no network connection at all (goal 3), which rules
out any design where decryption requires a round trip to the server.

## Decision

A single master password is derived in two directions that cannot be
inverted into one another:

```
masterKey = Argon2id(masterPassword, salt = userSalt, m = 64 MiB, t = 3, p = 1)
stretched = HKDF-SHA256(masterKey, info = "ledger-hq:vault")
authHash  = Argon2id(masterKey, salt = masterPassword, t = 1)
```

`stretched` never leaves the device and (once Phase 1 ships) unwraps the
vault key. `authHash` is the only thing that travels to the server, which
itself stores only `Argon2id(authHash)` — a hash of a hash. An attacker
holding the entire database must break Argon2id twice to reach anything
that could unlock the vault.

Credentials themselves will not be encrypted directly with a
password-derived key. A random 256-bit `vaultKey`, generated once, is
wrapped twice — `AES-KW(vaultKey, stretched)` and
`AES-KW(vaultKey, HKDF(recoveryCode))` — so that changing the master
password only re-wraps one 32-byte key. Without that indirection, a
password change would have to decrypt and re-encrypt every stored
credential of every client in one operation, which can fail partway
through and leave the vault in an inconsistent state.

**Two separate passwords — one for login, one for the vault — were
considered and rejected.** In practice a user would choose the same
password for both anyway, at which point the server would see the vault
secret at the moment of login and the zero-knowledge property would fail
silently, with no visible symptom telling anyone it had failed.

## Consequences

- Losing both the master password and the recovery code, once the
  recovery code exists, means every stored credential is permanently
  unrecoverable. There is no password reset and no backdoor — that is the
  definition of zero-knowledge and the property being paid for. This is an
  accepted, deliberate cost, not an oversight: the application will refuse
  to let a credential be created until the user confirms the recovery code
  has been written down and stored off-site.
- Independently of the vault, and true already today: this is a
  single-user system with no email or SMS integration, so there has never
  been, and there is not planned to be, any password-reset flow at all.
  Forgetting the master password before the vault exists costs only login
  access (nothing is encrypted with it yet); after the vault exists it
  costs every stored credential too.
- The key-derivation half of this decision (`masterKey`, `stretched`,
  `authHash`) was pulled forward into Phase 0, ahead of the vault itself,
  because login needed *some* derivation from day one — building a
  throwaway plaintext-password login first would have meant a second
  implementation and a migration later. `packages/crypto`'s
  `deriveStretchedKey` therefore already exists and is already tested, but
  nothing yet calls it for anything: its result is inert until the vault
  consumes it.

## Revisit when

- Multi-user support is ever considered — the whole scheme assumes one
  user's `masterKey` guards one vault; a second user needs their own
  independent key, not a shared one.
- A hardware or biometric unlock (e.g. WebAuthn) is wanted as an additional
  local factor — it would sit in front of `stretched`, not replace the
  underlying non-invertible split, and the recovery-code path would still
  need to exist underneath it.
- Argon2id's 64 MiB ceiling (see `docs/security-model.md`) turns out to be
  unsafe against a real attack, or a future mobile browser regresses below
  what 64 MiB needs — either would force the parameters to be revisited
  together, not the vault's own design.

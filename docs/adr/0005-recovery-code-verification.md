# 5. Recovery-code verification without a server-visible vault key

## Status

Accepted.

## Context

Section 9.2 of the design spec promises that the recovery code, shown once
at vault setup, is "the only other way to unwrap `vaultKey`" and frames
losing both the master password and the recovery code as the failure case
— implying that losing *just* the master password is recoverable. The spec
does not say how: a zero-knowledge server never sees `vaultKey`, so it has
no way to check whether a client presenting a recovery code actually holds
the right one, and no way to distinguish a legitimate recovery attempt from
an attacker who simply crafts a plausible-looking "reset my login
credentials" request. Recovery *must* work without an existing session —
that is the entire point — so ordinary session-based authorization cannot
gate it either.

## Decision

Mirror the login flow's own "hash of a hash" shape with a third, independent
hash:

```
recoveryAuthHash = Argon2id(vaultKey, salt = recoveryCode, params = AUTH_HASH_PARAMS)
```

Computed once at vault setup (`VaultSetupPage` → `setUpVault`) and stored
server-side as `Argon2id(recoveryAuthHash)` (`SERVER_HASH_PARAMS`, the same
parameters `authHashDigest` already uses). `POST /auth/vault-recover`
recomputes `recoveryAuthHash` client-side from the vault key recovered by
unwrapping `recoveryVaultKey` with the recovery code, and the server
verifies it the same timing-safe way `login` verifies `authHash` — a dummy
digest paid on every attempt, so response latency cannot reveal whether a
vault was ever set up. A successful verification authorizes resetting
`kdfSalt`, `authHashDigest` and `protectedVaultKey` in the same request,
and returns a fresh session.

`GET /auth/vault-recovery-envelope`, which serves the wrapped
`recoveryVaultKey` blob itself, carries no session guard either — the
client needs it before it can prove anything. This is safe under this
system's own threat model (`docs/security-model.md`): the model already
assumes an attacker with full database access, and a wrapped blob is only
useful with the 128-bit recovery code, which is not brute-forceable.

## Alternatives considered

- **No recovery flow at all; the recovery code only protects the vault,
  not the account.** Rejected: the spec's own risk table treats "lost
  master password" as recoverable via the code, and a system that
  generates a recovery code, warns the user to store it carefully, and
  then never lets them use it is worse than not promising recovery in the
  first place.
- **An email- or SMS-based reset.** Rejected outright — the design spec's
  non-goals explicitly exclude any such integration for this single-user,
  self-hosted system.
- **Trust the client's claim of a successful unwrap, with no server-side
  verification.** Rejected: an unauthenticated endpoint that resets login
  credentials on the client's say-so, with nothing the server can check,
  is a full account takeover for anyone who can reach it — and this server
  is reachable to anyone on the Tailscale network, not just its one user.

## Consequences

- One more Argon2id pass at vault setup, at the same cost tier as
  `authHash` — negligible against the already-paid 64 MiB stage 1 cost.
- One more column on `User` (`vaultRecoveryAuthDigest`) and one more
  unauthenticated route pair, both narrow in scope and covered by
  `AuthService#recoverVault`'s dedicated timing-safety test.
- The recovery code becomes, in effect, a second authentication factor for
  the account itself, not only for the vault — which is the correct
  reading of what the spec already promised, made concrete.

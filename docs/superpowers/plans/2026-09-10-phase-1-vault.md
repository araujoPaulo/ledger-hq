# Phase 1 — Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a zero-knowledge encrypted credential vault — platforms, per-client credentials with rotation history, TOTP generation, offline unlock and reads, and full disaster recovery via a recovery code — replacing the practice's current ad-hoc method of storing client access details.

**Architecture:** Extends the Phase 0 monorepo. `packages/crypto` gains the vault key envelope (generate/wrap/unwrap), item encryption (AES-256-GCM) and TOTP generation. A new `vault` API module (Platforms, Credentials) stores only ciphertext and metadata; the envelope itself (the wrapped vault key and the recovery-code proof) lives on the existing `User` row, exposed through `auth`, because Phase 0's module table assigns "vault unlock handshake" to `auth` and the envelope is that user's row, not a vault entity. The browser holds the unwrapped vault key as a non-extractable `CryptoKey` in a module-level store with auto-lock, caches ciphertext (never plaintext) in IndexedDB for offline reads, and never sends a write while offline.

**Tech Stack:** Same as Phase 0 (TypeScript 6.0, Node 24, NestJS 12, Prisma 7, PostgreSQL 18, React 19.2, Vite 8, hash-wasm 4, Vitest 5, Testcontainers, Playwright) plus `idb` 8 for typed IndexedDB access. No other new dependency: TOTP and base32 are implemented directly over WebCrypto, matching the spec's own rationale for why Argon2id and AES-GCM were chosen over anything requiring a second crypto stack.

**Spec:** `docs/superpowers/specs/2026-09-04-ledger-hq-design.md` (sections 6.4, 9, and the `vault` row of 5.2's module table)

## Recovery mechanism — a decision the spec leaves open

Section 9.2 promises that losing the master password is recoverable via the
recovery code; it does not say how the server can verify possession of that
code without ever seeing the vault key (the whole point of zero-knowledge is
that it can't). This plan closes that gap with a third hash-of-a-hash,
symmetric with login's own:

```
recoveryAuthHash = Argon2id(vaultKey, salt = recoveryCode, params = AUTH_HASH_PARAMS)
```

Stored server-side as `Argon2id(recoveryAuthHash)` (`SERVER_HASH_PARAMS`, the
same params `authHashDigest` already uses), verified the same timing-safe way
`login` verifies `authHash` — a dummy digest paid on every attempt, `argon2Verify`
called exactly once regardless of outcome. Recovery code is 128 random bits,
comfortably long enough to serve as an Argon2id salt (the same 8-byte floor
`MIN_MASTER_PASSWORD_LENGTH` documents for the master password). A single
endpoint (`POST /auth/vault-recover`) verifies `recoveryAuthHash` and, on
success, atomically resets `kdfSalt` + `authHashDigest` (a new master password)
and `vaultProtectedKey` (rewrapped with the new one) in the same request,
returning a fresh session — because the whole point of recovery is to work
without ever holding a valid session or the old master password.

## Global Constraints

Every task inherits these, plus everything in Phase 0's Global Constraints
(language, money, dates, identifiers, deletion, error contract, locales, KDF
parameters, secrets-never-logged, module boundaries, TDD). New for this phase:

- **The vault key is never extractable once unlocked.** `unwrapVaultKey` and
  `importVaultSessionKey` both import with `extractable: false`. No function
  in `packages/crypto` or `apps/web` exports it back out to raw bytes after
  that point.
- **IndexedDB never receives plaintext.** Only `ciphertext`, `iv`, and
  non-sensitive metadata (`clientId`, `platformId`, `label`, `updatedAt`,
  platform `name`/`url`/`authKind`) are ever written to any object store.
- **Credential reads work offline; writes never do.** A write while offline
  fails with a clear, translated message. There is no offline write queue for
  credentials — see spec 9.6.
- **The recovery code is never persisted anywhere** — not IndexedDB, not
  `localStorage`, not any API request after the one that sets it up. It exists
  only in the browser's memory during the setup flow and on the practitioner's
  paper copy.
- **AES-256-GCM, 96-bit random IV, never reused** for every credential
  version. AES-KW for wrapping the vault key itself (no IV — AES-KW's own
  integrity check is what makes wrap/unwrap tamper-evident).
- **TOTP:** RFC 6238 over HMAC-SHA1 (RFC 4226), 30-second step, 6 digits —
  matching every authenticator app and 2-step-verification portal by default.

## Decisions this plan makes that the spec leaves open

- **Recovery mechanism:** the `recoveryAuthHash` design above (user-approved).
- **TOTP and base32 implemented directly over WebCrypto**, not a third-party
  library, for the same reason Argon2id and AES-GCM were chosen in Phase 0:
  one audited primitive stack, no second implementation to keep in sync, no
  native build step.
- **IndexedDB access via `idb` 8** (Jake Archibald's thin promise wrapper),
  because raw `IDBRequest` callback code is significantly more error-prone to
  review for the "never write plaintext" invariant than a typed, promise-based
  API.
- **Vault unlock is per-feature, not a global gate.** Only the credentials
  section (embedded on a client's detail page) ever decrypts anything — the
  platform catalog (name, URL, auth kind) is plaintext metadata by design
  (spec 6.4: "the minimum needed to list, filter and index without unlocking
  the vault"), so the platforms admin page needs a session like any other
  page, never the unwrapped key. Rather than adding a second global gate
  parallel to `RequireSession`, the credentials section itself renders an
  inline unlock prompt when locked.
- **Recovery UI lives inside `LoginPage`** as a mode toggle, not a separate
  route: every route in this app is already intercepted by `RequireSession`
  and rendered as `LoginPage` whenever there is no session, so a standalone
  `/vault/recover` route would never actually be reachable without a session
  it exists to route around.
- **`SetupPage`'s existing `auth.recoveryWarning` copy is misplaced** — it
  currently warns about a recovery code before Phase 1 makes one exist. Task
  12 relocates it to `VaultSetupPage`, where a recovery code is actually
  generated, and leaves the account-setup screen without it.

## File structure (additions to Phase 0's layout)

```
packages/
├── crypto/src/
│   ├── vault-key.ts          generate/wrap/unwrap the vault key, recovery-code derivation
│   ├── item.ts                AES-GCM encrypt/decrypt of a credential item
│   └── totp.ts                RFC 6238 code generation
├── domain/src/schemas/
│   ├── platform.ts
│   ├── credential.ts          + the shared plaintext-item shape
│   └── vault.ts                setup / recover request shapes
apps/
├── api/src/
│   ├── auth/                  + vault-envelope, vault-setup, vault-recover
│   └── vault/                  new module: platforms, credentials
└── web/src/
    ├── vault/
    │   ├── vault-session.ts    in-memory key store, auto-lock
    │   ├── vault-db.ts          IndexedDB cache (vaultMeta, credentials, platforms, outbox)
    │   ├── sync.ts               cursor-based delta sync
    │   ├── outbox.ts             offline-queued audit trail for reveals
    │   ├── api.ts
    │   ├── VaultSetupPage.tsx
    │   ├── PlatformsPage.tsx
    │   └── CredentialsSection.tsx
    └── i18n/locales/{pt,en}/vault.json
```

---

### Task 1: Vault key envelope primitives

**Files:**
- Modify: `packages/crypto/src/params.ts`
- Modify: `packages/crypto/src/encoding.ts`
- Create: `packages/crypto/src/encoding.test.ts`
- Create: `packages/crypto/src/vault-key.ts`
- Create: `packages/crypto/src/vault-key.test.ts`
- Modify: `packages/crypto/src/derive.ts`
- Modify: `packages/crypto/src/derive.test.ts`
- Modify: `packages/crypto/src/index.ts`

**Interfaces:**
- Consumes: `Bytes`, `utf8` from `./encoding` (Phase 0); `AUTH_HASH_PARAMS`, the private `argon2` helper in `./derive` (Phase 0, same file).
- Produces (consumed by Task 2 and by `apps/web`):
  - `toBase32(bytes: Bytes): string`, `fromBase32(value: string): Bytes`
  - `generateVaultKey(): Bytes`
  - `generateRecoveryCode(): string`
  - `deriveRecoveryWrappingKey(recoveryCode: string): Promise<Bytes>`
  - `wrapVaultKey(vaultKey: Bytes, wrappingKey: Bytes): Promise<Bytes>`
  - `unwrapVaultKey(wrapped: Bytes, wrappingKey: Bytes): Promise<CryptoKey>`
  - `unwrapVaultKeyRaw(wrapped: Bytes, wrappingKey: Bytes): Promise<Bytes>`
  - `importVaultSessionKey(vaultKey: Bytes): Promise<CryptoKey>`
  - `deriveRecoveryAuthHash(vaultKey: Bytes, recoveryCode: string): Promise<Bytes>`

- [ ] **Step 1: Write the base32 round-trip and known-vector test**

`packages/crypto/src/encoding.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fromBase32, toBase32 } from './encoding'

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20))
    expect(fromBase32(toBase32(bytes))).toEqual(bytes)
  })

  it('matches the RFC 4648 test vector for "12345678901234567890"', () => {
    const bytes = new TextEncoder().encode('12345678901234567890')
    expect(toBase32(bytes)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  })

  it('decodes lowercase and dash-separated input', () => {
    const bytes = new TextEncoder().encode('12345678901234567890')
    expect(fromBase32('gezdgnbv-gy3tqojq-gezdgnbv-gy3tqojq')).toEqual(bytes)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: FAIL — `toBase32`/`fromBase32` are not exported yet.

- [ ] **Step 3: Implement base32**

Add to `packages/crypto/src/encoding.ts` (after the existing `utf8` function):

```ts
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, no padding. Used for the recovery code and TOTP secrets. */
export function toBase32(bytes: Bytes): string {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]

  return output
}

export function fromBase32(value: string): Bytes {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0
  let acc = 0

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    acc = (acc << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(bytes)
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: PASS, all 3 new cases green.

- [ ] **Step 5: Write the wrap/unwrap round-trip and wrong-key tests**

`packages/crypto/src/vault-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  deriveRecoveryWrappingKey,
  generateRecoveryCode,
  generateVaultKey,
  importVaultSessionKey,
  unwrapVaultKey,
  unwrapVaultKeyRaw,
  wrapVaultKey,
} from './vault-key'
import { encryptCredentialItem, decryptCredentialItem } from './item'

describe('vault key envelope', () => {
  it('unwraps back to a key that decrypts what the original key encrypted', async () => {
    const vaultKey = generateVaultKey()
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32))
    const sessionKey = await importVaultSessionKey(vaultKey)

    const wrapped = await wrapVaultKey(vaultKey, wrappingKey)
    const unwrapped = await unwrapVaultKey(wrapped, wrappingKey)

    const { ciphertext, iv } = await encryptCredentialItem(sessionKey, { password: 'hunter2' })
    await expect(decryptCredentialItem(unwrapped, ciphertext, iv)).resolves.toEqual({ password: 'hunter2' })
  })

  it('rejects unwrapping with the wrong wrapping key', async () => {
    const vaultKey = generateVaultKey()
    const wrapped = await wrapVaultKey(vaultKey, crypto.getRandomValues(new Uint8Array(32)))

    await expect(unwrapVaultKey(wrapped, crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow()
  })

  it('produces a session key from unwrapVaultKey that cannot be exported', async () => {
    const vaultKey = generateVaultKey()
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await wrapVaultKey(vaultKey, wrappingKey)
    const unwrapped = await unwrapVaultKey(wrapped, wrappingKey)

    expect(unwrapped.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', unwrapped)).rejects.toThrow()
  })

  it('unwrapVaultKeyRaw recovers the exact original bytes', async () => {
    const vaultKey = generateVaultKey()
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32))
    const wrapped = await wrapVaultKey(vaultKey, wrappingKey)

    await expect(unwrapVaultKeyRaw(wrapped, wrappingKey)).resolves.toEqual(vaultKey)
  })

  it('derives the same recovery wrapping key from the same recovery code', async () => {
    const code = generateRecoveryCode()
    const a = await deriveRecoveryWrappingKey(code)
    const b = await deriveRecoveryWrappingKey(code)
    expect(a).toEqual(b)
  })

  it('generates a recovery code with 26 base32 characters of entropy', () => {
    const code = generateRecoveryCode()
    expect(code.replace(/-/g, '')).toMatch(/^[A-Z2-7]{26}$/)
  })
})
```

This test file imports from `./item`, created in Task 2 — write both test
files now, but only implement `vault-key.ts` in this task; `item.ts` does not
exist yet, so this file fails to even type-check until Task 2. That is
expected and accepted: the two tasks are inseparable in review (this test is
the one exercising the full envelope round-trip), so this task's "run it,
confirm it fails" step below targets only `vault-key.test.ts`'s
envelope-only assertions, and the full suite is not green until Task 2 lands.

- [ ] **Step 6: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: FAIL — `./vault-key` and `./item` do not exist yet.

- [ ] **Step 7: Add the recovery HKDF info string**

Add to `packages/crypto/src/params.ts` (after `VAULT_HKDF_INFO`):

```ts
/**
 * Distinct from `VAULT_HKDF_INFO`: this expands the recovery *code* (not the
 * master password) into the key that wraps the second copy of the vault key.
 */
export const RECOVERY_HKDF_INFO = 'ledger-hq:vault-recovery'
```

- [ ] **Step 8: Implement the envelope primitives**

`packages/crypto/src/vault-key.ts`:

```ts
import { type Bytes, toBase32, utf8 } from './encoding'
import { RECOVERY_HKDF_INFO } from './params'

/** A fresh 256-bit key, wrapped separately for the master password and the recovery code. */
export function generateVaultKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * 128 random bits, formatted for paper transcription. 16 bytes base32-encode
 * to 26 characters, which does not divide evenly into groups — the last
 * group is short, which is fine; it is still exactly 128 bits of entropy.
 */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return (toBase32(bytes).match(/.{1,5}/g) ?? []).join('-')
}

function importWrappingKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-KW', false, ['wrapKey', 'unwrapKey'])
}

/** Wraps a freshly generated vault key so it can be persisted server-side. */
export async function wrapVaultKey(vaultKey: Bytes, wrappingKey: Bytes): Promise<Bytes> {
  const extractableKey = await crypto.subtle.importKey(
    'raw',
    vaultKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const wrapper = await importWrappingKey(wrappingKey)
  const wrapped = await crypto.subtle.wrapKey('raw', extractableKey, wrapper, 'AES-KW')
  return new Uint8Array(wrapped)
}

/**
 * Unwraps a stored envelope directly into a non-extractable session key: the
 * raw vault key bytes never exist in JavaScript at unlock time. AES-KW's
 * built-in integrity check means a wrong `wrappingKey` makes this reject
 * with an error — the offline "wrong master password" signal, with no
 * server round-trip and no test credential required.
 */
export async function unwrapVaultKey(wrapped: Bytes, wrappingKey: Bytes): Promise<CryptoKey> {
  const wrapper = await importWrappingKey(wrappingKey)
  return crypto.subtle.unwrapKey(
    'raw',
    wrapped,
    wrapper,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Same non-extractable import, used right after `generateVaultKey` during setup. */
export function importVaultSessionKey(vaultKey: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', vaultKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/**
 * Unwraps to raw bytes rather than a session `CryptoKey` — the one
 * deliberate exception to "the vault key is never extractable" (see Global
 * Constraints). Recovery (Task 14) needs the raw key twice: to recompute
 * `deriveRecoveryAuthHash` for the server to verify, and to `wrapVaultKey`
 * it again under the new master password. Nothing outside the recovery flow
 * calls this; every other path uses `unwrapVaultKey` above.
 */
export async function unwrapVaultKeyRaw(wrapped: Bytes, wrappingKey: Bytes): Promise<Bytes> {
  const wrapper = await importWrappingKey(wrappingKey)
  const extractableKey = await crypto.subtle.unwrapKey(
    'raw',
    wrapped,
    wrapper,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const raw = await crypto.subtle.exportKey('raw', extractableKey)
  return new Uint8Array(raw)
}

/** HKDF expansion of the recovery code into the key that wraps the second envelope copy. */
export async function deriveRecoveryWrappingKey(recoveryCode: string): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', utf8(recoveryCode), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8(RECOVERY_HKDF_INFO) },
    key,
    256,
  )
  return new Uint8Array(bits)
}
```

- [ ] **Step 9: Add the recovery auth hash derivation**

Add to `packages/crypto/src/derive.ts` (after `deriveAuthHash`), reusing the
file's own private `argon2` helper and `AUTH_HASH_PARAMS`:

```ts
/**
 * The server-verifiable proof of recovery-code possession: the same
 * hash-of-a-hash shape as `deriveAuthHash`, but keyed by the recovered vault
 * key and salted with the recovery code instead of the master password.
 * Never touches the master-password derivation path.
 */
export function deriveRecoveryAuthHash(vaultKey: Bytes, recoveryCode: string): Promise<Bytes> {
  return argon2(vaultKey, utf8(recoveryCode), AUTH_HASH_PARAMS)
}
```

- [ ] **Step 10: Add a known-recovery-hash test to `derive.test.ts`**

Add to `packages/crypto/src/derive.test.ts`:

```ts
it('deriveRecoveryAuthHash produces a different hash for a different recovery code', async () => {
  const vaultKey = crypto.getRandomValues(new Uint8Array(32))
  const a = await deriveRecoveryAuthHash(vaultKey, 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-F')
  const b = await deriveRecoveryAuthHash(vaultKey, 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-G')
  expect(a).not.toEqual(b)
})
```

(Add `deriveRecoveryAuthHash` to the file's existing import line from `./derive`.)

- [ ] **Step 11: Run it, confirm it still fails**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: FAIL — `./item` still does not exist (Task 2). `vault-key.test.ts`'s
own five cases that do not touch `./item` should already be passing; confirm
that with `pnpm --filter @ledger-hq/crypto test -- vault-key`.

- [ ] **Step 12: Export the new module**

Add to `packages/crypto/src/index.ts`:

```ts
export * from './vault-key'
```

- [ ] **Step 13: Commit**

```bash
git add packages/crypto/src/params.ts packages/crypto/src/encoding.ts packages/crypto/src/encoding.test.ts \
  packages/crypto/src/vault-key.ts packages/crypto/src/vault-key.test.ts \
  packages/crypto/src/derive.ts packages/crypto/src/derive.test.ts packages/crypto/src/index.ts
git commit -m "feat(crypto): add the vault key envelope and recovery-code derivation"
```

---

### Task 2: Item encryption and TOTP

**Files:**
- Create: `packages/crypto/src/item.ts`
- Create: `packages/crypto/src/item.test.ts`
- Create: `packages/crypto/src/totp.ts`
- Create: `packages/crypto/src/totp.test.ts`
- Modify: `packages/crypto/src/index.ts`

**Interfaces:**
- Consumes: `Bytes`, `fromBase32` from `./encoding` (Task 1).
- Produces (consumed by `apps/web`):
  - `encryptCredentialItem(vaultKey: CryptoKey, item: Record<string, unknown>): Promise<{ ciphertext: Bytes; iv: Bytes }>`
  - `decryptCredentialItem(vaultKey: CryptoKey, ciphertext: Bytes, iv: Bytes): Promise<Record<string, unknown>>`
  - `generateTotp(secretBase32: string, at?: Date): Promise<string>`

- [ ] **Step 1: Write the round-trip and tamper tests**

`packages/crypto/src/item.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decryptCredentialItem, encryptCredentialItem } from './item'

describe('credential item encryption', () => {
  it('round-trips arbitrary JSON-serialisable content', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const item = { username: '509123456', password: 'hunter2', extraFields: [{ label: 'PIN', value: '1234' }] }

    const { ciphertext, iv } = await encryptCredentialItem(key, item)
    await expect(decryptCredentialItem(key, ciphertext, iv)).resolves.toEqual(item)
  })

  it('uses a fresh IV on every call', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const a = await encryptCredentialItem(key, { password: 'x' })
    const b = await encryptCredentialItem(key, { password: 'x' })
    expect(a.iv).not.toEqual(b.iv)
  })

  it('rejects decryption when a ciphertext byte is flipped', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const { ciphertext, iv } = await encryptCredentialItem(key, { password: 'x' })
    const tampered = new Uint8Array(ciphertext)
    tampered[0] ^= 0xff

    await expect(decryptCredentialItem(key, tampered, iv)).rejects.toThrow()
  })

  it('rejects decryption with the wrong key', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const { ciphertext, iv } = await encryptCredentialItem(key, { password: 'x' })

    await expect(decryptCredentialItem(otherKey, ciphertext, iv)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: FAIL — `./item` does not exist.

- [ ] **Step 3: Implement item encryption**

`packages/crypto/src/item.ts`:

```ts
import type { Bytes } from './encoding'

/** AES-256-GCM with a fresh random 96-bit IV, never reused across items or versions. */
export async function encryptCredentialItem(
  vaultKey: CryptoKey,
  item: Record<string, unknown>,
): Promise<{ ciphertext: Bytes; iv: Bytes }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(item))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, plaintext)
  return { ciphertext: new Uint8Array(encrypted), iv }
}

/**
 * Throws if `vaultKey` is wrong or `ciphertext`/`iv` were tampered with: GCM's
 * authentication tag makes a bad key or altered bytes produce a rejected
 * decryption instead of garbage plaintext.
 */
export async function decryptCredentialItem(
  vaultKey: CryptoKey,
  ciphertext: Bytes,
  iv: Bytes,
): Promise<Record<string, unknown>> {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, vaultKey, ciphertext)
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: PASS. This also unblocks Task 1's `vault-key.test.ts`, which imports
from this file — run `pnpm --filter @ledger-hq/crypto test` (no filter) and
confirm every test in the package is now green, including Task 1's.

- [ ] **Step 5: Write the TOTP known-answer tests**

These values come from RFC 4226 Appendix D (HOTP, secret ASCII
`"12345678901234567890"`, HMAC-SHA1) truncated to 6 digits, and from applying
RFC 6238's counter derivation (`floor(unixTime / 30)`) on top — computed and
verified independently before writing this plan, not copied from memory.

`packages/crypto/src/totp.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateTotp } from './totp'

// base32 encoding of the ASCII string "12345678901234567890", RFC 6238's own
// test secret.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('generateTotp', () => {
  it('matches the RFC 6238 vector at T=59s (counter 1)', async () => {
    await expect(generateTotp(SECRET, new Date(59_000))).resolves.toBe('287082')
  })

  it('matches the RFC 6238 vector at T=1111111109s', async () => {
    await expect(generateTotp(SECRET, new Date(1_111_111_109_000))).resolves.toBe('081804')
  })

  it('matches the RFC 6238 vector at T=1111111111s', async () => {
    await expect(generateTotp(SECRET, new Date(1_111_111_111_000))).resolves.toBe('050471')
  })

  it('produces a 6-digit, zero-padded string', async () => {
    const code = await generateTotp(SECRET, new Date(0))
    expect(code).toMatch(/^\d{6}$/)
  })

  it('changes when the 30-second step changes', async () => {
    const a = await generateTotp(SECRET, new Date(0))
    const b = await generateTotp(SECRET, new Date(30_000))
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: FAIL — `./totp` does not exist.

- [ ] **Step 7: Implement TOTP**

`packages/crypto/src/totp.ts`:

```ts
import { fromBase32 } from './encoding'

const STEP_SECONDS = 30
const DIGITS = 6

/**
 * TOTP (RFC 6238) over HMAC-SHA1 (RFC 4226), 30-second steps, 6 digits — the
 * parameters every authenticator app and 2-step-verification portal assumes
 * by default. `secretBase32` is the shared secret exactly as a portal
 * displays it (e.g. "JBSWY3DP...").
 */
export async function generateTotp(secretBase32: string, at: Date = new Date()): Promise<string> {
  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS)
  const counterBytes = new Uint8Array(8)
  new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter))

  const key = await crypto.subtle.importKey(
    'raw',
    fromBase32(secretBase32),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes))

  const offset = signature[signature.length - 1] & 0x0f
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff)

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: PASS, every test in the package green.

- [ ] **Step 9: Export the new modules**

Add to `packages/crypto/src/index.ts`:

```ts
export * from './item'
export * from './totp'
```

- [ ] **Step 10: Typecheck and lint the package**

Run: `pnpm --filter @ledger-hq/crypto typecheck && pnpm --filter @ledger-hq/crypto lint`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add packages/crypto/src/item.ts packages/crypto/src/item.test.ts \
  packages/crypto/src/totp.ts packages/crypto/src/totp.test.ts packages/crypto/src/index.ts
git commit -m "feat(crypto): add credential item encryption and TOTP generation"
```

---
### Task 3: Domain enums, error codes and vault schemas

**Files:**
- Modify: `packages/domain/src/enums.ts`
- Modify: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/schemas/platform.ts`, `platform.test.ts`
- Create: `packages/domain/src/schemas/credential.ts`, `credential.test.ts`
- Create: `packages/domain/src/schemas/vault.ts`, `vault.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `uuidSchema`, `base64Schema` from `./common` (Phase 0).
- Produces (consumed by Tasks 5-9 on the API side, and by `apps/web`):
  - `AUTH_KIND_VALUES`, `AuthKind`
  - Five new `ErrorCode` members: `'vault.not_set_up'`, `'vault.already_set_up'`, `'vault.invalid_recovery_code'`, `'platforms.name_taken'`, `'credentials.label_taken'`
  - `createPlatformSchema`, `updatePlatformSchema`, `CreatePlatformInput`, `UpdatePlatformInput`
  - `createCredentialSchema`, `rotateCredentialSchema`, `credentialItemSchema`, `CreateCredentialInput`, `RotateCredentialInput`, `CredentialItem`
  - `setUpVaultSchema`, `recoverVaultSchema`, `SetUpVaultInput`, `RecoverVaultInput`

- [ ] **Step 1: Write the schema tests**

`packages/domain/src/schemas/platform.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPlatformSchema } from './platform'

describe('createPlatformSchema', () => {
  it('accepts a minimal platform', () => {
    const result = createPlatformSchema.safeParse({ name: 'Portal das Finanças', authKind: 'PASSWORD' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid URL', () => {
    const result = createPlatformSchema.safeParse({ name: 'X', authKind: 'PASSWORD', url: 'not a url' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown authKind', () => {
    const result = createPlatformSchema.safeParse({ name: 'X', authKind: 'FINGERPRINT' })
    expect(result.success).toBe(false)
  })
})
```

`packages/domain/src/schemas/credential.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createCredentialSchema, credentialItemSchema, rotateCredentialSchema } from './credential'

const uuid = '01927e6a-0000-7000-8000-000000000000'

describe('createCredentialSchema', () => {
  it('accepts a well-formed credential', () => {
    const result = createCredentialSchema.safeParse({
      clientId: uuid,
      platformId: uuid,
      label: 'Acesso principal',
      ciphertext: 'AAAA',
      iv: 'AAAA',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-base64 ciphertext', () => {
    const result = createCredentialSchema.safeParse({
      clientId: uuid,
      platformId: uuid,
      label: 'x',
      ciphertext: 'not base64!!',
      iv: 'AAAA',
    })
    expect(result.success).toBe(false)
  })
})

describe('rotateCredentialSchema', () => {
  it('accepts just ciphertext and iv', () => {
    expect(rotateCredentialSchema.safeParse({ ciphertext: 'AAAA', iv: 'AAAA' }).success).toBe(true)
  })
})

describe('credentialItemSchema', () => {
  it('accepts the full shape from spec 9.3', () => {
    const result = credentialItemSchema.safeParse({
      username: '509123456',
      password: 'hunter2',
      accessPin: '1234',
      totpSecret: 'JBSWY3DP',
      extraFields: [{ label: 'Senha de acesso SS', value: 'x' }],
      notes: 'Certified accountant access',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty item', () => {
    expect(credentialItemSchema.safeParse({}).success).toBe(true)
  })
})
```

`packages/domain/src/schemas/vault.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { recoverVaultSchema, setUpVaultSchema } from './vault'

describe('setUpVaultSchema', () => {
  it('accepts three base64 fields', () => {
    const result = setUpVaultSchema.safeParse({
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'AAAA',
      recoveryAuthHash: 'AAAA',
    })
    expect(result.success).toBe(true)
  })
})

describe('recoverVaultSchema', () => {
  it('accepts the reset payload', () => {
    const result = recoverVaultSchema.safeParse({
      recoveryAuthHash: 'AAAA',
      kdfSalt: 'AAAA',
      authHash: 'AAAA',
      protectedVaultKey: 'AAAA',
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `pnpm --filter @ledger-hq/domain test`
Expected: FAIL — none of the three schema files exist yet.

- [ ] **Step 3: Add the `AuthKind` enum**

Add to `packages/domain/src/enums.ts`:

```ts
export const AUTH_KIND_VALUES = ['PASSWORD', 'PASSWORD_OTP', 'CERTIFICATE'] as const
export type AuthKind = (typeof AUTH_KIND_VALUES)[number]
```

- [ ] **Step 4: Add the five error codes**

In `packages/domain/src/errors.ts`, extend the `ERROR_CODES` array (append
before the closing `] as const`):

```ts
  'vault.not_set_up',
  'vault.already_set_up',
  'vault.invalid_recovery_code',
  'platforms.name_taken',
  'credentials.label_taken',
```

- [ ] **Step 5: Write the platform schema**

`packages/domain/src/schemas/platform.ts`:

```ts
import { z } from 'zod'
import { AUTH_KIND_VALUES } from '../enums'

export const createPlatformSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: z.string().trim().url().max(500).optional(),
    authKind: z.enum(AUTH_KIND_VALUES),
  })
  .strict()

export const updatePlatformSchema = createPlatformSchema.partial()

export type CreatePlatformInput = z.infer<typeof createPlatformSchema>
export type UpdatePlatformInput = z.infer<typeof updatePlatformSchema>
```

- [ ] **Step 6: Write the credential schemas**

`packages/domain/src/schemas/credential.ts`:

```ts
import { z } from 'zod'
import { base64Schema, uuidSchema } from './common'

export const createCredentialSchema = z
  .object({
    clientId: uuidSchema,
    platformId: uuidSchema,
    label: z.string().trim().min(1).max(200),
    ciphertext: base64Schema,
    iv: base64Schema,
  })
  .strict()

export const rotateCredentialSchema = z
  .object({
    ciphertext: base64Schema,
    iv: base64Schema,
  })
  .strict()

/**
 * The plaintext shape a credential item decrypts to (spec 9.3). Never sent
 * to the server — validated client-side before encryption, and used as the
 * shared type between the vault UI's form and `encryptCredentialItem`.
 */
export const credentialItemSchema = z
  .object({
    username: z.string().trim().max(200).optional(),
    password: z.string().max(500).optional(),
    accessPin: z.string().max(50).optional(),
    totpSecret: z.string().trim().max(200).optional(),
    extraFields: z.array(z.object({ label: z.string().trim().min(1).max(100), value: z.string().max(500) })).max(20).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict()

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>
export type RotateCredentialInput = z.infer<typeof rotateCredentialSchema>
export type CredentialItem = z.infer<typeof credentialItemSchema>
```

- [ ] **Step 7: Write the vault envelope schemas**

`packages/domain/src/schemas/vault.ts`:

```ts
import { z } from 'zod'
import { base64Schema } from './common'

export const setUpVaultSchema = z
  .object({
    protectedVaultKey: base64Schema,
    recoveryVaultKey: base64Schema,
    recoveryAuthHash: base64Schema,
  })
  .strict()

export const recoverVaultSchema = z
  .object({
    recoveryAuthHash: base64Schema,
    kdfSalt: base64Schema,
    authHash: base64Schema,
    protectedVaultKey: base64Schema,
  })
  .strict()

export type SetUpVaultInput = z.infer<typeof setUpVaultSchema>
export type RecoverVaultInput = z.infer<typeof recoverVaultSchema>
```

- [ ] **Step 8: Run the tests, confirm they pass**

Run: `pnpm --filter @ledger-hq/domain test`
Expected: PASS, all new cases green.

- [ ] **Step 9: Export the new schemas**

Add to `packages/domain/src/index.ts`:

```ts
export * from './schemas/platform'
export * from './schemas/credential'
export * from './schemas/vault'
```

- [ ] **Step 10: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/domain typecheck && pnpm --filter @ledger-hq/domain lint`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add packages/domain/src/enums.ts packages/domain/src/errors.ts packages/domain/src/index.ts \
  packages/domain/src/schemas/platform.ts packages/domain/src/schemas/platform.test.ts \
  packages/domain/src/schemas/credential.ts packages/domain/src/schemas/credential.test.ts \
  packages/domain/src/schemas/vault.ts packages/domain/src/schemas/vault.test.ts
git commit -m "feat(domain): add vault, platform and credential schemas and error codes"
```

---
### Task 4: Database schema, migration and seed platforms

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_vault/migration.sql` (generated, then extended by hand)
- Modify: `apps/api/test/database.ts`
- Test: `apps/api/test/schema-constraints.integration.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks except enum names, which must match `packages/domain/src/enums.ts`'s `AUTH_KIND_VALUES` exactly.
- Produces (consumed by Tasks 5-8):
  - Prisma models `Platform`, `Credential`, `CredentialVersion`.
  - `User` fields `vaultProtectedKey`, `vaultRecoveryKey`, `vaultRecoveryAuthDigest`, `vaultSetUpAt`.
  - Three seed rows in `Platform`: `Portal das Finanças`, `Segurança Social Direta`, `ViaCTT`.

- [ ] **Step 1: Extend the schema**

Add to `apps/api/prisma/schema.prisma`, after the existing `IncomeTax` enum:

```prisma
enum AuthKind {
  PASSWORD
  PASSWORD_OTP
  CERTIFICATE
}
```

Add four fields to the existing `User` model (after `locale`):

```prisma
  vaultProtectedKey       Bytes?
  vaultRecoveryKey        Bytes?
  vaultRecoveryAuthDigest String?
  vaultSetUpAt            DateTime? @db.Timestamptz(3)
```

Add a `credentials` relation to the existing `Client` model (alongside
`fiscalProfile`):

```prisma
  credentials Credential[]
```

Add three new models, after `Employment`:

```prisma
model Platform {
  id        String   @id @db.Uuid
  name      String   @unique
  url       String?
  authKind  AuthKind
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  credentials Credential[]
}

model Credential {
  id         String   @id @db.Uuid
  clientId   String   @db.Uuid
  platformId String   @db.Uuid
  label      String
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @db.Timestamptz(3)

  client   Client              @relation(fields: [clientId], references: [id], onDelete: Cascade)
  platform Platform            @relation(fields: [platformId], references: [id])
  versions CredentialVersion[]

  @@unique([clientId, platformId, label])
  @@index([clientId])
  @@index([updatedAt])
}

model CredentialVersion {
  id           String   @id @db.Uuid
  credentialId String   @db.Uuid
  ciphertext   Bytes
  iv           Bytes
  createdAt    DateTime @default(now()) @db.Timestamptz(3)

  credential Credential @relation(fields: [credentialId], references: [id], onDelete: Cascade)

  @@index([credentialId, createdAt])
}
```

`Credential` references `Client.id` alone (not the composite `[id, kind]`
used by `Employment`): unlike employment, a credential applies identically to
either client kind, so there is no kind to pin.

- [ ] **Step 2: Generate the migration without applying it**

```bash
cd apps/api
pnpm exec prisma migrate dev --name vault --create-only
```

Expected: a new directory `prisma/migrations/<timestamp>_vault/` containing a
generated `migration.sql` that creates the `AuthKind` enum, adds the four
`User` columns, and creates `Platform`, `Credential` and `CredentialVersion`.

- [ ] **Step 3: Append the seed platforms**

Append to the generated `migration.sql`:

```sql
-- Seed the small, shared platform catalog every practice starts with. Fixed
-- IDs so this statement is idempotent if the migration is ever re-run against
-- a database that already has them (it is not: migrations run exactly once,
-- but fixed IDs cost nothing and make the intent explicit).
INSERT INTO "Platform" ("id", "name", "url", "authKind", "createdAt", "updatedAt") VALUES
  ('00000000-0000-7000-8000-000000000001', 'Portal das Finanças', 'https://www.portaldasfinancas.gov.pt', 'PASSWORD', now(), now()),
  ('00000000-0000-7000-8000-000000000002', 'Segurança Social Direta', 'https://app.seg-social.pt', 'PASSWORD', now(), now()),
  ('00000000-0000-7000-8000-000000000003', 'ViaCTT', 'https://www.viactt.pt', 'PASSWORD_OTP', now(), now());
```

- [ ] **Step 4: Apply the migration**

```bash
pnpm exec prisma migrate dev
```

Expected: the migration applies cleanly, the client regenerates into
`src/generated/prisma`, and `Platform` now has exactly three rows (verify with
`pnpm exec prisma studio` or a quick `psql` `SELECT count(*) FROM "Platform"`).

- [ ] **Step 5: Extend the integration test harness's reset order**

`Credential`/`CredentialVersion` are children of `Client`/`Platform`; they
must be deleted before their parents, same reasoning as the existing
`employment`-before-`client` ordering. Modify `apps/api/test/database.ts`:

```ts
export async function resetDatabase(): Promise<void> {
  const prisma = getTestPrisma()

  await prisma.systemHealth.deleteMany()
  await prisma.credentialVersion.deleteMany()
  await prisma.credential.deleteMany()
  await prisma.platform.deleteMany()
  await prisma.employment.deleteMany()
  await prisma.fiscalProfile.deleteMany()
  await prisma.auditEvent.deleteMany()
  await prisma.client.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
}
```

`platform.deleteMany()` also clears the three seed rows on every test reset;
Task 7's integration tests re-seed what they need per test, so this is
intentional — tests must not depend on migration-time seed data staying
around forever.

- [ ] **Step 6: Write a constraint test for the credential uniqueness triple**

Add to `apps/api/test/schema-constraints.integration.test.ts` (mirroring the
file's existing style of writing directly through Prisma, bypassing any
service layer, to prove the database itself — not application code — is
what rejects the violation):

```ts
it('rejects two credentials with the same client, platform and label', async () => {
  const prisma = getTestPrisma()
  const client = await prisma.client.create({
    data: { id: uuidv7(), kind: 'COMPANY', name: 'X', taxId: '500000001', accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  const platform = await prisma.platform.create({
    data: { id: uuidv7(), name: 'Test Platform', authKind: 'PASSWORD' },
  })
  const shared = { clientId: client.id, platformId: platform.id, label: 'Acesso principal' }

  await prisma.credential.create({ data: { id: uuidv7(), ...shared } })

  await expect(prisma.credential.create({ data: { id: uuidv7(), ...shared } })).rejects.toThrow()
})
```

(Add `uuidv7` to the file's existing imports if not already present, and
confirm the file already imports `getTestPrisma` from `./database.js`.)

- [ ] **Step 7: Run the constraint test**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS, including this new case.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/database.ts \
  apps/api/test/schema-constraints.integration.test.ts
git commit -m "feat(api): add the vault schema — platforms, credentials, and the user's key envelope"
```

---
### Task 5: Vault envelope endpoints on `auth`

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Test: `apps/api/test/vault.integration.test.ts` (new file)

**Interfaces:**
- Consumes: `setUpVaultSchema`, `SetUpVaultInput` from `@ledger-hq/domain` (Task 3); `ZodValidationPipe`, `SessionGuard`, `CurrentUser` (Phase 0, same files this task edits).
- Produces (consumed by Task 6 and by `apps/web`):
  - `AuthService.getVaultEnvelope(userId: string): Promise<VaultEnvelope>`
  - `AuthService.setUpVault(userId: string, input: SetUpVaultInput): Promise<void>`
  - `GET /auth/vault-envelope`, `POST /auth/vault-setup` (both session-guarded)

This task only covers setup and reading the envelope. Recovery (Task 6) is
kept separate because it is not session-guarded and has its own timing-safety
requirements — mixing the two in one task would make its review surface too
broad to check both properly.

- [ ] **Step 1: Write the integration tests**

`apps/api/test/vault.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

function post(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

describe('vault envelope', () => {
  it('reports not set up before any setup call', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/vault-envelope').set('Cookie', cookie).expect(200)
    expect(response.body).toEqual({ protectedVaultKey: null, setUpAt: null })
  })

  it('stores the envelope on setup and reports it back', async () => {
    await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'BBBB',
      recoveryAuthHash: 'CCCC',
    }).expect(204)

    const response = await request(app.getHttpServer()).get('/api/v1/auth/vault-envelope').set('Cookie', cookie).expect(200)
    expect(response.body.protectedVaultKey).toBe('AAAA')
    expect(response.body.setUpAt).not.toBeNull()
  })

  it('refuses to set up the vault twice', async () => {
    await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'BBBB',
      recoveryAuthHash: 'CCCC',
    }).expect(204)

    const response = await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'DDDD',
      recoveryVaultKey: 'EEEE',
      recoveryAuthHash: 'FFFF',
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('vault.already_set_up')
  })

  it('rejects vault-envelope without a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/vault-envelope').expect(401)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: FAIL — the two routes do not exist yet.

- [ ] **Step 3: Add the envelope methods to `AuthService`**

Add to `apps/api/src/auth/auth.service.ts`, inside the `AuthService` class
(after `bootstrap`), and add `export type VaultEnvelope = ...` above the class
alongside the existing `SessionUser` type export:

```ts
export type VaultEnvelope = { protectedVaultKey: string | null; setUpAt: string | null }
```

```ts
  async getVaultEnvelope(userId: string): Promise<VaultEnvelope> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })

    return {
      protectedVaultKey: user.vaultProtectedKey ? Buffer.from(user.vaultProtectedKey).toString('base64') : null,
      setUpAt: user.vaultSetUpAt?.toISOString() ?? null,
    }
  }

  async setUpVault(userId: string, input: SetUpVaultInput): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.vaultSetUpAt !== null) throw new AppError('vault.already_set_up', {}, 409)

    const recoveryAuthDigest = await argon2id({
      password: Buffer.from(input.recoveryAuthHash, 'base64'),
      salt: randomBytes(16),
      ...SERVER_HASH_PARAMS,
      outputType: 'encoded',
    })

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        vaultProtectedKey: Buffer.from(input.protectedVaultKey, 'base64'),
        vaultRecoveryKey: Buffer.from(input.recoveryVaultKey, 'base64'),
        vaultRecoveryAuthDigest: recoveryAuthDigest,
        vaultSetUpAt: new Date(),
      },
    })
  }
```

Add `SetUpVaultInput` to the file's existing `import type { BootstrapInput, LoginInput }` line from
`@ledger-hq/domain`, making it `import type { BootstrapInput, LoginInput, SetUpVaultInput } from '@ledger-hq/domain'`.

- [ ] **Step 4: Add the two routes to `AuthController`**

Add to `apps/api/src/auth/auth.controller.ts`, inside the `AuthController`
class (after the existing `session` method):

```ts
  @Get('vault-envelope')
  @UseGuards(SessionGuard)
  vaultEnvelope(@CurrentUser() user: SessionUser) {
    return this.auth.getVaultEnvelope(user.id)
  }

  @Post('vault-setup')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  @UsePipes(new ZodValidationPipe(setUpVaultSchema))
  async setUpVault(@CurrentUser() user: SessionUser, @Body() body: SetUpVaultInput): Promise<void> {
    await this.auth.setUpVault(user.id, body)
  }
```

Add `setUpVaultSchema` to the file's existing
`import { bootstrapSchema, kdfQuerySchema, loginSchema } from '@ledger-hq/domain'` line, and
`SetUpVaultInput` to its `import type { BootstrapInput, KdfQuery, LoginInput }` line.

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS, all four new cases green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ledger-hq/api typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts apps/api/test/vault.integration.test.ts
git commit -m "feat(api): add vault envelope read and one-time setup endpoints"
```

---
### Task 6: Recovery flow

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.service.test.ts`
- Modify: `apps/api/test/vault.integration.test.ts`

**Interfaces:**
- Consumes: `recoverVaultSchema`, `RecoverVaultInput` from `@ledger-hq/domain` (Task 3); `getDummyDigest`, `SERVER_HASH_PARAMS`, `argon2Verify`, `argon2id` (all already in `auth.service.ts` from Phase 0).
- Produces (consumed by Task 14): `AuthService.recoverVault(input: RecoverVaultInput): Promise<string>` (returns a session token, same contract as `login`); `AuthService.getRecoveryEnvelope(): Promise<{ recoveryVaultKey: string | null }>`; `GET /auth/vault-recovery-envelope` and `POST /auth/vault-recover` — neither session-guarded, since regaining access without a session is the entire point.

- [ ] **Step 1: Write the timing-safety unit test**

This mirrors `login`'s own regression test exactly: the concern is a future
edit reintroducing a short-circuit that skips `argon2Verify` when the vault
was never set up, turning response latency into a "has this user set up a
vault yet" oracle. Add to `apps/api/src/auth/auth.service.test.ts`:

```ts
describe('AuthService#recoverVault', () => {
  beforeEach(() => {
    argon2VerifyMock.mockReset()
    argon2idMock.mockReset()
    argon2idMock.mockResolvedValue('dummy-encoded-digest')
  })

  it('calls argon2Verify exactly once even when the vault was never set up', async () => {
    argon2VerifyMock.mockResolvedValue(false)
    const user = { id: 'u1', email: 'paulo@example.com', vaultRecoveryAuthDigest: null }
    const service = new AuthService(fakePrisma(user), fakeConfig())

    await expect(
      service.recoverVault({ recoveryAuthHash: SOME_AUTH_HASH, kdfSalt: SOME_AUTH_HASH, authHash: SOME_AUTH_HASH, protectedVaultKey: SOME_AUTH_HASH }),
    ).rejects.toMatchObject({ code: 'vault.invalid_recovery_code' })

    expect(argon2VerifyMock).toHaveBeenCalledTimes(1)
  })

  it('verifies against the stored recovery digest when one exists', async () => {
    argon2VerifyMock.mockResolvedValue(true)
    const user = { id: 'u1', email: 'paulo@example.com', vaultRecoveryAuthDigest: 'stored-recovery-digest' }
    const service = new AuthService(fakePrisma(user), fakeConfig())

    await service.recoverVault({
      recoveryAuthHash: SOME_AUTH_HASH,
      kdfSalt: SOME_AUTH_HASH,
      authHash: SOME_AUTH_HASH,
      protectedVaultKey: SOME_AUTH_HASH,
    })

    expect(argon2VerifyMock).toHaveBeenCalledWith(expect.objectContaining({ hash: 'stored-recovery-digest' }))
  })
})
```

`fakePrisma` needs `user.findFirst` for this (recovery has no session, so it
looks up the singleton user directly rather than by id) and `user.update`.
Extend the file's existing `fakePrisma` helper:

```ts
function fakePrisma(user: unknown): PrismaService {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      findFirst: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue(user),
    },
    session: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService
}
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test`
Expected: FAIL — `recoverVault` is not defined.

- [ ] **Step 3: Implement `recoverVault`**

Add to `apps/api/src/auth/auth.service.ts`, inside the `AuthService` class
(after `setUpVault`):

```ts
  /**
   * No session guard: this is how access is regained without one. The
   * server never sees the vault key or the recovery code — only
   * `recoveryAuthHash`, verified against the digest `setUpVault` stored,
   * the same timing-safe way `login` verifies `authHash` (see
   * `getDummyDigest` above: the expensive verify always runs, so response
   * latency cannot reveal whether a vault was ever set up).
   */
  async recoverVault(input: RecoverVaultInput): Promise<string> {
    const user = await this.prisma.user.findFirst()

    const valid = await argon2Verify({
      password: Buffer.from(input.recoveryAuthHash, 'base64'),
      hash: user?.vaultRecoveryAuthDigest ?? (await getDummyDigest()),
    })

    if (!user || !user.vaultRecoveryAuthDigest || !valid) {
      throw new AppError('vault.invalid_recovery_code', {}, 401)
    }

    const authHashDigest = await argon2id({
      password: Buffer.from(input.authHash, 'base64'),
      salt: randomBytes(16),
      ...SERVER_HASH_PARAMS,
      outputType: 'encoded',
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        kdfSalt: Buffer.from(input.kdfSalt, 'base64'),
        authHashDigest,
        vaultProtectedKey: Buffer.from(input.protectedVaultKey, 'base64'),
      },
    })

    return this.createSession(user.id)
  }
```

Add `RecoverVaultInput` to the file's `import type { BootstrapInput, LoginInput, SetUpVaultInput }` line.

- [ ] **Step 4: Add `getRecoveryEnvelope`**

The recovery UI (Task 14) needs the wrapped `recoveryVaultKey` blob itself to
attempt an unwrap with the recovery code — and it has no session yet, that
being the entire point of recovery. This mirrors `/auth/kdf`, Phase 0's other
deliberately unauthenticated read: exposing a wrapped blob to an unauthenticated
caller is safe under this design (section 9.5's threat model already assumes
full database access), and the wrap is only useful with the 128-bit code.

Add to `apps/api/src/auth/auth.service.ts` (after `getVaultEnvelope`):

```ts
  async getRecoveryEnvelope(): Promise<{ recoveryVaultKey: string | null }> {
    const user = await this.prisma.user.findFirst()

    return {
      recoveryVaultKey: user?.vaultRecoveryKey ? Buffer.from(user.vaultRecoveryKey).toString('base64') : null,
    }
  }
```

- [ ] **Step 5: Add the routes**

Add to `apps/api/src/auth/auth.controller.ts` (after `setUpVault`):

```ts
  @Get('vault-recovery-envelope')
  recoveryEnvelope() {
    return this.auth.getRecoveryEnvelope()
  }

  @Post('vault-recover')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(recoverVaultSchema))
  async recoverVault(@Body() body: RecoverVaultInput, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.setSessionCookie(response, await this.auth.recoverVault(body))
  }
```

Add `recoverVaultSchema` and `RecoverVaultInput` to the file's existing
`@ledger-hq/domain` import lines. Note `recoveryEnvelope` carries no
`@UseGuards(SessionGuard)` — deliberately, unlike every other route in this
controller except `bootstrap-required`, `kdf`, `bootstrap` and `login`.

- [ ] **Step 6: Add an integration test for the unauthenticated envelope read**

Add to `apps/api/test/vault.integration.test.ts`:

```ts
it('serves the wrapped recovery key without a session', async () => {
  await post('/api/v1/auth/vault-setup', {
    protectedVaultKey: 'AAAA',
    recoveryVaultKey: 'BBBB',
    recoveryAuthHash: 'CCCC',
  }).expect(204)

  const response = await request(app.getHttpServer()).get('/api/v1/auth/vault-recovery-envelope').expect(200)
  expect(response.body).toEqual({ recoveryVaultKey: 'BBBB' })
})
```

- [ ] **Step 7: Run the unit tests, confirm they pass**

Run: `pnpm --filter @ledger-hq/api test`
Expected: PASS.

- [ ] **Step 8: Write the integration test for the full recovery round trip**

Add to `apps/api/test/vault.integration.test.ts`:

Every field the Zod schema validates here must actually be base64
(`base64Schema` requires `[A-Za-z0-9+/]+={0,2}`) — plain words like
`'AAAA'` happen to pass (they are valid base64 characters), but a
hyphenated stand-in like `'the-real-recovery-hash'` would not. The literals
below are chosen to read clearly while staying valid: `'dGhlLXJlYWwtcmVjb3ZlcnktaGFzaA=='`
is the base64 encoding of the ASCII string `"the-real-recovery-hash"`, and
`'TkVXLVNBTFQ='` / `'TkVXLUFVVEgtSEFTSA=='` / `'TkVXLVBST1RFQ1RFRC1LRVk='`
are the base64 encodings of `"NEW-SALT"` / `"NEW-AUTH-HASH"` /
`"NEW-PROTECTED-KEY"` respectively — so a failing assertion still reads as
a recognisable label, not opaque noise.

```ts
describe('vault recovery', () => {
  it('rejects an unknown recovery hash', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/vault-recover')
      .set('X-Requested-With', 'ledger-hq')
      .send({ recoveryAuthHash: 'AAAA', kdfSalt: 'BBBB', authHash: 'CCCC', protectedVaultKey: 'DDDD' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('vault.invalid_recovery_code')
  })

  it('resets login credentials and returns a session when the recovery hash matches', async () => {
    await post('/api/v1/auth/vault-setup', {
      protectedVaultKey: 'AAAA',
      recoveryVaultKey: 'BBBB',
      recoveryAuthHash: 'dGhlLXJlYWwtcmVjb3ZlcnktaGFzaA==',
    }).expect(204)

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/vault-recover')
      .set('X-Requested-With', 'ledger-hq')
      .send({
        recoveryAuthHash: 'dGhlLXJlYWwtcmVjb3ZlcnktaGFzaA==',
        kdfSalt: 'TkVXLVNBTFQ=',
        authHash: 'TkVXLUFVVEgtSEFTSA==',
        protectedVaultKey: 'TkVXLVBST1RFQ1RFRC1LRVk=',
      })

    expect(response.status).toBe(200)
    expect(response.headers['set-cookie']).toBeDefined()

    const envelope = await request(app.getHttpServer())
      .get('/api/v1/auth/vault-envelope')
      .set('Cookie', response.headers['set-cookie'] as unknown as string[])
      .expect(200)
    expect(envelope.body.protectedVaultKey).toBe('TkVXLVBST1RFQ1RFRC1LRVk=')
  })
})
```

- [ ] **Step 9: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS, all new cases green.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts \
  apps/api/src/auth/auth.service.test.ts apps/api/test/vault.integration.test.ts
git commit -m "feat(api): add recovery-code account reset with timing-safe verification"
```

---
### Task 7: Platforms module

**Files:**
- Create: `apps/api/src/vault/platforms.service.ts`
- Create: `apps/api/src/vault/platforms.controller.ts`
- Test: `apps/api/test/platforms.integration.test.ts`

**Interfaces:**
- Consumes: `createPlatformSchema`, `updatePlatformSchema`, `CreatePlatformInput`, `UpdatePlatformInput` (Task 3); `PrismaService`, `ZodValidationPipe`, `SessionGuard` (Phase 0).
- Produces (consumed by Task 9, which wires this into `VaultModule`, and by Task 8's `CredentialsService`, which needs `PlatformsService.findOne` to validate a credential's `platformId`):
  - `PlatformsService.create/list/findOne/update`
  - `GET /platforms`, `POST /platforms`, `PATCH /platforms/:id`

- [ ] **Step 1: Write the integration tests**

`apps/api/test/platforms.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

function post(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

describe('platforms', () => {
  it('creates and lists a platform', async () => {
    await post('/api/v1/platforms', { name: 'Portal das Finanças', authKind: 'PASSWORD' }).expect(201)

    const response = await request(app.getHttpServer()).get('/api/v1/platforms').set('Cookie', cookie).expect(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].name).toBe('Portal das Finanças')
  })

  it('rejects a duplicate name', async () => {
    await post('/api/v1/platforms', { name: 'X', authKind: 'PASSWORD' }).expect(201)
    const response = await post('/api/v1/platforms', { name: 'X', authKind: 'PASSWORD' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('platforms.name_taken')
  })

  it('updates a platform', async () => {
    const created = await post('/api/v1/platforms', { name: 'X', authKind: 'PASSWORD' }).expect(201)

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/platforms/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ authKind: 'PASSWORD_OTP' })
      .expect(200)

    expect(response.body.authKind).toBe('PASSWORD_OTP')
  })

  it('404s on an unknown id', async () => {
    await request(app.getHttpServer()).get('/api/v1/platforms/00000000-0000-7000-8000-000000000099').set('Cookie', cookie).expect(404)
  })
})
```

Note: this file expects a `GET /platforms/:id` route too (the 404 test above) —
add it in Step 3 below alongside the other three.

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: FAIL — `/platforms` does not exist.

- [ ] **Step 3: Implement the service**

`apps/api/src/vault/platforms.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { Platform } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreatePlatformInput, UpdatePlatformInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'

@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePlatformInput): Promise<Platform> {
    try {
      return await this.prisma.platform.create({
        data: { id: uuidv7(), name: input.name, url: input.url ?? null, authKind: input.authKind },
      })
    } catch (error) {
      throw toNameConflictOr(error, input.name)
    }
  }

  list(): Promise<Platform[]> {
    return this.prisma.platform.findMany({ orderBy: { name: 'asc' } })
  }

  async findOne(id: string): Promise<Platform> {
    const platform = await this.prisma.platform.findUnique({ where: { id } })
    if (!platform) throw new AppError('common.not_found', {}, 404)
    return platform
  }

  async update(id: string, input: UpdatePlatformInput): Promise<Platform> {
    await this.findOne(id)

    try {
      return await this.prisma.platform.update({ where: { id }, data: input })
    } catch (error) {
      throw toNameConflictOr(error, input.name ?? '')
    }
  }
}

/**
 * Same check-then-act-plus-catch shape as `clients.service.ts`'s
 * `toTaxIdConflictOr`: the friendly path (no check here, since none was
 * needed before this task) is really just this catch, turning the
 * database's own unique-constraint violation into the specific domain
 * error instead of an opaque 500.
 */
function toNameConflictOr(error: unknown, name: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && targetsName(error.meta)) {
    return new AppError('platforms.name_taken', { name }, 409)
  }
  return error
}

function targetsName(meta: Record<string, unknown> | undefined): boolean {
  const target = meta?.target
  if (Array.isArray(target)) return target.includes('name')
  return typeof target === 'string' && target.includes('name')
}
```

- [ ] **Step 4: Implement the controller**

`apps/api/src/vault/platforms.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common'
import { createPlatformSchema, updatePlatformSchema } from '@ledger-hq/domain'
import type { CreatePlatformInput, UpdatePlatformInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PlatformsService } from './platforms.service.js'

@Controller('platforms')
@UseGuards(SessionGuard)
export class PlatformsController {
  constructor(private readonly platforms: PlatformsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createPlatformSchema))
  create(@Body() body: CreatePlatformInput) {
    return this.platforms.create(body)
  }

  @Get()
  list() {
    return this.platforms.list()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.platforms.findOne(id)
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updatePlatformSchema))
  update(@Param('id') id: string, @Body() body: UpdatePlatformInput) {
    return this.platforms.update(id, body)
  }
}
```

- [ ] **Step 5: Run it, confirm it still fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: still FAIL — `PlatformsController`/`PlatformsService` are not
registered in any module yet (Task 9 wires them in). Confirm the failure mode
is a 404 from Nest's fallback, not a compile error, then move on: this task's
own review scope is the service and controller logic, verified in isolation
by Task 9 once wiring lands.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ledger-hq/api typecheck`
Expected: clean (this only checks types, not module wiring).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/vault/platforms.service.ts apps/api/src/vault/platforms.controller.ts \
  apps/api/test/platforms.integration.test.ts
git commit -m "feat(api): add the platform catalog service and controller"
```

---
### Task 8: Credentials module

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts` (add `assertVaultSetUp`)
- Modify: `packages/domain/src/schemas/credential.ts`, `credential.test.ts` (add the sync query schema)
- Create: `apps/api/src/vault/credentials.service.ts`
- Create: `apps/api/src/vault/credentials.controller.ts`
- Test: `apps/api/test/credentials.integration.test.ts`

**Interfaces:**
- Consumes: `PlatformsService.findOne` (Task 7); `ClientsService.findOne` (Phase 0); `AuthService.assertVaultSetUp` (new, this task); `createCredentialSchema`, `rotateCredentialSchema` (Task 3).
- Produces (consumed by Task 9 and by `apps/web`):
  - `CredentialsService.create/rotate/findOne/listForClient/listVersions/sync`
  - `POST /credentials`, `GET /clients/:clientId/credentials`, `POST /credentials/:id/rotate`, `GET /credentials/:id/versions`, `GET /vault/sync`

- [ ] **Step 1: Add the sync query schema**

`vault.not_set_up` (Task 3) has no caller yet — this task is what uses it, via
a new `AuthService.assertVaultSetUp` guard shared by every credential-mutating
call, so a client that skips vault setup and posts a credential directly gets
a specific error instead of silently orphaned ciphertext no envelope can ever
unwrap.

Add to `packages/domain/src/schemas/credential.ts` (after `rotateCredentialSchema`):

```ts
/**
 * `since` as a strict UTC ISO-8601 instant, matching how `updatedAt` columns
 * serialise. A plain regex rather than a datetime-format keyword, to stay on
 * the validation style already used for `isoDateSchema` in `./common`.
 */
export const syncCredentialsQuerySchema = z
  .object({
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
      .optional(),
  })
  .strict()

export type SyncCredentialsQuery = z.infer<typeof syncCredentialsQuerySchema>
```

Add a test to `credential.test.ts`:

```ts
describe('syncCredentialsQuerySchema', () => {
  it('accepts an absent since', () => {
    expect(syncCredentialsQuerySchema.safeParse({}).success).toBe(true)
  })

  it('accepts a valid UTC instant', () => {
    expect(syncCredentialsQuerySchema.safeParse({ since: '2026-09-10T12:00:00.000Z' }).success).toBe(true)
  })

  it('rejects a bare date', () => {
    expect(syncCredentialsQuerySchema.safeParse({ since: '2026-09-10' }).success).toBe(false)
  })
})
```

(Add `syncCredentialsQuerySchema` to the test file's import from `./credential`.)

Run: `pnpm --filter @ledger-hq/domain test` — expect PASS.

- [ ] **Step 2: Add `assertVaultSetUp` to `AuthService`**

Add to `apps/api/src/auth/auth.service.ts` (after `getVaultEnvelope`):

```ts
  async assertVaultSetUp(): Promise<void> {
    const user = await this.prisma.user.findFirst()
    if (!user || user.vaultSetUpAt === null) throw new AppError('vault.not_set_up', {}, 409)
  }
```

- [ ] **Step 3: Write the integration tests**

`apps/api/test/credentials.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

function post(path: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

async function setUpVault() {
  await post('/api/v1/auth/vault-setup', {
    protectedVaultKey: 'AAAA',
    recoveryVaultKey: 'BBBB',
    recoveryAuthHash: 'CCCC',
  }).expect(204)
}

async function createClient() {
  const response = await post('/api/v1/clients', {
    kind: 'COMPANY',
    name: 'Padaria Central, Lda.',
    taxId: '501442600',
    accounting: 'ORGANIZED',
    legalForm: 'LDA',
  }).expect(201)
  return response.body.id as string
}

async function createPlatform() {
  const response = await post('/api/v1/platforms', { name: 'Portal das Finanças', authKind: 'PASSWORD' }).expect(201)
  return response.body.id as string
}

describe('credentials', () => {
  it('refuses to create a credential before the vault is set up', async () => {
    const clientId = await createClient()
    const platformId = await createPlatform()

    const response = await post('/api/v1/credentials', { clientId, platformId, label: 'x', ciphertext: 'AAAA', iv: 'AAAA' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('vault.not_set_up')
  })

  it('creates a credential and lists it for the client', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()

    await post('/api/v1/credentials', { clientId, platformId, label: 'Acesso principal', ciphertext: 'AAAA', iv: 'BBBB' }).expect(201)

    const response = await request(app.getHttpServer())
      .get(`/api/v1/clients/${clientId}/credentials`)
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ label: 'Acesso principal', ciphertext: 'AAAA', iv: 'BBBB' })
  })

  it('rejects a duplicate label for the same client and platform', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()
    const payload = { clientId, platformId, label: 'x', ciphertext: 'AAAA', iv: 'AAAA' }

    await post('/api/v1/credentials', payload).expect(201)
    const response = await post('/api/v1/credentials', payload)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('credentials.label_taken')
  })

  it('rotates a credential and keeps the previous version in history', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()

    const created = await post('/api/v1/credentials', { clientId, platformId, label: 'x', ciphertext: 'AAAA', iv: 'AAAA' }).expect(201)

    await post(`/api/v1/credentials/${created.body.id}/rotate`, { ciphertext: 'ZZZZ', iv: 'YYYY' }).expect(201)

    const versions = await request(app.getHttpServer())
      .get(`/api/v1/credentials/${created.body.id}/versions`)
      .set('Cookie', cookie)
      .expect(200)
    expect(versions.body).toHaveLength(2)
    expect(versions.body[0].ciphertext).toBe('ZZZZ')
    expect(versions.body[1].ciphertext).toBe('AAAA')
  })

  it('syncs only credentials updated after the given cursor', async () => {
    await setUpVault()
    const clientId = await createClient()
    const platformId = await createPlatform()
    await post('/api/v1/credentials', { clientId, platformId, label: 'old', ciphertext: 'AAAA', iv: 'AAAA' }).expect(201)

    const cursor = new Date().toISOString()
    await post('/api/v1/credentials', { clientId, platformId, label: 'new', ciphertext: 'BBBB', iv: 'BBBB' }).expect(201)

    const response = await request(app.getHttpServer())
      .get(`/api/v1/vault/sync?since=${encodeURIComponent(cursor)}`)
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body).toHaveLength(1)
    expect(response.body[0].label).toBe('new')
  })
})
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: FAIL — none of the credential routes exist yet.

- [ ] **Step 5: Implement the service**

`apps/api/src/vault/credentials.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { Credential, CredentialVersion } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreateCredentialInput, RotateCredentialInput } from '@ledger-hq/domain'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PrismaService } from '../common/prisma.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { ClientsService } from '../clients/clients.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuthService } from '../auth/auth.service.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { PlatformsService } from './platforms.service.js'

export type CredentialWithVersions = Credential & { versions: CredentialVersion[] }

const LATEST_VERSION = { versions: { orderBy: { createdAt: 'desc' as const }, take: 1 } }

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly platforms: PlatformsService,
    private readonly auth: AuthService,
  ) {}

  async create(input: CreateCredentialInput): Promise<CredentialWithVersions> {
    await this.auth.assertVaultSetUp()
    await this.clients.findOne(input.clientId)
    await this.platforms.findOne(input.platformId)

    try {
      return await this.prisma.credential.create({
        data: {
          id: uuidv7(),
          clientId: input.clientId,
          platformId: input.platformId,
          label: input.label,
          versions: {
            create: {
              id: uuidv7(),
              ciphertext: Buffer.from(input.ciphertext, 'base64'),
              iv: Buffer.from(input.iv, 'base64'),
            },
          },
        },
        include: LATEST_VERSION,
      })
    } catch (error) {
      throw toLabelConflictOr(error, input.label)
    }
  }

  async rotate(id: string, input: RotateCredentialInput): Promise<CredentialWithVersions> {
    await this.findOne(id)

    // `updatedAt` is set explicitly rather than relied on implicitly: the
    // only scalar field on `Credential` in this write is the timestamp
    // itself, so an unambiguous, explicit value is clearer than depending on
    // Prisma's `@updatedAt` auto-touch behaviour for a nested-only write.
    return this.prisma.credential.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        versions: {
          create: {
            id: uuidv7(),
            ciphertext: Buffer.from(input.ciphertext, 'base64'),
            iv: Buffer.from(input.iv, 'base64'),
          },
        },
      },
      include: LATEST_VERSION,
    })
  }

  async findOne(id: string): Promise<CredentialWithVersions> {
    const credential = await this.prisma.credential.findUnique({ where: { id }, include: LATEST_VERSION })
    if (!credential) throw new AppError('common.not_found', {}, 404)
    return credential
  }

  async listForClient(clientId: string): Promise<CredentialWithVersions[]> {
    await this.clients.findOne(clientId)
    return this.prisma.credential.findMany({ where: { clientId }, include: LATEST_VERSION, orderBy: { label: 'asc' } })
  }

  async listVersions(id: string): Promise<CredentialVersion[]> {
    await this.findOne(id)
    return this.prisma.credentialVersion.findMany({ where: { credentialId: id }, orderBy: { createdAt: 'desc' } })
  }

  sync(since: Date | null): Promise<CredentialWithVersions[]> {
    return this.prisma.credential.findMany({
      where: since ? { updatedAt: { gt: since } } : {},
      include: LATEST_VERSION,
      orderBy: { updatedAt: 'asc' },
    })
  }
}

/**
 * `Credential` carries exactly one unique constraint (`[clientId, platformId,
 * label]`), unlike `Client.taxId`, which shares its table with no other
 * unique column — so, unlike `clients.service.ts`'s `targetsTaxId`, no
 * target-column check is needed to know which constraint fired.
 */
function toLabelConflictOr(error: unknown, label: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new AppError('credentials.label_taken', { label }, 409)
  }
  return error
}
```

- [ ] **Step 6: Implement the controller**

`apps/api/src/vault/credentials.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common'
import { createCredentialSchema, rotateCredentialSchema, syncCredentialsQuerySchema } from '@ledger-hq/domain'
import type { CreateCredentialInput, RotateCredentialInput, SyncCredentialsQuery } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { CredentialsService } from './credentials.service.js'
import type { CredentialWithVersions } from './credentials.service.js'
import type { CredentialVersion } from '../generated/prisma/client.js'

type CredentialResponse = {
  id: string
  clientId: string
  platformId: string
  label: string
  updatedAt: string
  ciphertext: string
  iv: string
}

type VersionResponse = { id: string; createdAt: string; ciphertext: string; iv: string }

function toResponse(credential: CredentialWithVersions): CredentialResponse {
  const latest = credential.versions[0]
  return {
    id: credential.id,
    clientId: credential.clientId,
    platformId: credential.platformId,
    label: credential.label,
    updatedAt: credential.updatedAt.toISOString(),
    ciphertext: Buffer.from(latest.ciphertext).toString('base64'),
    iv: Buffer.from(latest.iv).toString('base64'),
  }
}

function toVersionResponse(version: CredentialVersion): VersionResponse {
  return {
    id: version.id,
    createdAt: version.createdAt.toISOString(),
    ciphertext: Buffer.from(version.ciphertext).toString('base64'),
    iv: Buffer.from(version.iv).toString('base64'),
  }
}

@Controller()
@UseGuards(SessionGuard)
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Post('credentials')
  async create(@Body(new ZodValidationPipe(createCredentialSchema)) body: CreateCredentialInput): Promise<CredentialResponse> {
    return toResponse(await this.credentials.create(body))
  }

  @Get('clients/:clientId/credentials')
  async listForClient(@Param('clientId') clientId: string): Promise<CredentialResponse[]> {
    return (await this.credentials.listForClient(clientId)).map(toResponse)
  }

  @Post('credentials/:id/rotate')
  async rotate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rotateCredentialSchema)) body: RotateCredentialInput,
  ): Promise<CredentialResponse> {
    return toResponse(await this.credentials.rotate(id, body))
  }

  @Get('credentials/:id/versions')
  async listVersions(@Param('id') id: string): Promise<VersionResponse[]> {
    return (await this.credentials.listVersions(id)).map(toVersionResponse)
  }

  @Get('vault/sync')
  @UsePipes(new ZodValidationPipe(syncCredentialsQuerySchema))
  async sync(@Query() query: SyncCredentialsQuery): Promise<CredentialResponse[]> {
    return (await this.credentials.sync(query.since ? new Date(query.since) : null)).map(toResponse)
  }
}
```

- [ ] **Step 7: Run it, confirm it still fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: still FAIL — nothing is registered in a module yet (Task 9). Confirm
the failure is routing 404s, and move on: Task 9 wires this in and is where
this test file is expected to turn green.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @ledger-hq/api typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/auth/auth.service.ts packages/domain/src/schemas/credential.ts packages/domain/src/schemas/credential.test.ts \
  apps/api/src/vault/credentials.service.ts apps/api/src/vault/credentials.controller.ts \
  apps/api/test/credentials.integration.test.ts
git commit -m "feat(api): add credential storage, rotation history and cursor sync"
```

---
### Task 9: Wire the vault module and translate its error codes

**Files:**
- Create: `apps/api/src/vault/vault.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/web/src/i18n/locales/pt/errors.json`, `apps/web/src/i18n/locales/en/errors.json`

**Interfaces:**
- Consumes: `PlatformsController/Service` (Task 7), `CredentialsController/Service` (Task 8), `AuthModule`, `ClientsModule` (Phase 0).
- Produces: a registered `VaultModule` — this is the task that turns Tasks 7 and 8's integration tests from 404s into passes.

- [ ] **Step 1: Create the module**

`apps/api/src/vault/vault.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ClientsModule } from '../clients/clients.module.js'
import { PrismaService } from '../common/prisma.service.js'
import { PlatformsController } from './platforms.controller.js'
import { PlatformsService } from './platforms.service.js'
import { CredentialsController } from './credentials.controller.js'
import { CredentialsService } from './credentials.service.js'

@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [PlatformsController, CredentialsController],
  providers: [PlatformsService, CredentialsService, PrismaService],
})
export class VaultModule {}
```

- [ ] **Step 2: Register it in `AppModule`**

Add to `apps/api/src/app.module.ts`'s imports (after `EmploymentsModule`) and
its own import line:

```ts
import { VaultModule } from './vault/vault.module.js'
```

```ts
    EmploymentsModule,
    VaultModule,
    SystemModule,
```

- [ ] **Step 3: Run every integration test file touched so far**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS — `vault.integration.test.ts`, `platforms.integration.test.ts`
and `credentials.integration.test.ts` all green now that the routes resolve.

- [ ] **Step 4: Translate the five new error codes**

Add to `apps/web/src/i18n/locales/pt/errors.json` (new top-level keys,
alongside the existing `clients`/`fiscal_profile`/`employment` blocks):

```json
  "vault": {
    "not_set_up": "O cofre ainda não foi configurado.",
    "already_set_up": "O cofre já está configurado.",
    "invalid_recovery_code": "Código de recuperação inválido."
  },
  "platforms": {
    "name_taken": "Já existe uma plataforma com o nome {{name}}."
  },
  "credentials": {
    "label_taken": "Já existe uma credencial com a designação {{label}} para esta plataforma."
  }
```

Add the equivalent to `apps/web/src/i18n/locales/en/errors.json`:

```json
  "vault": {
    "not_set_up": "The vault has not been set up yet.",
    "already_set_up": "The vault is already set up.",
    "invalid_recovery_code": "Invalid recovery code."
  },
  "platforms": {
    "name_taken": "A platform named {{name}} already exists."
  },
  "credentials": {
    "label_taken": "A credential named {{label}} already exists for this platform."
  }
```

- [ ] **Step 5: Verify locale parity**

Run: `pnpm --filter @ledger-hq/web i18n:check`
Expected: `Locale bundles agree on <N> keys.`

- [ ] **Step 6: Run the full monorepo check**

Run: `pnpm turbo run lint typecheck build test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/vault/vault.module.ts apps/api/src/app.module.ts \
  apps/web/src/i18n/locales/pt/errors.json apps/web/src/i18n/locales/en/errors.json
git commit -m "feat(api): wire the vault module into the app"
```

---
### Task 10: In-memory vault session with auto-lock

**Files:**
- Create: `apps/web/src/vault/vault-session.ts`
- Create: `apps/web/src/vault/vault-session.test.ts`

**Interfaces:**
- Consumes: nothing from earlier web tasks.
- Produces (consumed by Tasks 12, 13, 16):
  - `unlockVault(key: CryptoKey): void`
  - `lockVault(): void`
  - `getVaultState(): VaultState`
  - `subscribeVaultState(listener: () => void): () => void`
  - `useVaultState(): VaultState` (a React hook over the above)
  - `VaultState = { status: 'locked' } | { status: 'unlocked'; key: CryptoKey; unlockedAt: number }`

This is a plain module-level singleton, not a React context: the vault key
must be reachable from non-component code too (the sync module in Task 17
needs to read it to decrypt nothing — it never decrypts — but future direct
API helpers might; keeping it outside React avoids a provider that half the
app tree would need to pass through for no reason, matching how
`useOnlineStatus` and `apiFetch` are already free functions, not context).

- [ ] **Step 1: Write the state-machine and auto-lock tests**

`apps/web/src/vault/vault-session.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVaultState, lockVault, noteActivity, unlockVault } from './vault-session'

function fakeKey(): CryptoKey {
  return { type: 'secret' } as CryptoKey
}

describe('vault-session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    lockVault()
  })

  afterEach(() => {
    lockVault()
    vi.useRealTimers()
  })

  it('starts locked', () => {
    expect(getVaultState()).toEqual({ status: 'locked' })
  })

  it('unlocks with the given key', () => {
    const key = fakeKey()
    unlockVault(key)
    expect(getVaultState()).toMatchObject({ status: 'unlocked', key })
  })

  it('locks explicitly', () => {
    unlockVault(fakeKey())
    lockVault()
    expect(getVaultState()).toEqual({ status: 'locked' })
  })

  it('auto-locks after 5 minutes of inactivity', () => {
    unlockVault(fakeKey())
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(getVaultState()).toEqual({ status: 'locked' })
  })

  it('does not auto-lock before 5 minutes', () => {
    unlockVault(fakeKey())
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(getVaultState().status).toBe('unlocked')
  })

  it('resets the inactivity window on noteActivity', () => {
    unlockVault(fakeKey())
    vi.advanceTimersByTime(4 * 60 * 1000)
    noteActivity()
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(getVaultState().status).toBe('unlocked')
    vi.advanceTimersByTime(60 * 1000 + 1)
    expect(getVaultState()).toEqual({ status: 'locked' })
  })

  it('notifies subscribers on lock and unlock', () => {
    const listener = vi.fn()
    const unsubscribe = (require('./vault-session') as typeof import('./vault-session')).subscribeVaultState(listener)
    unlockVault(fakeKey())
    lockVault()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- vault-session`
Expected: FAIL — `./vault-session` does not exist.

- [ ] **Step 3: Implement the store**

`apps/web/src/vault/vault-session.ts`:

```ts
import { useSyncExternalStore } from 'react'

export type VaultState = { status: 'locked' } | { status: 'unlocked'; key: CryptoKey; unlockedAt: number }

const INACTIVITY_LOCK_MS = 5 * 60 * 1000

let state: VaultState = { status: 'locked' }
const listeners = new Set<() => void>()
let inactivityTimer: ReturnType<typeof setTimeout> | undefined

function notify(): void {
  for (const listener of listeners) listener()
}

export function getVaultState(): VaultState {
  return state
}

export function subscribeVaultState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVaultState(): VaultState {
  return useSyncExternalStore(subscribeVaultState, getVaultState)
}

function resetInactivityTimer(): void {
  if (inactivityTimer) clearTimeout(inactivityTimer)
  inactivityTimer = setTimeout(lockVault, INACTIVITY_LOCK_MS)
}

export function unlockVault(key: CryptoKey): void {
  state = { status: 'unlocked', key, unlockedAt: Date.now() }
  resetInactivityTimer()
  notify()
}

export function lockVault(): void {
  state = { status: 'locked' }
  if (inactivityTimer) clearTimeout(inactivityTimer)
  notify()
}

/** Called on user interaction and on the tab becoming visible again. */
export function noteActivity(): void {
  if (state.status === 'unlocked') resetInactivityTimer()
}

if (typeof window !== 'undefined') {
  for (const eventName of ['pointerdown', 'keydown']) {
    window.addEventListener(eventName, noteActivity, { passive: true })
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) noteActivity()
  })
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault-session`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/vault/vault-session.ts apps/web/src/vault/vault-session.test.ts
git commit -m "feat(web): add the in-memory vault key store with inactivity auto-lock"
```

---
### Task 11: Offline IndexedDB cache

**Files:**
- Modify: `apps/web/package.json` (add `idb`, dev-add `fake-indexeddb`)
- Create: `apps/web/src/vault/vault-db.ts`
- Create: `apps/web/src/vault/vault-db.test.ts`

**Interfaces:**
- Consumes: nothing from earlier web tasks.
- Produces (consumed by Tasks 13, 16, 17):
  - `putVaultMeta`, `getVaultMeta`, `VaultMetaRecord`
  - `putCachedCredentials`, `listCachedCredentials`, `CachedCredential`
  - `putCachedPlatforms`, `listCachedPlatforms`, `CachedPlatform`

- [ ] **Step 1: Add the dependencies**

Add to `apps/web/package.json`'s `dependencies`: `"idb": "^8.0.3"`. Add to
`devDependencies`: `"fake-indexeddb": "^6.2.5"` (a jsdom-compatible in-memory
IndexedDB, needed only for tests — jsdom itself does not implement
IndexedDB). Run `pnpm install` after editing.

- [ ] **Step 2: Write the cache and the "no plaintext" guard tests**

`apps/web/src/vault/vault-db.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getVaultMeta,
  listCachedCredentials,
  listCachedPlatforms,
  putCachedCredentials,
  putCachedPlatforms,
  putVaultMeta,
} from './vault-db'
import type { CachedCredential } from './vault-db'

const credential: CachedCredential = {
  id: 'c1',
  clientId: 'client1',
  platformId: 'p1',
  label: 'Acesso principal',
  updatedAt: '2026-09-10T00:00:00.000Z',
  ciphertext: 'AAAA',
  iv: 'BBBB',
}

beforeEach(async () => {
  indexedDB.deleteDatabase('ledger-hq-vault')
})

describe('vault-db', () => {
  it('round-trips vault metadata', async () => {
    await putVaultMeta({ id: 'singleton', kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', lastSyncedAt: null })
    await expect(getVaultMeta()).resolves.toEqual({
      id: 'singleton',
      kdfSalt: 'AAAA',
      protectedVaultKey: 'BBBB',
      lastSyncedAt: null,
    })
  })

  it('round-trips cached credentials, listed by client', async () => {
    await putCachedCredentials([credential])
    await expect(listCachedCredentials('client1')).resolves.toEqual([credential])
    await expect(listCachedCredentials('someone-else')).resolves.toEqual([])
  })

  it('round-trips cached platforms', async () => {
    await putCachedPlatforms([{ id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' }])
    await expect(listCachedPlatforms()).resolves.toEqual([
      { id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' },
    ])
  })

  it('refuses to cache a credential carrying an extra field', async () => {
    const contaminated = { ...credential, password: 'hunter2' } as unknown as CachedCredential
    await expect(putCachedCredentials([contaminated])).rejects.toThrow(/unexpected fields/)
  })

  it('refuses to cache a credential missing a required field', async () => {
    const { iv: _iv, ...incomplete } = credential
    await expect(putCachedCredentials([incomplete as CachedCredential])).rejects.toThrow(/unexpected fields/)
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- vault-db`
Expected: FAIL — `./vault-db` does not exist.

- [ ] **Step 4: Implement the cache**

`apps/web/src/vault/vault-db.ts`:

```ts
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

interface VaultSchema extends DBSchema {
  vaultMeta: { key: string; value: VaultMetaRecord }
  credentials: { key: string; value: CachedCredential; indexes: { byClient: string } }
  platforms: { key: string; value: CachedPlatform }
}

export type VaultMetaRecord = {
  id: 'singleton'
  kdfSalt: string
  protectedVaultKey: string
  lastSyncedAt: string | null
}

export type CachedCredential = {
  id: string
  clientId: string
  platformId: string
  label: string
  updatedAt: string
  ciphertext: string
  iv: string
}

export type CachedPlatform = { id: string; name: string; url: string | null; authKind: string }

const CACHED_CREDENTIAL_KEYS = ['id', 'clientId', 'platformId', 'label', 'updatedAt', 'ciphertext', 'iv']

let dbPromise: Promise<IDBPDatabase<VaultSchema>> | undefined

function getDb(): Promise<IDBPDatabase<VaultSchema>> {
  dbPromise ??= openDB<VaultSchema>('ledger-hq-vault', 1, {
    upgrade(db) {
      db.createObjectStore('vaultMeta', { keyPath: 'id' })
      const credentials = db.createObjectStore('credentials', { keyPath: 'id' })
      credentials.createIndex('byClient', 'clientId')
      db.createObjectStore('platforms', { keyPath: 'id' })
    },
  })
  return dbPromise
}

export async function putVaultMeta(meta: VaultMetaRecord): Promise<void> {
  const db = await getDb()
  await db.put('vaultMeta', meta)
}

export async function getVaultMeta(): Promise<VaultMetaRecord | undefined> {
  const db = await getDb()
  return db.get('vaultMeta', 'singleton')
}

/**
 * The only write path for cached credentials. Every item's shape is checked
 * against the fixed safe field set before it reaches IndexedDB — a runtime
 * guard against a future caller accidentally spreading a decrypted item
 * (username, password, totpSecret, ...) into what must only ever hold
 * ciphertext plus metadata. Stronger than a spy-based test alone, since it
 * also protects production, not just the test suite.
 */
export async function putCachedCredentials(items: CachedCredential[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('credentials', 'readwrite')
  for (const item of items) {
    assertSafeCredentialShape(item)
    await tx.store.put(item)
  }
  await tx.done
}

function assertSafeCredentialShape(item: CachedCredential): void {
  const keys = Object.keys(item).sort()
  const expected = [...CACHED_CREDENTIAL_KEYS].sort()
  const matches = keys.length === expected.length && keys.every((key, index) => key === expected[index])
  if (!matches) throw new Error(`refusing to cache a credential with unexpected fields: ${keys.join(', ')}`)
}

export async function listCachedCredentials(clientId: string): Promise<CachedCredential[]> {
  const db = await getDb()
  return db.getAllFromIndex('credentials', 'byClient', clientId)
}

export async function putCachedPlatforms(items: CachedPlatform[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('platforms', 'readwrite')
  for (const item of items) await tx.store.put(item)
  await tx.done
}

export async function listCachedPlatforms(): Promise<CachedPlatform[]> {
  const db = await getDb()
  return db.getAll('platforms')
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault-db`
Expected: PASS, all 5 cases green.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/vault/vault-db.ts apps/web/src/vault/vault-db.test.ts
git commit -m "feat(web): add the IndexedDB offline cache with a runtime no-plaintext guard"
```

---
### Task 12: Vault API client and the setup flow

**Files:**
- Create: `apps/web/src/vault/api.ts`
- Create: `apps/web/src/vault/setup.ts`
- Create: `apps/web/src/vault/setup.test.ts`
- Create: `apps/web/src/vault/VaultSetupPage.tsx`
- Create: `apps/web/src/vault/VaultSetupPage.test.tsx`
- Modify: `apps/web/src/auth/SetupPage.tsx`
- Modify: `apps/web/src/router.tsx`
- Create: `apps/web/src/i18n/locales/pt/vault.json`, `apps/web/src/i18n/locales/en/vault.json`
- Modify: `apps/web/src/i18n/locales/pt/index.ts`, `apps/web/src/i18n/locales/en/index.ts`

**Interfaces:**
- Consumes: `apiFetch` (Phase 0); `deriveMasterKey`, `deriveStretchedKey`, `deriveAuthHash`, `generateVaultKey`, `generateRecoveryCode`, `deriveRecoveryWrappingKey`, `deriveRecoveryAuthHash`, `wrapVaultKey`, `importVaultSessionKey`, `toBase64`, `fromBase64` (Tasks 1-2); `unlockVault` (Task 10); `putVaultMeta` (Task 11).
- Produces (consumed by Tasks 13-17):
  - `apps/web/src/vault/api.ts`'s full set of thin API wrappers.
  - `setUpVault(email: string, masterPassword: string): Promise<{ recoveryCode: string }>`
  - `VaultSetupPage` at route `/vault/setup`.

**Why re-entering the master password here is unavoidable:** by the time a
user reaches this screen, `LoginPage`/`SetupPage` have already discarded the
master password (Phase 0, deliberately — it is never retained). Vault setup
needs the stretched key to wrap the vault key, so this screen collects the
master password again, verifies it with a real login call before generating
anything irreversible, and only then proceeds — a wrong password here, left
unverified, would wrap the vault key with a key nothing could ever unwrap
again.

- [ ] **Step 1: Write the vault API wrappers**

`apps/web/src/vault/api.ts`:

```ts
import type {
  CreateCredentialInput,
  CreatePlatformInput,
  RotateCredentialInput,
  UpdatePlatformInput,
} from '@ledger-hq/domain'
import { apiFetch } from '../api/client'

export type VaultEnvelopeResponse = { protectedVaultKey: string | null; setUpAt: string | null }

export const getVaultEnvelope = () => apiFetch<VaultEnvelopeResponse>('/auth/vault-envelope')

export type SetUpVaultRequest = { protectedVaultKey: string; recoveryVaultKey: string; recoveryAuthHash: string }

export const postVaultSetup = (input: SetUpVaultRequest) =>
  apiFetch<void>('/auth/vault-setup', { method: 'POST', body: input })

export type RecoverVaultRequest = {
  recoveryAuthHash: string
  kdfSalt: string
  authHash: string
  protectedVaultKey: string
}

export const postVaultRecover = (input: RecoverVaultRequest) =>
  apiFetch<void>('/auth/vault-recover', { method: 'POST', body: input })

export type PlatformResponse = {
  id: string
  name: string
  url: string | null
  authKind: 'PASSWORD' | 'PASSWORD_OTP' | 'CERTIFICATE'
}

export const listPlatforms = () => apiFetch<PlatformResponse[]>('/platforms')

export const createPlatform = (input: CreatePlatformInput) =>
  apiFetch<PlatformResponse>('/platforms', { method: 'POST', body: input })

export const updatePlatform = (id: string, input: UpdatePlatformInput) =>
  apiFetch<PlatformResponse>(`/platforms/${id}`, { method: 'PATCH', body: input })

export type CredentialResponse = {
  id: string
  clientId: string
  platformId: string
  label: string
  updatedAt: string
  ciphertext: string
  iv: string
}

export const createCredential = (input: CreateCredentialInput) =>
  apiFetch<CredentialResponse>('/credentials', { method: 'POST', body: input })

export const listCredentialsForClient = (clientId: string) =>
  apiFetch<CredentialResponse[]>(`/clients/${clientId}/credentials`)

export const rotateCredential = (id: string, input: RotateCredentialInput) =>
  apiFetch<CredentialResponse>(`/credentials/${id}/rotate`, { method: 'POST', body: input })

export type CredentialVersionResponse = { id: string; createdAt: string; ciphertext: string; iv: string }

export const listCredentialVersions = (id: string) =>
  apiFetch<CredentialVersionResponse[]>(`/credentials/${id}/versions`)

export const syncCredentials = (since: string | null) =>
  apiFetch<CredentialResponse[]>(`/vault/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`)
```

- [ ] **Step 2: Write the setup orchestration test**

`apps/web/src/vault/setup.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const postVaultSetupMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ postVaultSetup: postVaultSetupMock }))

const unlockVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-session', () => ({ unlockVault: unlockVaultMock }))

const putVaultMetaMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({ putVaultMeta: putVaultMetaMock }))

const { setUpVault } = await import('./setup')

describe('setUpVault', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    postVaultSetupMock.mockReset().mockResolvedValue(undefined)
    unlockVaultMock.mockReset()
    putVaultMetaMock.mockReset().mockResolvedValue(undefined)
  })

  it('fetches the salt, verifies the password by logging in, and stores the envelope', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/auth/kdf')) return Promise.resolve({ kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==' })
      if (path === '/auth/login') return Promise.resolve(undefined)
      throw new Error(`unexpected path ${path}`)
    })

    const result = await setUpVault('paulo@example.com', 'a long master password')

    expect(apiFetchMock).toHaveBeenCalledWith('/auth/login', expect.objectContaining({ method: 'POST' }))
    expect(postVaultSetupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        protectedVaultKey: expect.any(String),
        recoveryVaultKey: expect.any(String),
        recoveryAuthHash: expect.any(String),
      }),
    )
    expect(unlockVaultMock).toHaveBeenCalledTimes(1)
    expect(putVaultMetaMock).toHaveBeenCalledTimes(1)
    expect(result.recoveryCode).toMatch(/^[A-Z2-7-]+$/)
  })

  it('never calls postVaultSetup when the login verification rejects', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/auth/kdf')) return Promise.resolve({ kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==' })
      if (path === '/auth/login') return Promise.reject(new Error('invalid credentials'))
      throw new Error(`unexpected path ${path}`)
    })

    await expect(setUpVault('paulo@example.com', 'wrong password')).rejects.toThrow()
    expect(postVaultSetupMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- vault/setup`
Expected: FAIL — `./setup` does not exist.

- [ ] **Step 4: Implement the setup orchestration**

`apps/web/src/vault/setup.ts`:

```ts
import {
  deriveAuthHash,
  deriveMasterKey,
  deriveRecoveryAuthHash,
  deriveRecoveryWrappingKey,
  deriveStretchedKey,
  fromBase64,
  generateRecoveryCode,
  generateVaultKey,
  importVaultSessionKey,
  toBase64,
  wrapVaultKey,
} from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'
import { postVaultSetup } from './api'
import { putVaultMeta } from './vault-db'
import { unlockVault } from './vault-session'

type KdfResponse = { kdfSalt: string }

export async function setUpVault(email: string, masterPassword: string): Promise<{ recoveryCode: string }> {
  const { kdfSalt } = await apiFetch<KdfResponse>(`/auth/kdf?email=${encodeURIComponent(email)}`)
  const masterKey = await deriveMasterKey(masterPassword, fromBase64(kdfSalt))
  const authHash = toBase64(await deriveAuthHash(masterKey, masterPassword))

  // Verifies the re-typed master password before anything irreversible is
  // generated: a wrong password here would wrap the vault key with a key
  // nothing could ever unwrap again.
  await apiFetch('/auth/login', { method: 'POST', body: { email, authHash } })

  const stretched = await deriveStretchedKey(masterKey)
  const vaultKey = generateVaultKey()
  const recoveryCode = generateRecoveryCode()
  const recoveryWrappingKey = await deriveRecoveryWrappingKey(recoveryCode)

  const protectedVaultKey = await wrapVaultKey(vaultKey, stretched)
  const recoveryVaultKey = await wrapVaultKey(vaultKey, recoveryWrappingKey)
  const recoveryAuthHash = await deriveRecoveryAuthHash(vaultKey, recoveryCode)

  const protectedVaultKeyBase64 = toBase64(protectedVaultKey)

  await postVaultSetup({
    protectedVaultKey: protectedVaultKeyBase64,
    recoveryVaultKey: toBase64(recoveryVaultKey),
    recoveryAuthHash: toBase64(recoveryAuthHash),
  })

  unlockVault(await importVaultSessionKey(vaultKey))
  await putVaultMeta({ id: 'singleton', kdfSalt, protectedVaultKey: protectedVaultKeyBase64, lastSyncedAt: null })

  return { recoveryCode }
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault/setup`
Expected: PASS.

- [ ] **Step 6: Add the vault locale namespace**

`apps/web/src/i18n/locales/pt/vault.json`:

```json
{
  "setup": {
    "title": "Configura o cofre",
    "confirmPasswordLabel": "Confirma a tua palavra-passe mestra",
    "recoveryCodeIntro": "Este é o teu código de recuperação. É a única forma de recuperares o acesso se perderes a palavra-passe mestra.",
    "acknowledgeLabel": "Anotei o código de recuperação e guardei-o em local seguro.",
    "continueButton": "Continuar"
  }
}
```

`apps/web/src/i18n/locales/en/vault.json`:

```json
{
  "setup": {
    "title": "Set up the vault",
    "confirmPasswordLabel": "Confirm your master password",
    "recoveryCodeIntro": "This is your recovery code. It is the only way to regain access if you lose your master password.",
    "acknowledgeLabel": "I have written down the recovery code and stored it somewhere safe.",
    "continueButton": "Continue"
  }
}
```

Register the namespace in both locale index files:

`apps/web/src/i18n/locales/pt/index.ts` and `.../en/index.ts` — add
`import vault from './vault.json'` and add `vault` to the exported
`resources` object.

- [ ] **Step 7: Write the `VaultSetupPage` test**

`apps/web/src/vault/VaultSetupPage.test.tsx`:

```ts
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const setUpVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./setup', () => ({ setUpVault: setUpVaultMock }))

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../auth/session', () => ({ useSession: useSessionMock }))

const { VaultSetupPage } = await import('./VaultSetupPage')

await initI18n()

function renderPage() {
  return render(
    <I18nextProvider i18n={i18next}>
      <VaultSetupPage />
    </I18nextProvider>,
  )
}

describe('VaultSetupPage', () => {
  beforeEach(() => {
    setUpVaultMock.mockReset()
    useSessionMock.mockReturnValue({ data: { id: 'u1', email: 'paulo@example.com', locale: 'pt-PT' } })
  })

  it('shows the recovery code only after a successful setup, gated by the checkbox', async () => {
    setUpVaultMock.mockResolvedValue({ recoveryCode: 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z' })
    renderPage()

    await userEvent.type(screen.getByLabelText(/palavra-passe mestra/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }))

    expect(await screen.findByText('ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continuar/i })).toBeDisabled()

    await userEvent.click(screen.getByLabelText(/anotei o código/i))
    expect(screen.getByRole('button', { name: /continuar/i })).toBeEnabled()
  })
})
```

- [ ] **Step 8: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- VaultSetupPage`
Expected: FAIL — `./VaultSetupPage` does not exist.

- [ ] **Step 9: Implement `VaultSetupPage`**

`apps/web/src/vault/VaultSetupPage.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { useSession } from '../auth/session'
import { setUpVault } from './setup'

export function VaultSetupPage() {
  const { t } = useTranslation('vault')
  const session = useSession()
  const [masterPassword, setMasterPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const mutation = useMutation({
    mutationFn: () => setUpVault(session.data?.email ?? '', masterPassword),
    onSuccess: (result) => setRecoveryCode(result.recoveryCode),
  })

  if (recoveryCode !== null) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="text-lg font-semibold">{t('setup.title')}</h1>
        <p className="text-sm">{t('setup.recoveryCodeIntro')}</p>
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-center font-mono text-sm text-amber-900">
          {recoveryCode}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          {t('setup.acknowledgeLabel')}
        </label>
        <button
          type="button"
          disabled={!acknowledged}
          onClick={() => window.history.back()}
          className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {t('setup.continueButton')}
        </button>
      </div>
    )
  }

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h1 className="text-lg font-semibold">{t('setup.title')}</h1>

      <label className="flex flex-col gap-1 text-sm">
        {t('setup.confirmPasswordLabel')}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('setup.continueButton')}
      </button>
    </form>
  )
}
```

- [ ] **Step 10: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- VaultSetupPage`
Expected: PASS.

- [ ] **Step 11: Relocate the recovery warning out of `SetupPage`**

`SetupPage` (account bootstrap) currently shows `common:auth.recoveryWarning`
before any recovery code exists — that copy only makes sense now that
`VaultSetupPage` actually generates one. Remove the `<p role="alert">
{t('auth.recoveryWarning')}</p>` block from `apps/web/src/auth/SetupPage.tsx`
entirely (the master password's own "no reset path" is still real and
already covered by `MIN_MASTER_PASSWORD_LENGTH`'s validation; nothing
replaces this block).

Update `apps/web/src/auth/SetupPage.test.tsx` if it asserts on that warning
text being present — if so, remove that specific assertion (the rest of the
file's coverage is unaffected).

- [ ] **Step 12: Register the route**

Add to `apps/web/src/router.tsx`:

```ts
import { VaultSetupPage } from './vault/VaultSetupPage'
```

```ts
const vaultSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vault/setup',
  component: VaultSetupPage,
})
```

Add `vaultSetupRoute` to the `rootRoute.addChildren([...])` array.

- [ ] **Step 13: Verify locale parity and the full web suite**

Run: `pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web test`
Expected: both green.

- [ ] **Step 14: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/vault/api.ts apps/web/src/vault/setup.ts apps/web/src/vault/setup.test.ts \
  apps/web/src/vault/VaultSetupPage.tsx apps/web/src/vault/VaultSetupPage.test.tsx \
  apps/web/src/auth/SetupPage.tsx apps/web/src/auth/SetupPage.test.tsx apps/web/src/router.tsx \
  apps/web/src/i18n/locales/pt/vault.json apps/web/src/i18n/locales/en/vault.json \
  apps/web/src/i18n/locales/pt/index.ts apps/web/src/i18n/locales/en/index.ts
git commit -m "feat(web): add the vault API client and the one-time setup flow"
```

---
### Task 13: Unlock flow and the global lock indicator

**Files:**
- Create: `apps/web/src/vault/unlock.ts`
- Create: `apps/web/src/vault/unlock.test.ts`
- Create: `apps/web/src/vault/VaultUnlockGate.tsx`
- Create: `apps/web/src/vault/VaultUnlockGate.test.tsx`
- Modify: `apps/web/src/shell/AppLayout.tsx`
- Modify: `apps/web/src/shell/AppLayout.test.tsx`
- Modify: `apps/web/src/i18n/locales/pt/vault.json`, `.../en/vault.json`
- Modify: `apps/web/src/i18n/locales/pt/common.json`, `.../en/common.json`

**Interfaces:**
- Consumes: `getVaultEnvelope` (Task 12); `getVaultMeta`, `putVaultMeta` (Task 11); `unlockVault`, `useVaultState`, `lockVault` (Task 10); `deriveMasterKey`, `deriveStretchedKey`, `unwrapVaultKey`, `fromBase64` (Task 1).
- Produces (consumed by Tasks 15, 16): `resolveEnvelope`, `unlockWithPassword`, `VaultUnlockGate`.

- [ ] **Step 1: Write the unlock orchestration tests**

`apps/web/src/vault/unlock.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const getVaultEnvelopeMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getVaultEnvelope: getVaultEnvelopeMock }))

const getVaultMetaMock = vi.hoisted(() => vi.fn())
const putVaultMetaMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({ getVaultMeta: getVaultMetaMock, putVaultMeta: putVaultMetaMock }))

const { resolveEnvelope } = await import('./unlock')

describe('resolveEnvelope', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    getVaultEnvelopeMock.mockReset()
    getVaultMetaMock.mockReset()
    putVaultMetaMock.mockReset()
  })

  it('prefers the live envelope when the server is reachable', async () => {
    getVaultEnvelopeMock.mockResolvedValue({ protectedVaultKey: 'LIVE', setUpAt: '2026-09-10T00:00:00.000Z' })
    apiFetchMock.mockResolvedValue({ kdfSalt: 'SALT' })

    await expect(resolveEnvelope('paulo@example.com')).resolves.toEqual({
      kdfSalt: 'SALT',
      protectedVaultKey: 'LIVE',
      setUp: true,
      fromCache: false,
    })
  })

  it('reports not set up when the live envelope has no protected key', async () => {
    getVaultEnvelopeMock.mockResolvedValue({ protectedVaultKey: null, setUpAt: null })
    apiFetchMock.mockResolvedValue({ kdfSalt: 'SALT' })

    await expect(resolveEnvelope('paulo@example.com')).resolves.toMatchObject({ setUp: false })
  })

  it('falls back to the IndexedDB cache when the server is unreachable', async () => {
    getVaultEnvelopeMock.mockRejectedValue(new Error('offline'))
    getVaultMetaMock.mockResolvedValue({ id: 'singleton', kdfSalt: 'CACHED_SALT', protectedVaultKey: 'CACHED_KEY', lastSyncedAt: null })

    await expect(resolveEnvelope('paulo@example.com')).resolves.toEqual({
      kdfSalt: 'CACHED_SALT',
      protectedVaultKey: 'CACHED_KEY',
      setUp: true,
      fromCache: true,
    })
  })

  it('returns null when offline and nothing was ever cached', async () => {
    getVaultEnvelopeMock.mockRejectedValue(new Error('offline'))
    getVaultMetaMock.mockResolvedValue(undefined)

    await expect(resolveEnvelope('paulo@example.com')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- vault/unlock`
Expected: FAIL — `./unlock` does not exist.

- [ ] **Step 3: Implement `resolveEnvelope` and `unlockWithPassword`**

`apps/web/src/vault/unlock.ts`:

```ts
import { deriveMasterKey, deriveStretchedKey, fromBase64, unwrapVaultKey } from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'
import { getVaultEnvelope } from './api'
import { getVaultMeta, putVaultMeta } from './vault-db'
import { unlockVault } from './vault-session'

type KdfResponse = { kdfSalt: string }

export type ResolvedEnvelope = { kdfSalt: string; protectedVaultKey: string; setUp: boolean; fromCache: boolean }

/**
 * Prefers the live server envelope; falls back to the last cached copy when
 * offline (spec 9.6). Returns `null` only when neither is available — the
 * first unlock attempt ever made, offline, before anything was cached.
 */
export async function resolveEnvelope(email: string): Promise<ResolvedEnvelope | null> {
  try {
    const [envelope, kdf] = await Promise.all([
      getVaultEnvelope(),
      apiFetch<KdfResponse>(`/auth/kdf?email=${encodeURIComponent(email)}`),
    ])

    return {
      kdfSalt: kdf.kdfSalt,
      protectedVaultKey: envelope.protectedVaultKey ?? '',
      setUp: envelope.protectedVaultKey !== null,
      fromCache: false,
    }
  } catch {
    const cached = await getVaultMeta()
    if (!cached) return null
    return { kdfSalt: cached.kdfSalt, protectedVaultKey: cached.protectedVaultKey, setUp: true, fromCache: true }
  }
}

/** Throws when the vault was never set up, or when `masterPassword` is wrong (AES-KW's own integrity check). */
export async function unlockWithPassword(email: string, masterPassword: string): Promise<void> {
  const envelope = await resolveEnvelope(email)
  if (!envelope || !envelope.setUp) throw new Error('vault not set up')

  const masterKey = await deriveMasterKey(masterPassword, fromBase64(envelope.kdfSalt))
  const stretched = await deriveStretchedKey(masterKey)
  const sessionKey = await unwrapVaultKey(fromBase64(envelope.protectedVaultKey), stretched)

  unlockVault(sessionKey)

  if (!envelope.fromCache) {
    const existing = await getVaultMeta()
    await putVaultMeta({
      id: 'singleton',
      kdfSalt: envelope.kdfSalt,
      protectedVaultKey: envelope.protectedVaultKey,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
    })
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault/unlock`
Expected: PASS.

- [ ] **Step 5: Add the unlock locale keys**

Add to `apps/web/src/i18n/locales/pt/vault.json` (new top-level key,
alongside `setup`):

```json
  "unlock": {
    "notSetUp": "O cofre ainda não foi configurado.",
    "setUpLink": "Configurar agora",
    "passwordLabel": "Palavra-passe mestra",
    "wrongPassword": "Palavra-passe incorreta.",
    "unlockButton": "Desbloquear"
  }
```

Add to `apps/web/src/i18n/locales/en/vault.json`:

```json
  "unlock": {
    "notSetUp": "The vault has not been set up yet.",
    "setUpLink": "Set it up now",
    "passwordLabel": "Master password",
    "wrongPassword": "Incorrect password.",
    "unlockButton": "Unlock"
  }
```

- [ ] **Step 6: Write the `VaultUnlockGate` test**

`apps/web/src/vault/VaultUnlockGate.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { lockVault } from './vault-session'

const resolveEnvelopeMock = vi.hoisted(() => vi.fn())
const unlockWithPasswordMock = vi.hoisted(() => vi.fn())
vi.mock('./unlock', () => ({ resolveEnvelope: resolveEnvelopeMock, unlockWithPassword: unlockWithPasswordMock }))

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('../auth/session', () => ({ useSession: useSessionMock }))

const { VaultUnlockGate } = await import('./VaultUnlockGate')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({
    component: () => (
      <VaultUnlockGate>
        <p>secret content</p>
      </VaultUnlockGate>
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('VaultUnlockGate', () => {
  beforeEach(() => {
    lockVault()
    resolveEnvelopeMock.mockReset()
    unlockWithPasswordMock.mockReset()
    useSessionMock.mockReturnValue({ data: { id: 'u1', email: 'paulo@example.com', locale: 'pt-PT' } })
  })

  it('prompts to set up the vault when none exists', async () => {
    resolveEnvelopeMock.mockResolvedValue(null)
    renderGate()
    expect(await screen.findByText(/ainda não foi configurado/i)).toBeInTheDocument()
  })

  it('shows an unlock form and reveals children once unlocked', async () => {
    resolveEnvelopeMock.mockResolvedValue({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', setUp: true, fromCache: false })
    unlockWithPasswordMock.mockImplementation(async () => {
      const { unlockVault } = await import('./vault-session')
      unlockVault({ type: 'secret' } as CryptoKey)
    })
    renderGate()

    await userEvent.type(await screen.findByLabelText(/palavra-passe mestra/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /desbloquear/i }))

    expect(await screen.findByText('secret content')).toBeInTheDocument()
  })

  it('shows a translated error on a wrong password', async () => {
    resolveEnvelopeMock.mockResolvedValue({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB', setUp: true, fromCache: false })
    unlockWithPasswordMock.mockRejectedValue(new Error('OperationError'))
    renderGate()

    await userEvent.type(await screen.findByLabelText(/palavra-passe mestra/i), 'wrong password')
    await userEvent.click(screen.getByRole('button', { name: /desbloquear/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorreta/i)
  })
})
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- VaultUnlockGate`
Expected: FAIL — `./VaultUnlockGate` does not exist.

- [ ] **Step 8: Implement `VaultUnlockGate`**

`apps/web/src/vault/VaultUnlockGate.tsx`:

```tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useSession } from '../auth/session'
import { resolveEnvelope, unlockWithPassword } from './unlock'
import { useVaultState } from './vault-session'

export function VaultUnlockGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('vault')
  const session = useSession()
  const email = session.data?.email ?? ''
  const vaultState = useVaultState()
  const [masterPassword, setMasterPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const envelope = useQuery({
    queryKey: ['vault-envelope-resolved', email],
    queryFn: () => resolveEnvelope(email),
    enabled: email !== '' && vaultState.status === 'locked',
  })

  if (vaultState.status === 'unlocked') return <>{children}</>
  if (envelope.isPending) return null

  if (!envelope.data || !envelope.data.setUp) {
    return (
      <p className="text-sm">
        {t('unlock.notSetUp')}{' '}
        <Link to="/vault/setup" className="underline">
          {t('unlock.setUpLink')}
        </Link>
      </p>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setPending(true)
        setError(null)
        unlockWithPassword(email, masterPassword)
          .then(() => setMasterPassword(''))
          .catch(() => setError(t('unlock.wrongPassword')))
          .finally(() => setPending(false))
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t('unlock.passwordLabel')}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {error !== null && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('unlock.unlockButton')}
      </button>
    </form>
  )
}
```

- [ ] **Step 9: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- VaultUnlockGate`
Expected: PASS.

- [ ] **Step 10: Add a global lock indicator to `AppLayout`**

Add to `apps/web/src/i18n/locales/pt/common.json`'s `actions` object:
`"lockVault": "Bloquear cofre"`. Add to `.../en/common.json`'s `actions`:
`"lockVault": "Lock vault"`.

Modify `apps/web/src/shell/AppLayout.tsx`: import `lockVault`, `useVaultState`
from `'../vault/vault-session'`, call `const vaultState = useVaultState()`
inside the component, and add a button next to the existing sign-out button,
rendered only while unlocked:

```tsx
{vaultState.status === 'unlocked' && (
  <button
    type="button"
    onClick={() => lockVault()}
    className="rounded border border-slate-300 px-2 py-1 text-sm"
  >
    {t('actions.lockVault')}
  </button>
)}
```

- [ ] **Step 11: Extend `AppLayout.test.tsx`**

Add one case asserting the button's visibility follows vault state:

```ts
it('shows the lock-vault button only once the vault is unlocked', async () => {
  const { unlockVault, lockVault } = await import('../vault/vault-session')
  lockVault()
  const { rerender } = renderLayout() // use this file's existing render helper
  expect(screen.queryByRole('button', { name: /bloquear cofre/i })).not.toBeInTheDocument()

  unlockVault({ type: 'secret' } as CryptoKey)
  rerender(/* same element the helper originally rendered */)
  expect(screen.getByRole('button', { name: /bloquear cofre/i })).toBeInTheDocument()
  lockVault()
})
```

Adapt this to the file's actual existing render helper and imports — read
`AppLayout.test.tsx` first and match its established pattern rather than
introducing a second one.

- [ ] **Step 12: Run the full web suite, typecheck, lint**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: all clean.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/vault/unlock.ts apps/web/src/vault/unlock.test.ts \
  apps/web/src/vault/VaultUnlockGate.tsx apps/web/src/vault/VaultUnlockGate.test.tsx \
  apps/web/src/shell/AppLayout.tsx apps/web/src/shell/AppLayout.test.tsx \
  apps/web/src/i18n/locales/pt/vault.json apps/web/src/i18n/locales/en/vault.json \
  apps/web/src/i18n/locales/pt/common.json apps/web/src/i18n/locales/en/common.json
git commit -m "feat(web): add the vault unlock flow, offline fallback, and a global lock indicator"
```

---
### Task 14: Recovery UI

**Files:**
- Create: `apps/web/src/vault/recover.ts`
- Create: `apps/web/src/vault/recover.test.ts`
- Modify: `apps/web/src/auth/LoginPage.tsx`
- Modify: `apps/web/src/auth/LoginPage.test.tsx`
- Modify: `apps/web/src/i18n/locales/pt/common.json`, `.../en/common.json`
- Modify: `apps/web/src/vault/api.ts` (already has `postVaultRecover`; add nothing — listed for clarity that this task depends on it)

**Interfaces:**
- Consumes: `deriveRecoveryWrappingKey`, `unwrapVaultKeyRaw`, `deriveRecoveryAuthHash`, `generateSalt`, `deriveMasterKey`, `deriveAuthHash`, `deriveStretchedKey`, `wrapVaultKey`, `importVaultSessionKey`, `toBase64`, `fromBase64` (Task 1); `postVaultRecover` (Task 12's `api.ts`); `putVaultMeta` (Task 11); `unlockVault` (Task 10).
- Produces: `recoverVault(newMasterPassword: string, recoveryCode: string): Promise<void>`, and a recovery mode inside `LoginPage`.

- [ ] **Step 1: Write the recovery orchestration tests**

`apps/web/src/vault/recover.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const postVaultRecoverMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ postVaultRecover: postVaultRecoverMock }))

const unlockVaultMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-session', () => ({ unlockVault: unlockVaultMock }))

const putVaultMetaMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({ putVaultMeta: putVaultMetaMock }))

const { recoverVault } = await import('./recover')

// Generated the same way Task 1's fixtures are: a real recovery code wrapping
// a real vault key, so this test exercises the actual unwrap, not a stub.
async function realRecoveryEnvelope() {
  const { deriveRecoveryWrappingKey, generateRecoveryCode, generateVaultKey, toBase64, wrapVaultKey } = await import(
    '@ledger-hq/crypto'
  )
  const recoveryCode = generateRecoveryCode()
  const vaultKey = generateVaultKey()
  const wrappingKey = await deriveRecoveryWrappingKey(recoveryCode)
  const recoveryVaultKey = toBase64(await wrapVaultKey(vaultKey, wrappingKey))
  return { recoveryCode, recoveryVaultKey }
}

describe('recoverVault', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    postVaultRecoverMock.mockReset().mockResolvedValue(undefined)
    unlockVaultMock.mockReset()
    putVaultMetaMock.mockReset().mockResolvedValue(undefined)
  })

  it('unwraps with the real recovery code and posts a reset request', async () => {
    const { recoveryCode, recoveryVaultKey } = await realRecoveryEnvelope()
    apiFetchMock.mockResolvedValue({ recoveryVaultKey })

    await recoverVault('a new long master password', recoveryCode)

    expect(postVaultRecoverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryAuthHash: expect.any(String),
        kdfSalt: expect.any(String),
        authHash: expect.any(String),
        protectedVaultKey: expect.any(String),
      }),
    )
    expect(unlockVaultMock).toHaveBeenCalledTimes(1)
    expect(putVaultMetaMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a wrong recovery code before ever calling the server', async () => {
    const { recoveryVaultKey } = await realRecoveryEnvelope()
    apiFetchMock.mockResolvedValue({ recoveryVaultKey })

    await expect(recoverVault('a new long master password', 'WRONG-CODE-WRONG-CODE-1')).rejects.toThrow()
    expect(postVaultRecoverMock).not.toHaveBeenCalled()
  })

  it('rejects when the vault was never set up', async () => {
    apiFetchMock.mockResolvedValue({ recoveryVaultKey: null })
    await expect(recoverVault('a new long master password', 'ANYTHING')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- vault/recover`
Expected: FAIL — `./recover` does not exist.

- [ ] **Step 3: Implement `recoverVault`**

`apps/web/src/vault/recover.ts`:

```ts
import {
  deriveAuthHash,
  deriveMasterKey,
  deriveRecoveryAuthHash,
  deriveRecoveryWrappingKey,
  deriveStretchedKey,
  fromBase64,
  generateSalt,
  importVaultSessionKey,
  toBase64,
  unwrapVaultKeyRaw,
  wrapVaultKey,
} from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'
import { postVaultRecover } from './api'
import { putVaultMeta } from './vault-db'
import { unlockVault } from './vault-session'

type RecoveryEnvelopeResponse = { recoveryVaultKey: string | null }

/**
 * Regains access with only the recovery code — no session, no old master
 * password. `unwrapVaultKeyRaw` throws first (AES-KW's own integrity check)
 * when the code is wrong, before this ever reaches the server; the server
 * verifies independently too (see `AuthService.recoverVault`, Task 6),
 * because a client-side check alone is never the actual guarantee.
 */
export async function recoverVault(newMasterPassword: string, recoveryCode: string): Promise<void> {
  const { recoveryVaultKey } = await apiFetch<RecoveryEnvelopeResponse>('/auth/vault-recovery-envelope')
  if (recoveryVaultKey === null) throw new Error('vault not set up')

  const recoveryWrappingKey = await deriveRecoveryWrappingKey(recoveryCode)
  const vaultKey = await unwrapVaultKeyRaw(fromBase64(recoveryVaultKey), recoveryWrappingKey)
  const recoveryAuthHash = toBase64(await deriveRecoveryAuthHash(vaultKey, recoveryCode))

  const kdfSalt = toBase64(generateSalt())
  const masterKey = await deriveMasterKey(newMasterPassword, fromBase64(kdfSalt))
  const authHash = toBase64(await deriveAuthHash(masterKey, newMasterPassword))
  const stretched = await deriveStretchedKey(masterKey)
  const protectedVaultKey = toBase64(await wrapVaultKey(vaultKey, stretched))

  await postVaultRecover({ recoveryAuthHash, kdfSalt, authHash, protectedVaultKey })

  unlockVault(await importVaultSessionKey(vaultKey))
  await putVaultMeta({ id: 'singleton', kdfSalt, protectedVaultKey, lastSyncedAt: null })
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault/recover`
Expected: PASS, including the real-crypto round trip.

- [ ] **Step 5: Add the recovery-mode locale keys**

Add to `apps/web/src/i18n/locales/pt/common.json`'s `auth` object:

```json
    "forgotPassword": "Esqueceste a palavra-passe mestra?",
    "recoverTitle": "Recuperar acesso",
    "recoveryCodeLabel": "Código de recuperação",
    "newMasterPasswordLabel": "Nova palavra-passe mestra",
    "confirmNewMasterPasswordLabel": "Confirma a nova palavra-passe mestra",
    "backToLogin": "Voltar a entrar",
    "recoverButton": "Recuperar acesso"
```

Add the equivalent to `.../en/common.json`'s `auth` object:

```json
    "forgotPassword": "Forgot your master password?",
    "recoverTitle": "Regain access",
    "recoveryCodeLabel": "Recovery code",
    "newMasterPasswordLabel": "New master password",
    "confirmNewMasterPasswordLabel": "Confirm the new master password",
    "backToLogin": "Back to sign in",
    "recoverButton": "Regain access"
```

- [ ] **Step 6: Write the `LoginPage` recovery-mode tests**

Add to `apps/web/src/auth/LoginPage.test.tsx` (read the file first — it
already renders with `I18nextProvider` and a `QueryClientProvider`; reuse its
existing render helper rather than writing a new one):

```ts
const recoverVaultMock = vi.hoisted(() => vi.fn())
vi.mock('../vault/recover', () => ({ recoverVault: recoverVaultMock }))
```

```ts
describe('recovery mode', () => {
  beforeEach(() => {
    recoverVaultMock.mockReset()
  })

  it('switches to the recovery form and back', async () => {
    renderPage() // this file's existing render helper
    await userEvent.click(screen.getByRole('button', { name: /esqueceste a palavra-passe/i }))
    expect(screen.getByRole('heading', { name: /recuperar acesso/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /voltar a entrar/i }))
    expect(screen.getByRole('heading', { name: /entrar/i })).toBeInTheDocument()
  })

  it('submits the recovery code and new password', async () => {
    recoverVaultMock.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /esqueceste a palavra-passe/i }))

    await userEvent.type(screen.getByLabelText(/código de recuperação/i), 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    await userEvent.type(screen.getByLabelText('Nova palavra-passe mestra'), 'a new long master password')
    await userEvent.type(screen.getByLabelText(/confirma a nova palavra-passe/i), 'a new long master password')
    await userEvent.click(screen.getByRole('button', { name: /^recuperar acesso$/i }))

    await vi.waitFor(() => {
      expect(recoverVaultMock).toHaveBeenCalledWith('a new long master password', 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z')
    })
  })
})
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- LoginPage`
Expected: FAIL — no recovery mode exists yet.

- [ ] **Step 8: Add the recovery mode to `LoginPage`**

Replace the full contents of `apps/web/src/auth/LoginPage.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MIN_MASTER_PASSWORD_LENGTH } from '@ledger-hq/crypto'
import { ErrorMessage } from '../shell/ErrorMessage'
import { recoverVault } from '../vault/recover'
import { signIn } from './credentials'
import { SESSION_QUERY_KEY } from './session'

export function LoginPage() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newMasterPassword, setNewMasterPassword] = useState('')
  const [confirmNewMasterPassword, setConfirmNewMasterPassword] = useState('')

  const passwordTooShort = masterPassword.length > 0 && masterPassword.length < MIN_MASTER_PASSWORD_LENGTH

  const loginMutation = useMutation({
    mutationFn: () => signIn(email, masterPassword),
    onSuccess: async () => {
      setMasterPassword('')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  const newPasswordTooShort =
    newMasterPassword.length > 0 && newMasterPassword.length < MIN_MASTER_PASSWORD_LENGTH
  const newPasswordsMismatch =
    confirmNewMasterPassword.length > 0 && newMasterPassword !== confirmNewMasterPassword

  const recoverMutation = useMutation({
    mutationFn: () => recoverVault(newMasterPassword, recoveryCode),
    onSuccess: async () => {
      setRecoveryCode('')
      setNewMasterPassword('')
      setConfirmNewMasterPassword('')
      setMode('login')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  if (mode === 'recover') {
    return (
      <form
        className="mx-auto flex max-w-sm flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (newPasswordTooShort || newPasswordsMismatch) return
          recoverMutation.mutate()
        }}
      >
        <h1 className="text-lg font-semibold">{t('auth.recoverTitle')}</h1>

        <label className="flex flex-col gap-1 text-sm">
          {t('auth.recoveryCodeLabel')}
          <input
            required
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1 font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('auth.newMasterPasswordLabel')}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={newMasterPassword}
            onChange={(event) => setNewMasterPassword(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('auth.confirmNewMasterPasswordLabel')}
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmNewMasterPassword}
            onChange={(event) => setConfirmNewMasterPassword(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        {newPasswordTooShort && (
          <p role="alert" className="text-sm text-red-700">
            {t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH })}
          </p>
        )}
        {newPasswordsMismatch && (
          <p role="alert" className="text-sm text-red-700">
            {t('auth.passwordMismatch')}
          </p>
        )}

        <ErrorMessage error={recoverMutation.error} />

        <button
          type="submit"
          disabled={recoverMutation.isPending || newPasswordTooShort || newPasswordsMismatch}
          className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {t('auth.recoverButton')}
        </button>

        <button type="button" onClick={() => setMode('login')} className="text-sm underline">
          {t('auth.backToLogin')}
        </button>
      </form>
    )
  }

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (passwordTooShort) return
        loginMutation.mutate()
      }}
    >
      <h1 className="text-lg font-semibold">{t('auth.loginTitle')}</h1>

      <label className="flex flex-col gap-1 text-sm">
        {t('auth.emailLabel')}
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('auth.masterPasswordLabel')}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={masterPassword}
          onChange={(event) => setMasterPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      {passwordTooShort && (
        <p role="alert" className="text-sm text-red-700">
          {t('auth.passwordTooShort', { min: MIN_MASTER_PASSWORD_LENGTH })}
        </p>
      )}

      <ErrorMessage error={loginMutation.error} />

      <button
        type="submit"
        disabled={loginMutation.isPending || passwordTooShort}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('actions.signIn')}
      </button>

      <button type="button" onClick={() => setMode('recover')} className="text-sm underline">
        {t('auth.forgotPassword')}
      </button>
    </form>
  )
}
```

- [ ] **Step 9: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- LoginPage`
Expected: PASS, including the pre-existing login-mode cases (unchanged) and
the new recovery-mode cases.

- [ ] **Step 10: Verify locale parity and the full web suite**

Run: `pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web test`
Expected: both green.

- [ ] **Step 11: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/vault/recover.ts apps/web/src/vault/recover.test.ts \
  apps/web/src/auth/LoginPage.tsx apps/web/src/auth/LoginPage.test.tsx \
  apps/web/src/i18n/locales/pt/common.json apps/web/src/i18n/locales/en/common.json
git commit -m "feat(web): add recovery-code account reset to the sign-in screen"
```

---
### Task 15: Platforms admin page

**Files:**
- Create: `apps/web/src/vault/PlatformsPage.tsx`
- Create: `apps/web/src/vault/PlatformsPage.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/shell/AppLayout.tsx`
- Modify: `apps/web/src/i18n/locales/pt/vault.json`, `.../en/vault.json`
- Modify: `apps/web/src/i18n/locales/pt/domain.json`, `.../en/domain.json`
- Modify: `apps/web/src/i18n/locales/pt/common.json`, `.../en/common.json`

**Interfaces:**
- Consumes: `listPlatforms`, `createPlatform` (Task 12's `api.ts`).
- Produces (consumed by Task 16, which links a credential's `platformId` to a
  platform's `name` for display): `PlatformsPage` at route `/vault/platforms`.

This page needs a session, not an unlocked vault — see the "Decisions" note
on why platforms are plaintext metadata.

- [ ] **Step 1: Add the platform-kind translations and page copy**

Add to `apps/web/src/i18n/locales/pt/domain.json` (new top-level key,
alongside whatever `clientKind`/`legalForm`/etc. blocks already exist):

```json
  "authKind": {
    "PASSWORD": "Palavra-passe",
    "PASSWORD_OTP": "Palavra-passe + código de verificação",
    "CERTIFICATE": "Certificado"
  }
```

Add the equivalent to `.../en/domain.json`:

```json
  "authKind": {
    "PASSWORD": "Password",
    "PASSWORD_OTP": "Password + verification code",
    "CERTIFICATE": "Certificate"
  }
```

Add to `apps/web/src/i18n/locales/pt/vault.json` (new top-level key):

```json
  "platforms": {
    "title": "Plataformas",
    "newTitle": "Nova plataforma",
    "empty": "Ainda não há plataformas.",
    "form": {
      "name": { "label": "Nome", "invalid": "Indica um nome válido." },
      "url": { "label": "URL", "invalid": "Indica um URL válido." },
      "authKind": { "label": "Tipo de autenticação" }
    }
  }
```

Add the equivalent to `.../en/vault.json`:

```json
  "platforms": {
    "title": "Platforms",
    "newTitle": "New platform",
    "empty": "There are no platforms yet.",
    "form": {
      "name": { "label": "Name", "invalid": "Enter a valid name." },
      "url": { "label": "URL", "invalid": "Enter a valid URL." },
      "authKind": { "label": "Authentication kind" }
    }
  }
```

Add `"platforms": "Plataformas"` / `"Platforms"` to the `nav` object in
`apps/web/src/i18n/locales/{pt,en}/common.json` (alongside the existing
`"clients"` entry).

- [ ] **Step 2: Write the page test**

`apps/web/src/vault/PlatformsPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listPlatformsMock = vi.hoisted(() => vi.fn())
const createPlatformMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listPlatforms: listPlatformsMock, createPlatform: createPlatformMock }))

const { PlatformsPage } = await import('./PlatformsPage')

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <PlatformsPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('PlatformsPage', () => {
  beforeEach(() => {
    listPlatformsMock.mockReset()
    createPlatformMock.mockReset()
  })

  it('lists existing platforms', async () => {
    listPlatformsMock.mockResolvedValue([
      { id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' },
    ])
    renderPage()
    expect(await screen.findByText('Portal das Finanças')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    listPlatformsMock.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/ainda não há plataformas/i)).toBeInTheDocument()
  })

  it('creates a new platform', async () => {
    listPlatformsMock.mockResolvedValue([])
    createPlatformMock.mockResolvedValue({ id: 'p1', name: 'X', url: null, authKind: 'PASSWORD' })
    renderPage()

    await userEvent.type(await screen.findByLabelText(/nome/i), 'X')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await vi.waitFor(() => {
      expect(createPlatformMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'X', authKind: 'PASSWORD' }))
    })
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- PlatformsPage`
Expected: FAIL — `./PlatformsPage` does not exist.

- [ ] **Step 4: Implement the page**

`apps/web/src/vault/PlatformsPage.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AUTH_KIND_VALUES } from '@ledger-hq/domain'
import type { AuthKind } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createPlatform, listPlatforms } from './api'

export function PlatformsPage() {
  const { t } = useTranslation(['vault', 'domain'])
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authKind, setAuthKind] = useState<AuthKind>('PASSWORD')

  const platforms = useQuery({ queryKey: ['platforms'], queryFn: listPlatforms })

  const mutation = useMutation({
    mutationFn: () => createPlatform({ name, url: url === '' ? undefined : url, authKind }),
    onSuccess: async () => {
      setName('')
      setUrl('')
      await queryClient.invalidateQueries({ queryKey: ['platforms'] })
    },
  })

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t('vault:platforms.title')}</h1>

      {platforms.isPending ? null : platforms.isError ? (
        <ErrorMessage error={platforms.error} />
      ) : platforms.data.length === 0 ? (
        <p className="text-sm text-slate-500">{t('vault:platforms.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {platforms.data.map((platform) => (
            <li key={platform.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
              <span className="font-medium">{platform.name}</span>{' '}
              <span className="text-slate-500">{t(`domain:authKind.${platform.authKind}`)}</span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex max-w-sm flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <h2 className="font-medium">{t('vault:platforms.newTitle')}</h2>

        <label className="flex flex-col gap-1 text-sm">
          {t('vault:platforms.form.name.label')}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('vault:platforms.form.url.label')}
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('vault:platforms.form.authKind.label')}
          <select
            value={authKind}
            onChange={(event) => setAuthKind(event.target.value as AuthKind)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {AUTH_KIND_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`domain:authKind.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <ErrorMessage error={mutation.error} />

        <button
          type="submit"
          disabled={mutation.isPending}
          className="self-start rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {t('common:actions.create')}
        </button>
      </form>
    </section>
  )
}
```

Note this uses `t('common:actions.create')` — add `'common'` to the
`useTranslation` namespace array: `useTranslation(['vault', 'domain', 'common'])`.

- [ ] **Step 5: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- PlatformsPage`
Expected: PASS.

- [ ] **Step 6: Register the route and nav link**

Add to `apps/web/src/router.tsx`:

```ts
import { PlatformsPage } from './vault/PlatformsPage'
```

```ts
const platformsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vault/platforms',
  component: PlatformsPage,
})
```

Add `platformsRoute` to `rootRoute.addChildren([...])`.

Add a nav link to `apps/web/src/shell/AppLayout.tsx`, alongside the existing
`<Link to="/clients">`:

```tsx
<Link to="/vault/platforms" className="text-sm">
  {t('nav.platforms')}
</Link>
```

- [ ] **Step 7: Verify locale parity and run the full web suite**

Run: `pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web test`
Expected: both green.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/vault/PlatformsPage.tsx apps/web/src/vault/PlatformsPage.test.tsx \
  apps/web/src/router.tsx apps/web/src/shell/AppLayout.tsx \
  apps/web/src/i18n/locales/pt/vault.json apps/web/src/i18n/locales/en/vault.json \
  apps/web/src/i18n/locales/pt/domain.json apps/web/src/i18n/locales/en/domain.json \
  apps/web/src/i18n/locales/pt/common.json apps/web/src/i18n/locales/en/common.json
git commit -m "feat(web): add the platform catalog admin page"
```

---
### Task 16: Credentials on the client detail page

**Files:**
- Create: `apps/web/src/vault/CredentialsSection.tsx`
- Create: `apps/web/src/vault/CredentialRow.tsx`
- Create: `apps/web/src/vault/AddCredentialForm.tsx`
- Create: `apps/web/src/vault/CredentialsSection.test.tsx`
- Modify: `apps/web/src/clients/ClientDetailPage.tsx`
- Modify: `apps/web/src/i18n/locales/pt/vault.json`, `.../en/vault.json`

**Interfaces:**
- Consumes: `VaultUnlockGate` (Task 13); `useVaultState` (Task 10); `listCredentialsForClient`, `createCredential`, `rotateCredential`, `listPlatforms`, `PlatformResponse`, `CredentialResponse` (Task 12); `encryptCredentialItem`, `decryptCredentialItem`, `generateTotp`, `toBase64`, `fromBase64` (Tasks 1-2); `credentialItemSchema`, `CredentialItem` (Task 3).
- Produces: `CredentialsSection` rendered on `ClientDetailPage`.

- [ ] **Step 1: Add the credentials locale keys**

Add to `apps/web/src/i18n/locales/pt/vault.json` (new top-level key,
alongside `setup`, `unlock`, `platforms`):

```json
  "credentials": {
    "title": "Credenciais",
    "empty": "Ainda não há credenciais para este cliente.",
    "newTitle": "Nova credencial",
    "reveal": "Ver",
    "hide": "Ocultar",
    "copy": "Copiar",
    "totp": "Código atual",
    "rotate": "Mudar palavra-passe",
    "rotateConfirm": "Confirmar",
    "form": {
      "platform": { "label": "Plataforma" },
      "label": { "label": "Designação" },
      "username": { "label": "Utilizador" },
      "password": { "label": "Palavra-passe" },
      "totpSecret": { "label": "Segredo TOTP (opcional)" }
    }
  }
```

Add the equivalent to `.../en/vault.json`:

```json
  "credentials": {
    "title": "Credentials",
    "empty": "There are no credentials for this client yet.",
    "newTitle": "New credential",
    "reveal": "Reveal",
    "hide": "Hide",
    "copy": "Copy",
    "totp": "Current code",
    "rotate": "Change password",
    "rotateConfirm": "Confirm",
    "form": {
      "platform": { "label": "Platform" },
      "label": { "label": "Label" },
      "username": { "label": "Username" },
      "password": { "label": "Password" },
      "totpSecret": { "label": "TOTP secret (optional)" }
    }
  }
```

- [ ] **Step 2: Write the section test**

`apps/web/src/vault/CredentialsSection.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptCredentialItem, toBase64 } from '@ledger-hq/crypto'
import { initI18n } from '../i18n'
import { lockVault, unlockVault } from './vault-session'

const listCredentialsForClientMock = vi.hoisted(() => vi.fn())
const listPlatformsMock = vi.hoisted(() => vi.fn())
const createCredentialMock = vi.hoisted(() => vi.fn())
const rotateCredentialMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({
  listCredentialsForClient: listCredentialsForClientMock,
  listPlatforms: listPlatformsMock,
  createCredential: createCredentialMock,
  rotateCredential: rotateCredentialMock,
}))

const { CredentialsSection } = await import('./CredentialsSection')

await initI18n()
await i18next.changeLanguage('pt-PT')

Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

let vaultKey: CryptoKey

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <CredentialsSection clientId="client1" />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('CredentialsSection', () => {
  beforeEach(async () => {
    vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    unlockVault(vaultKey)
    listPlatformsMock.mockResolvedValue([{ id: 'p1', name: 'Portal das Finanças', url: null, authKind: 'PASSWORD' }])
    listCredentialsForClientMock.mockReset()
    createCredentialMock.mockReset()
    rotateCredentialMock.mockReset()
  })

  it('decrypts and reveals a credential on demand', async () => {
    const { ciphertext, iv } = await encryptCredentialItem(vaultKey, { username: 'user1', password: 'hunter2' })
    listCredentialsForClientMock.mockResolvedValue([
      {
        id: 'c1',
        clientId: 'client1',
        platformId: 'p1',
        label: 'Acesso principal',
        updatedAt: '2026-09-10T00:00:00.000Z',
        ciphertext: toBase64(ciphertext),
        iv: toBase64(iv),
      },
    ])

    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))

    expect(await screen.findByText(/user1/)).toBeInTheDocument()
  })

  it('encrypts before creating a credential', async () => {
    listCredentialsForClientMock.mockResolvedValue([])
    createCredentialMock.mockResolvedValue({
      id: 'c2',
      clientId: 'client1',
      platformId: 'p1',
      label: 'Nova',
      updatedAt: '2026-09-10T00:00:00.000Z',
      ciphertext: 'x',
      iv: 'y',
    })

    renderSection()
    await userEvent.type(await screen.findByLabelText(/designação/i), 'Nova')
    await userEvent.type(screen.getByLabelText(/utilizador/i), 'user2')
    await userEvent.type(screen.getByLabelText(/palavra-passe/i), 'secret2')
    await userEvent.click(screen.getByRole('button', { name: /criar/i }))

    await vi.waitFor(() => expect(createCredentialMock).toHaveBeenCalledTimes(1))
    const call = createCredentialMock.mock.calls[0][0]
    expect(call.ciphertext).not.toContain('user2')
    expect(call.ciphertext).not.toContain('secret2')

    const { decryptCredentialItem, fromBase64 } = await import('@ledger-hq/crypto')
    await expect(
      decryptCredentialItem(vaultKey, fromBase64(call.ciphertext), fromBase64(call.iv)),
    ).resolves.toMatchObject({ username: 'user2', password: 'secret2' })
  })

  it('clears a revealed credential when the vault locks', async () => {
    const { ciphertext, iv } = await encryptCredentialItem(vaultKey, { username: 'user3' })
    listCredentialsForClientMock.mockResolvedValue([
      {
        id: 'c3',
        clientId: 'client1',
        platformId: 'p1',
        label: 'x',
        updatedAt: '2026-09-10T00:00:00.000Z',
        ciphertext: toBase64(ciphertext),
        iv: toBase64(iv),
      },
    ])

    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: /^ver$/i }))
    expect(await screen.findByText(/user3/)).toBeInTheDocument()

    lockVault()

    await vi.waitFor(() => expect(screen.queryByText(/user3/)).not.toBeInTheDocument())
  })

  afterEach(() => {
    lockVault()
  })
})
```

(Add `afterEach` to this file's `vitest` import.)

- [ ] **Step 3: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- CredentialsSection`
Expected: FAIL — none of the three components exist yet.

- [ ] **Step 4: Implement `AddCredentialForm`**

`apps/web/src/vault/AddCredentialForm.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { encryptCredentialItem, toBase64 } from '@ledger-hq/crypto'
import { credentialItemSchema } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { createCredential } from './api'
import type { PlatformResponse } from './api'
import { useVaultState } from './vault-session'

type Props = { clientId: string; platforms: PlatformResponse[]; onCreated: () => void }

export function AddCredentialForm({ clientId, platforms, onCreated }: Props) {
  const { t } = useTranslation(['vault', 'common'])
  const vaultState = useVaultState()
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpSecret, setTotpSecret] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      if (vaultState.status !== 'unlocked') throw new Error('vault locked')

      const item = credentialItemSchema.parse({
        ...(username === '' ? {} : { username }),
        ...(password === '' ? {} : { password }),
        ...(totpSecret === '' ? {} : { totpSecret }),
      })
      const { ciphertext, iv } = await encryptCredentialItem(vaultState.key, item)

      return createCredential({ clientId, platformId, label, ciphertext: toBase64(ciphertext), iv: toBase64(iv) })
    },
    onSuccess: () => {
      setLabel('')
      setUsername('')
      setPassword('')
      setTotpSecret('')
      onCreated()
    },
  })

  if (platforms.length === 0) return null

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <h3 className="font-medium">{t('vault:credentials.newTitle')}</h3>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.platform.label')}
        <select
          value={platformId}
          onChange={(event) => setPlatformId(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {platforms.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.label.label')}
        <input
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.username.label')}
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.password.label')}
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('vault:credentials.form.totpSecret.label')}
        <input
          value={totpSecret}
          onChange={(event) => setTotpSecret(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </label>

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="self-start rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('common:actions.create')}
      </button>
    </form>
  )
}
```

- [ ] **Step 5: Implement `CredentialRow`**

`apps/web/src/vault/CredentialRow.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { decryptCredentialItem, encryptCredentialItem, fromBase64, generateTotp, toBase64 } from '@ledger-hq/crypto'
import type { CredentialItem } from '@ledger-hq/domain'
import { ErrorMessage } from '../shell/ErrorMessage'
import { rotateCredential } from './api'
import type { CredentialResponse } from './api'
import { useVaultState } from './vault-session'

type Props = { credential: CredentialResponse; platformName: string; onRotated: () => void }

const CLIPBOARD_CLEAR_MS = 30_000

/** Clears the clipboard 30 seconds after copying a secret — "to the extent the browser permits" (spec 9.4). */
async function copyAndClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {})
  }, CLIPBOARD_CLEAR_MS)
}

export function CredentialRow({ credential, platformName, onRotated }: Props) {
  const { t } = useTranslation('vault')
  const vaultState = useVaultState()
  const [item, setItem] = useState<CredentialItem | null>(null)
  const [totp, setTotp] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  async function reveal(): Promise<void> {
    if (vaultState.status !== 'unlocked') return
    const decrypted = await decryptCredentialItem(vaultState.key, fromBase64(credential.ciphertext), fromBase64(credential.iv))
    setItem(decrypted as CredentialItem)
  }

  // Spec 9.4: "Locking releases the reference and clears cached plaintext."
  // Auto-lock (Task 10) only drops the CryptoKey — anything already
  // revealed on screen must be cleared independently, or a credential
  // stays visible past the inactivity window that was supposed to hide it.
  useEffect(() => {
    if (vaultState.status === 'locked') setItem(null)
  }, [vaultState.status])

  useEffect(() => {
    const secret = item?.totpSecret
    if (secret === undefined) {
      setTotp(null)
      return
    }

    let cancelled = false
    const tick = () => {
      generateTotp(secret).then((code) => {
        if (!cancelled) setTotp(code)
      })
    }
    tick()
    const interval = setInterval(tick, 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [item?.totpSecret])

  const rotateMutation = useMutation({
    mutationFn: async () => {
      if (vaultState.status !== 'unlocked' || item === null) throw new Error('vault locked')
      const { ciphertext, iv } = await encryptCredentialItem(vaultState.key, { ...item, password: newPassword })
      return rotateCredential(credential.id, { ciphertext: toBase64(ciphertext), iv: toBase64(iv) })
    },
    onSuccess: () => {
      setRotating(false)
      setNewPassword('')
      setItem(null)
      onRotated()
    },
  })

  return (
    <li className="rounded border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          {platformName} — {credential.label}
        </span>
        {item === null ? (
          <button type="button" onClick={reveal} className="rounded border border-slate-300 px-2 py-1 text-xs">
            {t('credentials.reveal')}
          </button>
        ) : (
          <button type="button" onClick={() => setItem(null)} className="rounded border border-slate-300 px-2 py-1 text-xs">
            {t('credentials.hide')}
          </button>
        )}
      </div>

      {item !== null && (
        <div className="mt-2 flex flex-col gap-1">
          {item.username !== undefined && (
            <p>
              {t('credentials.form.username.label')}: {item.username}
            </p>
          )}
          {item.password !== undefined && (
            <p className="flex items-center gap-2">
              {t('credentials.form.password.label')}: ••••••••
              <button type="button" onClick={() => void copyAndClear(item.password ?? '')} className="text-xs underline">
                {t('credentials.copy')}
              </button>
            </p>
          )}
          {totp !== null && (
            <p className="font-mono">
              {t('credentials.totp')}: {totp}
            </p>
          )}
          {item.notes !== undefined && <p className="text-slate-600">{item.notes}</p>}

          {rotating ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="rounded border border-slate-300 px-2 py-1"
              />
              <button
                type="button"
                onClick={() => rotateMutation.mutate()}
                disabled={rotateMutation.isPending}
                className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {t('credentials.rotateConfirm')}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setRotating(true)} className="mt-2 self-start text-xs underline">
              {t('credentials.rotate')}
            </button>
          )}

          <ErrorMessage error={rotateMutation.error} />
        </div>
      )}
    </li>
  )
}
```

- [ ] **Step 6: Implement `CredentialsSection`**

`apps/web/src/vault/CredentialsSection.tsx`:

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { listCredentialsForClient, listPlatforms } from './api'
import { AddCredentialForm } from './AddCredentialForm'
import { CredentialRow } from './CredentialRow'
import { VaultUnlockGate } from './VaultUnlockGate'

export function CredentialsSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation('vault')

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('credentials.title')}</h2>
      <VaultUnlockGate>
        <CredentialsList clientId={clientId} />
      </VaultUnlockGate>
    </section>
  )
}

function CredentialsList({ clientId }: { clientId: string }) {
  const { t } = useTranslation('vault')
  const queryClient = useQueryClient()

  const credentials = useQuery({
    queryKey: ['credentials', clientId],
    queryFn: () => listCredentialsForClient(clientId),
  })
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: listPlatforms })

  function platformName(platformId: string): string {
    return platforms.data?.find((platform) => platform.id === platformId)?.name ?? platformId
  }

  return (
    <div className="flex flex-col gap-3">
      {credentials.isPending || platforms.isPending ? null : credentials.isError ? (
        <ErrorMessage error={credentials.error} />
      ) : credentials.data.length === 0 ? (
        <p className="text-sm text-slate-600">{t('credentials.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {credentials.data.map((credential) => (
            <CredentialRow
              key={credential.id}
              credential={credential}
              platformName={platformName(credential.platformId)}
              onRotated={() => queryClient.invalidateQueries({ queryKey: ['credentials', clientId] })}
            />
          ))}
        </ul>
      )}

      <AddCredentialForm
        clientId={clientId}
        platforms={platforms.data ?? []}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['credentials', clientId] })}
      />
    </div>
  )
}
```

- [ ] **Step 7: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- CredentialsSection`
Expected: PASS.

- [ ] **Step 8: Render it on `ClientDetailPage`**

Add to `apps/web/src/clients/ClientDetailPage.tsx`: import `CredentialsSection`
from `'../vault/CredentialsSection'` and render
`<CredentialsSection clientId={clientId} />` immediately after the existing
`<EmploymentSection ... />` line.

- [ ] **Step 9: Verify locale parity and run the full web suite**

Run: `pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web test`
Expected: both green.

- [ ] **Step 10: Typecheck and lint**

Run: `pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/vault/CredentialsSection.tsx apps/web/src/vault/CredentialRow.tsx \
  apps/web/src/vault/AddCredentialForm.tsx apps/web/src/vault/CredentialsSection.test.tsx \
  apps/web/src/clients/ClientDetailPage.tsx \
  apps/web/src/i18n/locales/pt/vault.json apps/web/src/i18n/locales/en/vault.json
git commit -m "feat(web): show per-client credentials with reveal, rotation and TOTP"
```

---
### Task 17: Offline cursor sync

**Files:**
- Create: `apps/web/src/vault/sync.ts`
- Create: `apps/web/src/vault/sync.test.ts`
- Create: `apps/web/src/vault/useVaultSync.ts`
- Modify: `apps/web/src/shell/AppLayout.tsx`

**Interfaces:**
- Consumes: `listPlatforms`, `syncCredentials` (Task 12); `getVaultMeta`, `putVaultMeta`, `putCachedCredentials`, `putCachedPlatforms` (Task 11); `useOnlineStatus` (Phase 0); `useSession` (Phase 0).
- Produces: `syncVault(): Promise<void>`, `useVaultSync(): void`.

`ConnectionStatus` (Phase 0) already renders a "last synchronised" time from
TanStack Query's own cache timestamps — generic across every query, credentials
included — so it needs no change here. This task only makes the offline
*cache* (IndexedDB, read when the network is down entirely) as fresh as
possible, by refreshing it opportunistically whenever the app is online.

- [ ] **Step 1: Write the sync tests**

`apps/web/src/vault/sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listPlatformsMock = vi.hoisted(() => vi.fn())
const syncCredentialsMock = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listPlatforms: listPlatformsMock, syncCredentials: syncCredentialsMock }))

const getVaultMetaMock = vi.hoisted(() => vi.fn())
const putVaultMetaMock = vi.hoisted(() => vi.fn())
const putCachedCredentialsMock = vi.hoisted(() => vi.fn())
const putCachedPlatformsMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({
  getVaultMeta: getVaultMetaMock,
  putVaultMeta: putVaultMetaMock,
  putCachedCredentials: putCachedCredentialsMock,
  putCachedPlatforms: putCachedPlatformsMock,
}))

const { syncVault } = await import('./sync')

describe('syncVault', () => {
  beforeEach(() => {
    listPlatformsMock.mockReset().mockResolvedValue([{ id: 'p1', name: 'X', url: null, authKind: 'PASSWORD' }])
    syncCredentialsMock.mockReset().mockResolvedValue([])
    getVaultMetaMock.mockReset()
    putVaultMetaMock.mockReset().mockResolvedValue(undefined)
    putCachedCredentialsMock.mockReset().mockResolvedValue(undefined)
    putCachedPlatformsMock.mockReset().mockResolvedValue(undefined)
  })

  it('syncs with no cursor on the very first run', async () => {
    getVaultMetaMock.mockResolvedValue(undefined)
    await syncVault()
    expect(syncCredentialsMock).toHaveBeenCalledWith(null)
    expect(putVaultMetaMock).not.toHaveBeenCalled() // nothing to update: no envelope cached yet
  })

  it('passes the cached lastSyncedAt as the cursor on later runs', async () => {
    getVaultMetaMock.mockResolvedValue({
      id: 'singleton',
      kdfSalt: 'AAAA',
      protectedVaultKey: 'BBBB',
      lastSyncedAt: '2026-09-01T00:00:00.000Z',
    })

    await syncVault()

    expect(syncCredentialsMock).toHaveBeenCalledWith('2026-09-01T00:00:00.000Z')
    expect(putVaultMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ kdfSalt: 'AAAA', protectedVaultKey: 'BBBB' }),
    )
  })

  it('caches every synced platform and credential', async () => {
    getVaultMetaMock.mockResolvedValue({ id: 'singleton', kdfSalt: 'A', protectedVaultKey: 'B', lastSyncedAt: null })
    syncCredentialsMock.mockResolvedValue([
      { id: 'c1', clientId: 'cl1', platformId: 'p1', label: 'x', updatedAt: '2026-09-10T00:00:00.000Z', ciphertext: 'AAAA', iv: 'BBBB' },
    ])

    await syncVault()

    expect(putCachedPlatformsMock).toHaveBeenCalledWith([{ id: 'p1', name: 'X', url: null, authKind: 'PASSWORD' }])
    expect(putCachedCredentialsMock).toHaveBeenCalledWith([
      { id: 'c1', clientId: 'cl1', platformId: 'p1', label: 'x', updatedAt: '2026-09-10T00:00:00.000Z', ciphertext: 'AAAA', iv: 'BBBB' },
    ])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- vault/sync`
Expected: FAIL — `./sync` does not exist.

- [ ] **Step 3: Implement `syncVault`**

`apps/web/src/vault/sync.ts`:

```ts
import { listPlatforms, syncCredentials } from './api'
import { getVaultMeta, putCachedCredentials, putCachedPlatforms, putVaultMeta } from './vault-db'

/**
 * Refreshes the IndexedDB cache: the current platform catalog in full (it is
 * small and plaintext, spec 6.4), and every credential changed since the
 * last successful sync (spec 9.6's cursor). Only ciphertext and metadata
 * ever pass through here — nothing is decrypted, so this needs no unlocked
 * vault key at all.
 */
export async function syncVault(): Promise<void> {
  const meta = await getVaultMeta()

  const platforms = await listPlatforms()
  await putCachedPlatforms(platforms.map((platform) => ({ ...platform })))

  const credentials = await syncCredentials(meta?.lastSyncedAt ?? null)
  await putCachedCredentials(credentials.map((credential) => ({ ...credential })))

  if (meta) {
    await putVaultMeta({ ...meta, lastSyncedAt: new Date().toISOString() })
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault/sync`
Expected: PASS.

- [ ] **Step 5: Wire it into the app**

`apps/web/src/vault/useVaultSync.ts`:

```ts
import { useEffect } from 'react'
import { useOnlineStatus } from '../shell/useOnlineStatus'
import { useSession } from '../auth/session'
import { syncVault } from './sync'

/** Opportunistic cache refresh: whenever the app is online with a session, catch the offline cache up. */
export function useVaultSync(): void {
  const online = useOnlineStatus()
  const session = useSession()
  const ready = online && session.isSuccess

  useEffect(() => {
    if (ready) syncVault().catch(() => {})
  }, [ready])
}
```

Add to `apps/web/src/shell/AppLayout.tsx`: import `useVaultSync` from
`'../vault/useVaultSync'` and call `useVaultSync()` once inside the
component body (its own effect handles everything; no return value is used).

- [ ] **Step 6: Run the full web suite, typecheck, lint**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/vault/sync.ts apps/web/src/vault/sync.test.ts \
  apps/web/src/vault/useVaultSync.ts apps/web/src/shell/AppLayout.tsx
git commit -m "feat(web): refresh the offline vault cache opportunistically while online"
```

---

### Task 18: Offline-queued audit trail for credential reveals

**Files:**
- Create: `packages/domain/src/schemas/audit.ts`, `audit.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/api/src/audit/audit.controller.ts`
- Modify: `apps/api/src/audit/audit.module.ts`
- Test: `apps/api/test/audit.integration.test.ts`
- Modify: `apps/web/src/vault/vault-db.ts`, `vault-db.test.ts`
- Create: `apps/web/src/vault/outbox.ts`, `outbox.test.ts`
- Modify: `apps/web/src/vault/CredentialRow.tsx`
- Modify: `apps/web/src/vault/useVaultSync.ts`

**Interfaces:**
- Consumes: `AuditService.record` (Phase 0, unused until now); `apiFetch` (Phase 0); `ZodValidationPipe`, `SessionGuard` (Phase 0).
- Produces: `POST /vault/audit-events`; `queueOutboxEvent`, `listOutboxEvents`, `deleteOutboxEvent` (extending `vault-db.ts`); `recordReveal`, `flushOutbox` (`apps/web/src/vault/outbox.ts`).

Spec 9.6 lists an `outbox` IndexedDB store specifically for "audit events for
offline decryption", queued and "uploaded when the network returns" — this
task is what makes that real. Every credential reveal (Task 16's
`CredentialRow`) queues an event; a flush attempt follows immediately
(succeeds when online, stays queued when not) and is retried whenever
`useVaultSync` (Task 17) next runs.

- [ ] **Step 1: Write the audit schema test**

`packages/domain/src/schemas/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createAuditEventSchema } from './audit'

describe('createAuditEventSchema', () => {
  it('accepts a credential-reveal event', () => {
    const result = createAuditEventSchema.safeParse({
      entityType: 'credential',
      entityId: 'c1',
      action: 'credential.revealed',
      metadata: {},
    })
    expect(result.success).toBe(true)
  })

  it('defaults metadata to an empty object', () => {
    const result = createAuditEventSchema.parse({ entityType: 'credential', entityId: 'c1', action: 'x' })
    expect(result.metadata).toEqual({})
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/domain test`
Expected: FAIL — `./audit` does not exist.

- [ ] **Step 3: Write the schema**

`packages/domain/src/schemas/audit.ts`:

```ts
import { z } from 'zod'

/**
 * Deliberately generic — `AuditEvent` (Phase 0) already models entityType /
 * entityId / action / metadata as free-form strings and JSON, and this is
 * its first HTTP-facing producer, not the reason to constrain it further.
 */
export const createAuditEventSchema = z
  .object({
    entityType: z.string().trim().min(1).max(50),
    entityId: z.string().trim().min(1).max(200),
    action: z.string().trim().min(1).max(100),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type CreateAuditEventInput = z.infer<typeof createAuditEventSchema>
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/domain test`
Expected: PASS.

- [ ] **Step 5: Export it**

Add to `packages/domain/src/index.ts`: `export * from './schemas/audit'`.

- [ ] **Step 6: Write the integration test**

`apps/api/test/audit.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app.js'
import { getTestPrisma, resetDatabase } from './database.js'
import { authenticate } from './authenticate.js'

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('audit events', () => {
  it('records a credential-reveal event', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/vault/audit-events')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {} })
      .expect(204)

    const events = await getTestPrisma().auditEvent.findMany()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed' })
  })

  it('rejects without a session', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/vault/audit-events')
      .set('X-Requested-With', 'ledger-hq')
      .send({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {} })
      .expect(401)
  })
})
```

- [ ] **Step 7: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: FAIL — `/vault/audit-events` does not exist.

- [ ] **Step 8: Implement the controller and wire it in**

`apps/api/src/audit/audit.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, UseGuards, UsePipes } from '@nestjs/common'
import { createAuditEventSchema } from '@ledger-hq/domain'
import type { CreateAuditEventInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AuditService } from './audit.service.js'

@Controller('vault/audit-events')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Post()
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(createAuditEventSchema))
  async record(@Body() body: CreateAuditEventInput): Promise<void> {
    await this.audit.record(body)
  }
}
```

Modify `apps/api/src/audit/audit.module.ts` to register it:

```ts
import { Module } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service.js'
import { AuditController } from './audit.controller.js'
import { AuditService } from './audit.service.js'

@Module({ controllers: [AuditController], providers: [AuditService, PrismaService], exports: [AuditService] })
export class AuditModule {}
```

`AuditModule` is already imported in `app.module.ts` (Phase 0) — no further
wiring needed there. Note `SessionGuard` comes from `AuthModule`, which
`AuditModule` does not currently import: add
`imports: [AuthModule]` to `audit.module.ts`'s `@Module` decorator (with the
matching `import { AuthModule } from '../auth/auth.module.js'`), matching
how `EmploymentsModule` and `VaultModule` already import it for the same
reason.

- [ ] **Step 9: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS.

- [ ] **Step 10: Extend `vault-db.ts` with the outbox store**

Add to the `VaultSchema` interface in `apps/web/src/vault/vault-db.ts`:

```ts
  outbox: { key: string; value: OutboxEvent }
```

Add the type and, inside `getDb`'s `upgrade` callback, the new store:

```ts
export type OutboxEvent = {
  id: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown>
  occurredAt: string
}
```

```ts
      db.createObjectStore('outbox', { keyPath: 'id' })
```

(add this line inside the existing `upgrade(db) { ... }` body, alongside the
`vaultMeta`/`credentials`/`platforms` stores — since this changes the
store set, bump the database version from `1` to `2` in the `openDB` call:
`openDB<VaultSchema>('ledger-hq-vault', 2, { upgrade(db, oldVersion) { ... } })`,
and guard each existing `createObjectStore` call with
`if (oldVersion < 1) { ... }` so a browser that already has version 1 does
not attempt to recreate stores that exist; wrap the new outbox store in
`if (oldVersion < 2) { ... }`.)

Add the three functions (after `listCachedPlatforms`):

```ts
export async function queueOutboxEvent(event: OutboxEvent): Promise<void> {
  const db = await getDb()
  await db.put('outbox', event)
}

export async function listOutboxEvents(): Promise<OutboxEvent[]> {
  const db = await getDb()
  return db.getAll('outbox')
}

export async function deleteOutboxEvent(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('outbox', id)
}
```

Add a test to `vault-db.test.ts`:

```ts
it('queues, lists and deletes outbox events', async () => {
  const event = { id: 'e1', entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {}, occurredAt: '2026-09-10T00:00:00.000Z' }
  await queueOutboxEvent(event)
  await expect(listOutboxEvents()).resolves.toEqual([event])

  await deleteOutboxEvent('e1')
  await expect(listOutboxEvents()).resolves.toEqual([])
})
```

(Add `queueOutboxEvent`, `listOutboxEvents`, `deleteOutboxEvent` to the
file's existing import from `./vault-db`.)

- [ ] **Step 11: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault-db`
Expected: PASS, including the new outbox case and every existing case
(confirming the version bump did not break the Task 11 stores).

- [ ] **Step 12: Write the outbox orchestration test**

`apps/web/src/vault/outbox.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch: apiFetchMock }))

const queueOutboxEventMock = vi.hoisted(() => vi.fn())
const listOutboxEventsMock = vi.hoisted(() => vi.fn())
const deleteOutboxEventMock = vi.hoisted(() => vi.fn())
vi.mock('./vault-db', () => ({
  queueOutboxEvent: queueOutboxEventMock,
  listOutboxEvents: listOutboxEventsMock,
  deleteOutboxEvent: deleteOutboxEventMock,
}))

const { flushOutbox, recordReveal } = await import('./outbox')

describe('outbox', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    queueOutboxEventMock.mockReset().mockResolvedValue(undefined)
    listOutboxEventsMock.mockReset()
    deleteOutboxEventMock.mockReset().mockResolvedValue(undefined)
  })

  it('recordReveal queues an event and flushes it when online', async () => {
    listOutboxEventsMock.mockResolvedValue([
      { id: 'e1', entityType: 'credential', entityId: 'c1', action: 'credential.revealed', metadata: {}, occurredAt: '2026-09-10T00:00:00.000Z' },
    ])
    apiFetchMock.mockResolvedValue(undefined)

    await recordReveal('c1')

    expect(queueOutboxEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'credential', entityId: 'c1', action: 'credential.revealed' }),
    )
    expect(apiFetchMock).toHaveBeenCalledWith('/vault/audit-events', expect.objectContaining({ method: 'POST' }))
    expect(deleteOutboxEventMock).toHaveBeenCalledWith('e1')
  })

  it('flushOutbox leaves an event queued when the request fails', async () => {
    listOutboxEventsMock.mockResolvedValue([
      { id: 'e2', entityType: 'credential', entityId: 'c2', action: 'credential.revealed', metadata: {}, occurredAt: '2026-09-10T00:00:00.000Z' },
    ])
    apiFetchMock.mockRejectedValue(new Error('offline'))

    await flushOutbox()

    expect(deleteOutboxEventMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 13: Run it, confirm it fails**

Run: `pnpm --filter @ledger-hq/web test -- vault/outbox`
Expected: FAIL — `./outbox` does not exist.

- [ ] **Step 14: Implement `outbox.ts`**

`apps/web/src/vault/outbox.ts`:

```ts
import { apiFetch } from '../api/client'
import { deleteOutboxEvent, listOutboxEvents, queueOutboxEvent } from './vault-db'

/** Queues a credential-reveal audit event durably, then attempts an immediate flush. */
export async function recordReveal(credentialId: string): Promise<void> {
  await queueOutboxEvent({
    id: crypto.randomUUID(),
    entityType: 'credential',
    entityId: credentialId,
    action: 'credential.revealed',
    metadata: {},
    occurredAt: new Date().toISOString(),
  })
  await flushOutbox()
}

/** Uploads every queued event; a failed one (offline, most commonly) stays queued for the next attempt. */
export async function flushOutbox(): Promise<void> {
  const events = await listOutboxEvents()

  for (const event of events) {
    try {
      await apiFetch('/vault/audit-events', {
        method: 'POST',
        body: { entityType: event.entityType, entityId: event.entityId, action: event.action, metadata: event.metadata },
      })
      await deleteOutboxEvent(event.id)
    } catch {
      // Left in the outbox; the next flush (the next reveal, or `useVaultSync`
      // once the network returns) retries it.
    }
  }
}
```

- [ ] **Step 15: Run it, confirm it passes**

Run: `pnpm --filter @ledger-hq/web test -- vault/outbox`
Expected: PASS.

- [ ] **Step 16: Wire reveal into the audit trail**

Modify `apps/web/src/vault/CredentialRow.tsx`'s `reveal` function to record
the event after a successful decrypt:

```ts
  async function reveal(): Promise<void> {
    if (vaultState.status !== 'unlocked') return
    const decrypted = await decryptCredentialItem(vaultState.key, fromBase64(credential.ciphertext), fromBase64(credential.iv))
    setItem(decrypted as CredentialItem)
    void recordReveal(credential.id)
  }
```

Add `import { recordReveal } from './outbox'` to the file's existing imports.
`recordReveal` runs fire-and-forget (`void`, not awaited) so a slow or
failed audit write never blocks or breaks revealing the credential itself —
the outbox is the durability mechanism, not this call site.

- [ ] **Step 17: Retry queued events whenever the app comes back online**

Modify `apps/web/src/vault/useVaultSync.ts` to also flush the outbox:

```ts
import { useEffect } from 'react'
import { useOnlineStatus } from '../shell/useOnlineStatus'
import { useSession } from '../auth/session'
import { flushOutbox } from './outbox'
import { syncVault } from './sync'

/** Opportunistic cache refresh and outbox flush: whenever online with a session, catch both up. */
export function useVaultSync(): void {
  const online = useOnlineStatus()
  const session = useSession()
  const ready = online && session.isSuccess

  useEffect(() => {
    if (ready) {
      syncVault().catch(() => {})
      flushOutbox().catch(() => {})
    }
  }, [ready])
}
```

- [ ] **Step 18: Run the full web suite, typecheck, lint**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web typecheck && pnpm --filter @ledger-hq/web lint`
Expected: all clean.

- [ ] **Step 19: Commit**

```bash
git add packages/domain/src/schemas/audit.ts packages/domain/src/schemas/audit.test.ts packages/domain/src/index.ts \
  apps/api/src/audit/audit.controller.ts apps/api/src/audit/audit.module.ts apps/api/test/audit.integration.test.ts \
  apps/web/src/vault/vault-db.ts apps/web/src/vault/vault-db.test.ts \
  apps/web/src/vault/outbox.ts apps/web/src/vault/outbox.test.ts \
  apps/web/src/vault/CredentialRow.tsx apps/web/src/vault/useVaultSync.ts
git commit -m "feat: audit credential reveals, queued offline and flushed on reconnect"
```

---
### Task 19: End-to-end vault test

**Files:**
- Create: `apps/web/e2e/vault-offline.spec.ts`

**Interfaces:**
- Consumes: the whole vault UI (Tasks 12-17), exercised end-to-end.
- Produces: the offline vault-unlock-and-read test spec 9.8 and section 12
  call out as the one that "prevents the system's central promise from
  breaking in a careless refactor."

- [ ] **Step 1: Write the spec**

`apps/web/e2e/vault-offline.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('sets up the vault, adds a credential, and reads it back with the network disabled', async ({ page, context }) => {
  await page.goto('/')

  // First run: bootstrap the account.
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  await page.getByLabel(/confirma/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /criar|entrar/i }).click()
  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // Register a client to attach a credential to.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442600')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText('Padaria Central, Lda.')).toBeVisible()

  // Set up the vault (re-enters the master password by design — see Task 12).
  await page.goto('/vault/setup')
  await page.getByLabel(/confirma a tua palavra-passe/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /continuar/i }).click()
  await expect(page.getByText(/-.*-.*-.*-.*-/)).toBeVisible() // the recovery code, dash-grouped
  await page.getByLabel(/anotei o código/i).check()
  await page.getByRole('button', { name: /continuar/i }).click()

  // Add a platform.
  await page.goto('/vault/platforms')
  await page.getByLabel(/^nome$/i).fill('Portal das Finanças')
  await page.getByRole('button', { name: /criar/i }).click()
  await expect(page.getByText('Portal das Finanças')).toBeVisible()

  // Add a credential on the client's page. The vault is already unlocked
  // from the setup flow above, in the same browser session.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central, Lda.' }).click()
  await page.getByLabel(/designação/i).fill('Acesso principal')
  await page.getByLabel(/utilizador/i).fill('509123456')
  await page.getByLabel(/^palavra-passe$/i).fill('correct horse battery staple')
  await page.getByRole('button', { name: /criar/i }).click()
  await expect(page.getByText(/portal das finanças/i)).toBeVisible()

  // Let the service worker precache the shell before going offline.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 })

  // Reload: this clears every in-memory JS singleton, including the
  // unlocked vault key — the only thing that survives is what was written
  // to IndexedDB and the Cache Storage precache. Then disable the network
  // entirely before unlocking again.
  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('status')).toContainText(/sem ligação ao servidor/i)
  await page.getByLabel(/palavra-passe mestra/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /desbloquear/i }).click()

  await page.getByRole('button', { name: /^ver$/i }).click()
  await expect(page.getByText('509123456')).toBeVisible()

  await context.setOffline(false)
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @ledger-hq/web test:e2e -- vault-offline`
Expected: PASS. If any selector does not match, this is where a plan brief's
guessed label text is corrected against the actual rendered copy — the same
class of fix `setup-and-clients.spec.ts` already documents inline (see its
`/confirma/i` comment) — not a reason to change the application code.

- [ ] **Step 3: Run the full test suite one more time**

Run: `pnpm turbo run lint typecheck build test`, then
`pnpm --filter @ledger-hq/api test:integration`, then
`pnpm --filter @ledger-hq/web test:e2e`.
Expected: everything green — this is the last task before the whole-branch
review.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/vault-offline.spec.ts
git commit -m "test(e2e): cover vault setup and offline credential read"
```

---
### Task 20: Documentation

**Files:**
- Modify: `docs/security-model.md`
- Create: `docs/adr/0005-recovery-code-verification.md`
- Modify: `README.md` (if it lists phase status)

**Interfaces:** none — this task changes no code.

`docs/security-model.md` currently describes the vault as "Phase 1 — design
only, not built" and carries three claims that Phase 1 makes false: stage 2
(`stretched`) is now consumed; the recovery-code warning it says ships
"ahead of the feature" now trails a real feature (Task 12 moved that copy to
`VaultSetupPage`); and "there is no password-reset flow of any kind, for
anyone" is no longer true for the master password specifically (Task 6/14's
recovery flow is exactly that, gated by the recovery code). It also carries
the residual inconsistency the Phase 0 whole-branch review parked rather
than fixed: office-machine theft is listed as mitigated in one section, a
paragraph above the honest correction that the same unencrypted plaintext
cache exposure applies to any lost or stolen device, laptop and office
machine included, not only a phone.

- [ ] **Step 1: Correct the "What is mitigated" section**

Replace:

```markdown
## What is mitigated

Theft of the office machine, theft of backup files, a database copy, disk
level access to the server. In every one of these the attacker holds
AES-256-GCM ciphertext (once the vault exists) and, even today, only an
Argon2id hash of a hash — never a password, never a key.
```

With:

```markdown
## What is mitigated

Theft of the office machine, theft of backup files, a database copy, disk
level access to the server. Every one of these hands the attacker
AES-256-GCM ciphertext for every vault credential, and an Argon2id hash of
a hash for login — never a password, never a key.

This does **not** extend to the plaintext client register cached for
offline reads — see the next section. An office machine and a lost phone
are exposed identically there; that cache is not part of what this section
covers.
```

- [ ] **Step 2: Correct the "What is not mitigated" section's device-theft bullet**

Replace the existing "A lost or stolen phone with cached client data"
bullet with:

```markdown
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
```

- [ ] **Step 3: Replace the "Stage 2 is unused" note**

Replace:

```markdown
**Stage 2 (`stretched`) is implemented but not yet consumed anywhere.** No
code path in this repository currently calls `deriveStretchedKey`'s result
for anything — it exists in `packages/crypto` ready for Phase 1, which will
use it to unwrap the vault key described below. Today, the login flow only
ever uses stages 1, 3 and 4.
```

With:

```markdown
**Stage 2 (`stretched`) unwraps the vault key.** `apps/web/src/vault/setup.ts`,
`unlock.ts` and `recover.ts` are the three places `deriveStretchedKey`'s
result is used — to wrap `protectedVaultKey` at setup, and to unwrap it on
every unlock. It never reaches the server and is held only for the
duration of these three operations.
```

- [ ] **Step 4: Replace the whole "vault" section**

Replace the entire `## The vault (Phase 1 — design only, not built)` section
— from that heading through the paragraph ending "there is no vault yet to
lose access to." (do not touch the final "Independently of the vault..."
paragraph yet — Step 5 handles it) — with:

```markdown
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
```

- [ ] **Step 5: Correct the final "no password reset" paragraph**

Replace:

```markdown
Independently of the vault, one thing is already true today and will
remain true after Phase 1 ships: **there is no password-reset flow of any
kind, for anyone.** This is a deliberate consequence of being a
single-user system with no email or SMS integration (see the design
spec's non-goals). Forgetting the master password today means the account
cannot be logged into again — there is nothing encrypted with it yet, so
nothing beyond access itself is lost, but that access is not recoverable
either. The spec is explicit that this is by design ("there is no reset
and no backdoor") rather than a gap Phase 1 is expected to close.
```

With:

```markdown
There is still no password-reset flow that does not require the recovery
code — that remains deliberate, a consequence of being a single-user
system with no email or SMS integration (see the design spec's
non-goals). Forgetting the master password *and* losing the recovery code
together is unrecoverable, by design: nothing server-side can stand in
for either, because the server never has enough information to
reconstruct `vaultKey` on its own. What Phase 1 changes is that forgetting
*just* the master password is no longer permanent, provided the recovery
code was kept — see "Recovery, not just reset" above.
```

- [ ] **Step 6: Write the ADR**

`docs/adr/0005-recovery-code-verification.md`:

```markdown
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
```

- [ ] **Step 7: Check `README.md` for a phase-status line**

If `README.md` states Phase 0 is the current/only implemented phase, update
that line to mention Phase 1 (Vault) is also implemented. If it names no
phase status at all, skip this step — nothing to correct.

- [ ] **Step 8: Commit**

```bash
git add docs/security-model.md docs/adr/0005-recovery-code-verification.md README.md
git commit -m "docs: describe the vault and recovery mechanism as built, not designed"
```

---

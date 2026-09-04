# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a self-hosted, installable, bilingual PWA with authentication and a complete client register — companies, individuals, fiscal profiles and employment links — on top of a monorepo with CI, containers and backups.

**Architecture:** A pnpm/Turborepo monorepo holds a NestJS + Prisma + PostgreSQL API and a React + Vite PWA, sharing a `domain` package (types, Zod schemas, validation rules) and a `crypto` package (key derivation). Authentication already uses the final zero-knowledge scheme — the browser derives an auth hash from the master password and the server never sees the password itself — so Phase 1 adds the vault envelope without reworking login.

**Tech Stack:** TypeScript 5.6+, Node 22 LTS, pnpm 9, Turborepo, NestJS 10, Prisma 5, PostgreSQL 16, React 19, Vite 6, TanStack Router + Query, Tailwind CSS 4, i18next, hash-wasm, Vitest, Testcontainers, Playwright, Docker Compose, Caddy.

**Spec:** `docs/superpowers/specs/2026-09-04-ledger-hq-design.md`

## Global Constraints

Every task inherits these. Values are copied verbatim from the spec.

- **Language:** all code, comments, identifiers, commit messages and documentation in English. User-facing strings live in locale files, never in source.
- **Money:** integer cents (`amountCents Int`). Never floating point. Currency fixed to EUR.
- **Dates:** `date` columns for deadlines and periods; `timestamptz` for events. Application timezone `Europe/Lisbon`.
- **Identifiers:** UUIDv7 for all primary keys.
- **Deletion:** only `Client` is soft-deletable, via `archivedAt`. Nothing else is deleted.
- **API responses never contain human-readable prose.** Errors return `{ error: { code, params } }`; the frontend translates.
- **Locales:** `pt-PT` (default) and `en-GB`. Both bundles are precached, never lazily fetched.
- **KDF parameters:** Argon2id `m = 65536 KiB (64 MiB)`, `t = 3`, `p = 1`, 32-byte output. This is the safe ceiling for Safari on iPhone and must not be raised.
- **Secrets never logged.** Request bodies for auth and vault routes, `authHash`, `ciphertext` and authorization headers are redacted.
- **Module boundaries:** `clients` is the core. `vault`, `obligations` and `billing` never import from one another. Cross-module reads belong in `reporting`.
- **TDD:** every task writes a failing test first, watches it fail, then implements.

## Decisions this plan makes that the spec left open

- **Styling: Tailwind CSS 4.** The spec did not name a styling approach. Tailwind is chosen because it needs no runtime, adds no external stylesheet (which the CSP forbids), and keeps component files self-contained.
- **Argon2id implementation: `hash-wasm`.** One WASM package that runs identically in Node and the browser, avoiding a native build step in Docker and a second implementation to keep in sync.
- **Zod validation pipe is hand-written** rather than pulled from `nestjs-zod`, because it is fifteen lines and must emit our error-code shape rather than prose.
- **Phase 0 includes key derivation** (`packages/crypto`), though the spec assigns crypto to Phase 1. Login needs `authHash` derivation on day one; building a throwaway password login first would mean a migration and a second auth implementation.

## File structure

```
ledger-hq/
├── package.json                          workspace root, scripts
├── pnpm-workspace.yaml
├── turbo.json
├── .github/workflows/ci.yml
├── packages/
│   ├── config/
│   │   ├── tsconfig.base.json
│   │   ├── eslint.config.js
│   │   └── package.json
│   ├── domain/
│   │   └── src/
│   │       ├── index.ts                  public surface
│   │       ├── errors.ts                 ErrorCode union + AppError
│   │       ├── enums.ts                  ClientKind, LegalForm, Accounting, VatRegime, IncomeTax
│   │       ├── identifiers/
│   │       │   ├── nif.ts                Portuguese tax number check digit
│   │       │   └── niss.ts               social security number format
│   │       └── schemas/
│   │           ├── auth.ts               login, bootstrap
│   │           ├── client.ts             create/update client
│   │           ├── fiscal-profile.ts     profile, kind-dependent rules
│   │           └── employment.ts         create/end employment
│   └── crypto/
│       └── src/
│           ├── index.ts
│           ├── params.ts                 KDF_PARAMS
│           └── derive.ts                 master key, stretched key, auth hash
├── apps/
│   ├── api/
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/migrations/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── prisma.service.ts
│   │   │   │   ├── zod-validation.pipe.ts
│   │   │   │   ├── app-error.filter.ts
│   │   │   │   └── logger.ts             pino config with redaction
│   │   │   ├── auth/                     bootstrap, login, session guard
│   │   │   ├── clients/                  client CRUD
│   │   │   ├── fiscal-profiles/          profile upsert
│   │   │   ├── employments/              employment spells
│   │   │   └── audit/                    audit event writer
│   │   └── test/                         integration tests + container setup
│   └── web/
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── router.tsx
│       │   ├── api/client.ts             fetch wrapper, error-code mapping
│       │   ├── i18n/
│       │   │   ├── index.ts              i18next init
│       │   │   ├── format.ts             Intl wrappers
│       │   │   └── locales/{pt,en}/*.json
│       │   ├── auth/                     login page, session hook
│       │   ├── clients/                  list, detail, forms
│       │   ├── employments/              employment sections
│       │   └── shell/                    layout, nav, connection status
│       └── e2e/                          Playwright specs
├── docker/
│   ├── Dockerfile.api
│   ├── Dockerfile.web
│   ├── Caddyfile
│   └── backup.sh
├── docker-compose.yml
└── docs/
```

---

### Task 1: Monorepo foundation and CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.nvmrc`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/eslint.config.js`
- Create: `.github/workflows/ci.yml`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. A `@ledger-hq/config` package exporting `tsconfig.base.json` and a flat ESLint config. A `@ledger-hq/domain` package that later tasks extend.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "ledger-hq",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "prettier": "^3.3.3",
    "turbo": "^2.1.3",
    "typescript": "^5.6.3"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] }
  }
}
```

`.nvmrc`:

```
22
```

`.gitignore`:

```
node_modules/
dist/
.turbo/
*.log
.env
.env.*
!.env.example
coverage/
playwright-report/
test-results/
```

- [ ] **Step 2: Create the shared config package**

`packages/config/package.json`:

```json
{
  "name": "@ledger-hq/config",
  "version": "0.0.0",
  "private": true,
  "files": ["tsconfig.base.json", "eslint.config.js"],
  "main": "eslint.config.js"
}
```

`packages/config/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`packages/config/eslint.config.js`:

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  { ignores: ['dist/**', 'node_modules/**', '**/*.config.js'] },
)
```

Install its dependencies at the root:

```bash
pnpm add -Dw @eslint/js eslint typescript-eslint
```

- [ ] **Step 3: Create the domain package with one failing test**

`packages/domain/package.json`:

```json
{
  "name": "@ledger-hq/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "@ledger-hq/config": "workspace:*", "vitest": "^2.1.2" }
}
```

`packages/domain/tsconfig.json`:

```json
{
  "extends": "@ledger-hq/config/tsconfig.base.json",
  "include": ["src"]
}
```

`packages/domain/src/index.ts`:

```ts
export const DOMAIN_PACKAGE_NAME = '@ledger-hq/domain'
```

`packages/domain/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DOMAIN_PACKAGE_NAME } from './index'

describe('domain package', () => {
  it('is wired into the workspace', () => {
    expect(DOMAIN_PACKAGE_NAME).toBe('@ledger-hq/domain')
  })
})
```

- [ ] **Step 4: Run the toolchain end to end**

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all three succeed, with one passing test in `@ledger-hq/domain`. If `pnpm test` reports "no test files", the `vitest` dependency or the `test` script is missing.

- [ ] **Step 5: Add the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with shared config and CI"
```

---

### Task 2: Domain enumerations and error codes

**Files:**
- Create: `packages/domain/src/enums.ts`
- Create: `packages/domain/src/errors.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/errors.test.ts`

**Interfaces:**
- Consumes: the `@ledger-hq/domain` package from Task 1.
- Produces:
  - `ClientKind`, `LegalForm`, `Accounting`, `VatRegime`, `IncomeTax` — const objects plus matching union types, and a `*_VALUES` array for each.
  - `ERROR_CODES: readonly string[]`, `type ErrorCode`, and
    `class AppError extends Error { code: ErrorCode; params: Record<string, unknown>; status: number }`.

- [ ] **Step 1: Write the failing test**

`packages/domain/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AppError, ERROR_CODES } from './errors'
import { CLIENT_KIND_VALUES } from './enums'

describe('AppError', () => {
  it('carries a machine code, params and an HTTP status', () => {
    const error = new AppError('clients.tax_id_taken', { taxId: '501442600' }, 409)

    expect(error.code).toBe('clients.tax_id_taken')
    expect(error.params).toEqual({ taxId: '501442600' })
    expect(error.status).toBe(409)
  })

  it('defaults to a 400 status and no params', () => {
    const error = new AppError('common.validation_failed')

    expect(error.status).toBe(400)
    expect(error.params).toEqual({})
  })

  it('never exposes prose to the caller', () => {
    const error = new AppError('auth.invalid_credentials')

    expect(error.message).toBe('auth.invalid_credentials')
  })
})

describe('error code registry', () => {
  it('has no duplicates', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})

describe('enumerations', () => {
  it('exposes both client kinds', () => {
    expect(CLIENT_KIND_VALUES).toEqual(['COMPANY', 'INDIVIDUAL'])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @ledger-hq/domain test`
Expected: FAIL — `Cannot find module './errors'`.

- [ ] **Step 3: Implement the enumerations**

`packages/domain/src/enums.ts`:

```ts
export const CLIENT_KIND_VALUES = ['COMPANY', 'INDIVIDUAL'] as const
export type ClientKind = (typeof CLIENT_KIND_VALUES)[number]

/**
 * Corporate legal forms only. A Portuguese sole trader is an INDIVIDUAL client
 * with an open activity, not a legal form — see the design spec, section 6.2.
 */
export const LEGAL_FORM_VALUES = [
  'LDA',
  'UNIPESSOAL_LDA',
  'SA',
  'ASSOCIATION',
  'OTHER',
] as const
export type LegalForm = (typeof LEGAL_FORM_VALUES)[number]

export const ACCOUNTING_VALUES = ['ORGANIZED', 'SIMPLIFIED'] as const
export type Accounting = (typeof ACCOUNTING_VALUES)[number]

export const VAT_REGIME_VALUES = [
  'MONTHLY',
  'QUARTERLY',
  'EXEMPT',
  'NOT_APPLICABLE',
] as const
export type VatRegime = (typeof VAT_REGIME_VALUES)[number]

export const INCOME_TAX_VALUES = [
  'CIT',
  'PIT_CATEGORY_B',
  'PIT_EMPLOYMENT_ONLY',
] as const
export type IncomeTax = (typeof INCOME_TAX_VALUES)[number]
```

- [ ] **Step 4: Implement the error registry**

`packages/domain/src/errors.ts`:

```ts
/**
 * Every error the API can return. The API never sends prose: the frontend
 * maps these codes to translated messages.
 */
export const ERROR_CODES = [
  'common.validation_failed',
  'common.not_found',
  'auth.invalid_credentials',
  'auth.already_bootstrapped',
  'auth.not_bootstrapped',
  'auth.session_expired',
  'clients.tax_id_taken',
  'clients.archived',
  'fiscal_profile.open_activity_required_for_company',
  'fiscal_profile.vat_regime_requires_open_activity',
  'fiscal_profile.income_tax_incompatible_with_kind',
  'fiscal_profile.employees_flag_not_allowed_for_individual',
  'employment.employer_must_be_company',
  'employment.employee_must_be_individual',
  'employment.self_employment',
  'employment.overlapping_spell',
  'employment.ended_before_started',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class AppError extends Error {
  readonly code: ErrorCode
  readonly params: Record<string, unknown>
  readonly status: number

  constructor(
    code: ErrorCode,
    params: Record<string, unknown> = {},
    status = 400,
  ) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.params = params
    this.status = status
  }
}
```

- [ ] **Step 5: Export from the package entry point**

`packages/domain/src/index.ts`:

```ts
export * from './enums'
export * from './errors'
```

Delete `packages/domain/src/index.test.ts` — Task 1's placeholder test has served its purpose and is now covered by real tests.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @ledger-hq/domain test`
Expected: PASS, four tests.

- [ ] **Step 7: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): add client enumerations and the error-code registry"
```

---

### Task 3: Portuguese identifier validation

**Files:**
- Create: `packages/domain/src/identifiers/nif.ts`
- Create: `packages/domain/src/identifiers/niss.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/identifiers/nif.test.ts`, `packages/domain/src/identifiers/niss.test.ts`

**Interfaces:**
- Consumes: nothing beyond Task 2's package.
- Produces: `isValidNif(value: string): boolean` and `isValidNissFormat(value: string): boolean`.

**Why the two differ in strictness:** the NIF check digit is a well-documented modulo-11 algorithm that can be verified by hand, so it is validated fully. The NISS check digit is validated only for shape here, because a wrong implementation would silently reject real numbers, and the check-digit algorithm should be confirmed against a real number the product owner holds before being enforced.

- [ ] **Step 1: Write the failing NIF test**

`packages/domain/src/identifiers/nif.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isValidNif } from './nif'

describe('isValidNif', () => {
  // Check digit: sum(digit[i] * (9 - i)) for i in 0..7, mod 11.
  // A remainder below 2 means a check digit of 0, otherwise 11 - remainder.
  it.each([
    ['123456789', 'individual, remainder 2, check digit 9'],
    ['501442600', 'company, remainder 1, check digit 0'],
    ['999999990', 'remainder 0, check digit 0'],
  ])('accepts %s (%s)', (value) => {
    expect(isValidNif(value)).toBe(true)
  })

  it('rejects a wrong check digit', () => {
    expect(isValidNif('123456788')).toBe(false)
  })

  it.each([
    ['12345678', 'too short'],
    ['1234567890', 'too long'],
    ['12345678a', 'not all digits'],
    ['', 'empty'],
    ['423456789', 'first digit outside the assigned ranges'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidNif(value)).toBe(false)
  })

  it('ignores surrounding whitespace', () => {
    expect(isValidNif('  123456789  ')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/domain test nif`
Expected: FAIL — `Cannot find module './nif'`.

- [ ] **Step 3: Implement the NIF validator**

`packages/domain/src/identifiers/nif.ts`:

```ts
/** First digits assigned by the Portuguese tax authority. */
const ASSIGNED_FIRST_DIGITS = new Set(['1', '2', '3', '5', '6', '7', '8', '9'])

/**
 * Validates a Portuguese tax identification number (NIF).
 *
 * Nine digits, where the ninth is a modulo-11 check digit over the first
 * eight weighted 9 down to 2.
 */
export function isValidNif(value: string): boolean {
  const nif = value.trim()

  if (!/^\d{9}$/.test(nif)) return false

  const firstDigit = nif[0]
  if (firstDigit === undefined || !ASSIGNED_FIRST_DIGITS.has(firstDigit)) {
    return false
  }

  let sum = 0
  for (let index = 0; index < 8; index += 1) {
    sum += Number(nif[index]) * (9 - index)
  }

  const remainder = sum % 11
  const checkDigit = remainder < 2 ? 0 : 11 - remainder

  return checkDigit === Number(nif[8])
}
```

- [ ] **Step 4: Run the NIF tests**

Run: `pnpm --filter @ledger-hq/domain test nif`
Expected: PASS, nine cases.

- [ ] **Step 5: Write the failing NISS test**

`packages/domain/src/identifiers/niss.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isValidNissFormat } from './niss'

describe('isValidNissFormat', () => {
  it('accepts an eleven-digit number beginning with 1 (natural person)', () => {
    expect(isValidNissFormat('11234567890')).toBe(true)
  })

  it('accepts an eleven-digit number beginning with 2 (legal person)', () => {
    expect(isValidNissFormat('21234567890')).toBe(true)
  })

  it.each([
    ['1123456789', 'ten digits'],
    ['112345678901', 'twelve digits'],
    ['31234567890', 'unassigned leading digit'],
    ['1123456789a', 'not all digits'],
    ['', 'empty'],
  ])('rejects %s (%s)', (value) => {
    expect(isValidNissFormat(value)).toBe(false)
  })

  it('ignores surrounding whitespace', () => {
    expect(isValidNissFormat(' 11234567890 ')).toBe(true)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/domain test niss`
Expected: FAIL — `Cannot find module './niss'`.

- [ ] **Step 7: Implement the NISS format check**

`packages/domain/src/identifiers/niss.ts`:

```ts
/**
 * Validates the shape of a Portuguese social security number (NISS):
 * eleven digits beginning with 1 (natural person) or 2 (legal person).
 *
 * The check digit is deliberately not enforced. Getting that algorithm wrong
 * would reject valid numbers, which is worse than accepting a mistyped one in
 * a single-user system where the owner sees the value on screen.
 */
export function isValidNissFormat(value: string): boolean {
  return /^[12]\d{10}$/.test(value.trim())
}
```

- [ ] **Step 8: Export and run the whole suite**

Add to `packages/domain/src/index.ts`:

```ts
export * from './enums'
export * from './errors'
export * from './identifiers/nif'
export * from './identifiers/niss'
```

Run: `pnpm --filter @ledger-hq/domain test`
Expected: PASS, all tests.

- [ ] **Step 9: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): validate Portuguese tax and social security numbers"
```

---

### Task 4: Shared validation schemas

**Files:**
- Create: `packages/domain/src/schemas/common.ts`
- Create: `packages/domain/src/schemas/client.ts`
- Create: `packages/domain/src/schemas/fiscal-profile.ts`
- Create: `packages/domain/src/schemas/employment.ts`
- Create: `packages/domain/src/schemas/auth.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/schemas/client.test.ts`, `packages/domain/src/schemas/fiscal-profile.test.ts`, `packages/domain/src/schemas/employment.test.ts`

**Interfaces:**
- Consumes: `isValidNif`, `isValidNissFormat`, the enum value arrays, `ErrorCode`.
- Produces:
  - `isoDateSchema`, `base64Schema`
  - `createClientSchema`, `updateClientSchema`, `type CreateClientInput`, `type UpdateClientInput`
  - `fiscalProfileInputSchema`, `type FiscalProfileInput`,
    `checkFiscalProfileConsistency(kind: ClientKind, input: FiscalProfileInput): ErrorCode[]`
  - `createEmploymentSchema`, `endEmploymentSchema`, `type CreateEmploymentInput`, `type EndEmploymentInput`
  - `bootstrapSchema`, `loginSchema`, `type BootstrapInput`, `type LoginInput`

**Design note:** shape rules (which fields exist for which client kind) live in the Zod schemas, expressed as a discriminated union. Cross-field rules that need the client's kind — which the payload does not carry — live in `checkFiscalProfileConsistency`, a pure function called by both the API and the browser form, so one rule produces one message on both sides.

- [ ] **Step 1: Write the failing client schema test**

`packages/domain/src/schemas/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createClientSchema } from './client'

const company = {
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
} as const

const individual = {
  kind: 'INDIVIDUAL',
  name: 'Maria Santos',
  taxId: '123456789',
  accounting: 'SIMPLIFIED',
} as const

describe('createClientSchema', () => {
  it('accepts a company with a legal form', () => {
    expect(createClientSchema.safeParse(company).success).toBe(true)
  })

  it('accepts an individual with optional personal fields', () => {
    const result = createClientSchema.safeParse({
      ...individual,
      socialSecurityNo: '11234567890',
      dateOfBirth: '1980-07-14',
    })

    expect(result.success).toBe(true)
  })

  it('rejects a company without a legal form', () => {
    const { legalForm: _omitted, ...withoutLegalForm } = company

    expect(createClientSchema.safeParse(withoutLegalForm).success).toBe(false)
  })

  it('rejects a legal form on an individual', () => {
    const result = createClientSchema.safeParse({ ...individual, legalForm: 'LDA' })

    expect(result.success).toBe(false)
  })

  it('rejects personal fields on a company', () => {
    const result = createClientSchema.safeParse({
      ...company,
      socialSecurityNo: '11234567890',
    })

    expect(result.success).toBe(false)
  })

  it('rejects an invalid tax number', () => {
    expect(createClientSchema.safeParse({ ...company, taxId: '501442601' }).success).toBe(false)
  })

  it('trims the name and rejects an empty one', () => {
    const parsed = createClientSchema.parse({ ...company, name: '  Padaria  ' })
    expect(parsed.name).toBe('Padaria')

    expect(createClientSchema.safeParse({ ...company, name: '   ' }).success).toBe(false)
  })

  it('rejects a malformed date of birth', () => {
    const result = createClientSchema.safeParse({ ...individual, dateOfBirth: '14/07/1980' })

    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/domain test client`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 3: Implement the common and client schemas**

`packages/domain/src/schemas/common.ts`:

```ts
import { z } from 'zod'

/** A calendar date with no time and no zone, as stored in `date` columns. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'common.validation_failed')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'common.validation_failed',
  })

export const base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)

export const uuidSchema = z.string().uuid()
```

`packages/domain/src/schemas/client.ts`:

```ts
import { z } from 'zod'
import { ACCOUNTING_VALUES, LEGAL_FORM_VALUES } from '../enums'
import { isValidNif } from '../identifiers/nif'
import { isValidNissFormat } from '../identifiers/niss'
import { isoDateSchema } from './common'

const sharedFields = {
  name: z.string().trim().min(1).max(200),
  taxId: z
    .string()
    .trim()
    .refine(isValidNif, { message: 'common.validation_failed' }),
  accounting: z.enum(ACCOUNTING_VALUES),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(5000).optional(),
}

const companySchema = z
  .object({
    kind: z.literal('COMPANY'),
    legalForm: z.enum(LEGAL_FORM_VALUES),
    ...sharedFields,
  })
  .strict()

const individualSchema = z
  .object({
    kind: z.literal('INDIVIDUAL'),
    socialSecurityNo: z
      .string()
      .trim()
      .refine(isValidNissFormat, { message: 'common.validation_failed' })
      .optional(),
    dateOfBirth: isoDateSchema.optional(),
    ...sharedFields,
  })
  .strict()

export const createClientSchema = z.discriminatedUnion('kind', [
  companySchema,
  individualSchema,
])

/** The client kind is immutable: changing it would invalidate history. */
export const updateClientSchema = z.discriminatedUnion('kind', [
  companySchema.partial().required({ kind: true }),
  individualSchema.partial().required({ kind: true }),
])

export type CreateClientInput = z.infer<typeof createClientSchema>
export type UpdateClientInput = z.infer<typeof updateClientSchema>
```

- [ ] **Step 4: Run the client tests**

Run: `pnpm --filter @ledger-hq/domain test client`
Expected: PASS, eight cases.

- [ ] **Step 5: Write the failing fiscal profile test**

`packages/domain/src/schemas/fiscal-profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkFiscalProfileConsistency, fiscalProfileInputSchema } from './fiscal-profile'
import type { FiscalProfileInput } from './fiscal-profile'

const companyProfile: FiscalProfileInput = {
  hasOpenActivity: true,
  vatRegime: 'QUARTERLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: true,
  isVatCashBasis: false,
  startedAt: '2020-01-01',
}

const employeeProfile: FiscalProfileInput = {
  hasOpenActivity: false,
  vatRegime: 'NOT_APPLICABLE',
  incomeTax: 'PIT_EMPLOYMENT_ONLY',
  hasEmployees: false,
  hasWithholding: false,
  isVatCashBasis: false,
  startedAt: '2021-03-01',
}

const sideActivityProfile: FiscalProfileInput = {
  ...employeeProfile,
  hasOpenActivity: true,
  vatRegime: 'QUARTERLY',
  incomeTax: 'PIT_CATEGORY_B',
}

describe('fiscalProfileInputSchema', () => {
  it('accepts a well-formed profile', () => {
    expect(fiscalProfileInputSchema.safeParse(companyProfile).success).toBe(true)
  })

  it('rejects an unknown VAT regime', () => {
    const result = fiscalProfileInputSchema.safeParse({ ...companyProfile, vatRegime: 'YEARLY' })

    expect(result.success).toBe(false)
  })
})

describe('checkFiscalProfileConsistency', () => {
  it('accepts a company profile', () => {
    expect(checkFiscalProfileConsistency('COMPANY', companyProfile)).toEqual([])
  })

  it('accepts an employee with no activity of their own', () => {
    expect(checkFiscalProfileConsistency('INDIVIDUAL', employeeProfile)).toEqual([])
  })

  it('accepts an employee who also invoices independently', () => {
    expect(checkFiscalProfileConsistency('INDIVIDUAL', sideActivityProfile)).toEqual([])
  })

  it('requires open activity on a company', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', {
      ...companyProfile,
      hasOpenActivity: false,
    })

    expect(errors).toContain('fiscal_profile.open_activity_required_for_company')
  })

  it('requires a VAT regime of NOT_APPLICABLE without open activity', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      vatRegime: 'QUARTERLY',
    })

    expect(errors).toContain('fiscal_profile.vat_regime_requires_open_activity')
  })

  it('rejects corporate income tax on an individual', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      incomeTax: 'CIT',
    })

    expect(errors).toContain('fiscal_profile.income_tax_incompatible_with_kind')
  })

  it('rejects personal income tax on a company', () => {
    const errors = checkFiscalProfileConsistency('COMPANY', {
      ...companyProfile,
      incomeTax: 'PIT_CATEGORY_B',
    })

    expect(errors).toContain('fiscal_profile.income_tax_incompatible_with_kind')
  })

  it('rejects the employees flag on an individual', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      hasEmployees: true,
    })

    expect(errors).toContain('fiscal_profile.employees_flag_not_allowed_for_individual')
  })

  it('reports every violation, not just the first', () => {
    const errors = checkFiscalProfileConsistency('INDIVIDUAL', {
      ...employeeProfile,
      incomeTax: 'CIT',
      hasEmployees: true,
    })

    expect(errors).toHaveLength(2)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/domain test fiscal-profile`
Expected: FAIL — `Cannot find module './fiscal-profile'`.

- [ ] **Step 7: Implement the fiscal profile schema and consistency rules**

`packages/domain/src/schemas/fiscal-profile.ts`:

```ts
import { z } from 'zod'
import { INCOME_TAX_VALUES, VAT_REGIME_VALUES } from '../enums'
import type { ClientKind } from '../enums'
import type { ErrorCode } from '../errors'
import { isoDateSchema } from './common'

export const fiscalProfileInputSchema = z
  .object({
    hasOpenActivity: z.boolean(),
    vatRegime: z.enum(VAT_REGIME_VALUES),
    incomeTax: z.enum(INCOME_TAX_VALUES),
    hasEmployees: z.boolean(),
    hasWithholding: z.boolean(),
    isVatCashBasis: z.boolean(),
    startedAt: isoDateSchema,
  })
  .strict()

export type FiscalProfileInput = z.infer<typeof fiscalProfileInputSchema>

/**
 * Rules that depend on the client's kind, which the payload does not carry.
 * Returns every violation so a form can highlight all of them at once.
 */
export function checkFiscalProfileConsistency(
  kind: ClientKind,
  input: FiscalProfileInput,
): ErrorCode[] {
  const errors: ErrorCode[] = []

  if (kind === 'COMPANY' && !input.hasOpenActivity) {
    errors.push('fiscal_profile.open_activity_required_for_company')
  }

  if (!input.hasOpenActivity && input.vatRegime !== 'NOT_APPLICABLE') {
    errors.push('fiscal_profile.vat_regime_requires_open_activity')
  }

  const corporateTax = input.incomeTax === 'CIT'
  if (corporateTax !== (kind === 'COMPANY')) {
    errors.push('fiscal_profile.income_tax_incompatible_with_kind')
  }

  if (kind === 'INDIVIDUAL' && input.hasEmployees) {
    errors.push('fiscal_profile.employees_flag_not_allowed_for_individual')
  }

  return errors
}
```

- [ ] **Step 8: Run the fiscal profile tests**

Run: `pnpm --filter @ledger-hq/domain test fiscal-profile`
Expected: PASS, eleven cases.

- [ ] **Step 9: Write the failing employment test**

`packages/domain/src/schemas/employment.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createEmploymentSchema, endEmploymentSchema } from './employment'

const employerId = '0192f1a0-0000-7000-8000-000000000001'
const employeeId = '0192f1a0-0000-7000-8000-000000000002'

const spell = { employerId, employeeId, startedOn: '2024-01-15' }

describe('createEmploymentSchema', () => {
  it('accepts an open-ended spell', () => {
    expect(createEmploymentSchema.safeParse(spell).success).toBe(true)
  })

  it('accepts a closed spell with a job title', () => {
    const result = createEmploymentSchema.safeParse({
      ...spell,
      endedOn: '2025-06-30',
      jobTitle: 'Bookkeeper',
    })

    expect(result.success).toBe(true)
  })

  it('rejects an end date before the start date', () => {
    const result = createEmploymentSchema.safeParse({ ...spell, endedOn: '2023-12-31' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('employment.ended_before_started')
  })

  it('accepts an end date equal to the start date', () => {
    expect(createEmploymentSchema.safeParse({ ...spell, endedOn: '2024-01-15' }).success).toBe(true)
  })

  it('rejects somebody employing themselves', () => {
    const result = createEmploymentSchema.safeParse({ ...spell, employeeId: employerId })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('employment.self_employment')
  })

  it('rejects a non-uuid identifier', () => {
    expect(createEmploymentSchema.safeParse({ ...spell, employerId: 'abc' }).success).toBe(false)
  })
})

describe('endEmploymentSchema', () => {
  it('accepts a termination date', () => {
    expect(endEmploymentSchema.safeParse({ endedOn: '2026-03-31' }).success).toBe(true)
  })

  it('rejects a missing date', () => {
    expect(endEmploymentSchema.safeParse({}).success).toBe(false)
  })
})
```

- [ ] **Step 10: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/domain test employment`
Expected: FAIL — `Cannot find module './employment'`.

- [ ] **Step 11: Implement the employment schemas**

`packages/domain/src/schemas/employment.ts`:

```ts
import { z } from 'zod'
import { isoDateSchema, uuidSchema } from './common'

export const createEmploymentSchema = z
  .object({
    employerId: uuidSchema,
    employeeId: uuidSchema,
    startedOn: isoDateSchema,
    endedOn: isoDateSchema.optional(),
    jobTitle: z.string().trim().max(120).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.employerId === value.employeeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['employeeId'],
        message: 'employment.self_employment',
      })
    }

    if (value.endedOn !== undefined && value.endedOn < value.startedOn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedOn'],
        message: 'employment.ended_before_started',
      })
    }
  })

export const endEmploymentSchema = z.object({ endedOn: isoDateSchema }).strict()

export type CreateEmploymentInput = z.infer<typeof createEmploymentSchema>
export type EndEmploymentInput = z.infer<typeof endEmploymentSchema>
```

ISO dates compare correctly as strings, which is why `value.endedOn < value.startedOn` is sound here.

- [ ] **Step 12: Add the auth schemas**

`packages/domain/src/schemas/auth.ts`:

```ts
import { z } from 'zod'
import { base64Schema } from './common'

/** 32 bytes, base64: 43 characters plus one '=' of padding. */
const derivedKeySchema = base64Schema.length(44)

/** 16 bytes, base64: 22 characters plus two '=' of padding. */
const saltSchema = base64Schema.length(24)

export const bootstrapSchema = z
  .object({
    email: z.string().trim().email().max(200),
    kdfSalt: saltSchema,
    authHash: derivedKeySchema,
    locale: z.enum(['pt-PT', 'en-GB']),
  })
  .strict()

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(200),
    authHash: derivedKeySchema,
  })
  .strict()

export type BootstrapInput = z.infer<typeof bootstrapSchema>
export type LoginInput = z.infer<typeof loginSchema>
```

- [ ] **Step 13: Export everything and run the suite**

`packages/domain/src/index.ts`:

```ts
export * from './enums'
export * from './errors'
export * from './identifiers/nif'
export * from './identifiers/niss'
export * from './schemas/auth'
export * from './schemas/client'
export * from './schemas/common'
export * from './schemas/employment'
export * from './schemas/fiscal-profile'
```

Run: `pnpm --filter @ledger-hq/domain test && pnpm --filter @ledger-hq/domain typecheck`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): add shared validation schemas for clients, profiles and employment"
```

---

### Task 5: Key derivation package

**Files:**
- Create: `packages/crypto/package.json`, `packages/crypto/tsconfig.json`
- Create: `packages/crypto/src/params.ts`, `packages/crypto/src/encoding.ts`, `packages/crypto/src/derive.ts`, `packages/crypto/src/index.ts`
- Test: `packages/crypto/src/derive.test.ts`

**Interfaces:**
- Consumes: nothing from other packages.
- Produces:
  - `KDF_PARAMS`, `AUTH_HASH_PARAMS`
  - `generateSalt(): Uint8Array` (16 bytes)
  - `deriveMasterKey(masterPassword: string, salt: Uint8Array): Promise<Uint8Array>` (32 bytes)
  - `deriveStretchedKey(masterKey: Uint8Array): Promise<Uint8Array>` (32 bytes)
  - `deriveAuthHash(masterKey: Uint8Array, masterPassword: string): Promise<Uint8Array>` (32 bytes)
  - `toBase64(bytes: Uint8Array): string`, `fromBase64(value: string): Uint8Array`

**Why the tests look like this:** correctness of Argon2id and HKDF comes from audited implementations — `hash-wasm` and the platform WebCrypto — not from our code. What our code can get wrong is the parameters and the wiring, so the tests pin determinism, output length, input sensitivity, domain separation, and a committed snapshot that fails loudly if a parameter ever changes.

- [ ] **Step 1: Create the package**

`packages/crypto/package.json`:

```json
{
  "name": "@ledger-hq/crypto",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": { "hash-wasm": "^4.11.0" },
  "devDependencies": { "@ledger-hq/config": "workspace:*", "vitest": "^2.1.2" }
}
```

`packages/crypto/tsconfig.json`:

```json
{
  "extends": "@ledger-hq/config/tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM"] },
  "include": ["src"]
}
```

The `DOM` lib is needed for `crypto.subtle`, which exists in both the browser and Node 22.

- [ ] **Step 2: Write the failing test**

`packages/crypto/src/derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from './encoding'
import { deriveAuthHash, deriveMasterKey, deriveStretchedKey, generateSalt } from './derive'
import { KDF_PARAMS } from './params'

const PASSWORD = 'correct horse battery staple'
const SALT = fromBase64('AAECAwQFBgcICQoLDA0ODw==')

describe('KDF parameters', () => {
  it('uses 64 MiB, which is the safe ceiling for Safari on iPhone', () => {
    expect(KDF_PARAMS.memorySizeKiB).toBe(65536)
    expect(KDF_PARAMS.iterations).toBe(3)
    expect(KDF_PARAMS.parallelism).toBe(1)
    expect(KDF_PARAMS.hashLengthBytes).toBe(32)
  })
})

describe('generateSalt', () => {
  it('returns 16 random bytes', () => {
    const first = generateSalt()
    const second = generateSalt()

    expect(first).toHaveLength(16)
    expect(toBase64(first)).not.toBe(toBase64(second))
  })
})

describe('deriveMasterKey', () => {
  it('returns 32 bytes', async () => {
    const key = await deriveMasterKey(PASSWORD, SALT)

    expect(key).toHaveLength(32)
  })

  it('is deterministic for the same password and salt', async () => {
    const first = await deriveMasterKey(PASSWORD, SALT)
    const second = await deriveMasterKey(PASSWORD, SALT)

    expect(toBase64(first)).toBe(toBase64(second))
  })

  it('changes with the salt', async () => {
    const first = await deriveMasterKey(PASSWORD, SALT)
    const second = await deriveMasterKey(PASSWORD, generateSalt())

    expect(toBase64(first)).not.toBe(toBase64(second))
  })

  it('changes with the password', async () => {
    const first = await deriveMasterKey(PASSWORD, SALT)
    const second = await deriveMasterKey(`${PASSWORD}!`, SALT)

    expect(toBase64(first)).not.toBe(toBase64(second))
  })

  it('matches the committed snapshot, so a parameter change cannot pass silently', async () => {
    const key = await deriveMasterKey(PASSWORD, SALT)

    expect(toBase64(key)).toMatchSnapshot()
  })
})

describe('deriveStretchedKey', () => {
  it('returns 32 bytes and never equals the master key', async () => {
    const masterKey = await deriveMasterKey(PASSWORD, SALT)
    const stretched = await deriveStretchedKey(masterKey)

    expect(stretched).toHaveLength(32)
    expect(toBase64(stretched)).not.toBe(toBase64(masterKey))
  })
})

describe('deriveAuthHash', () => {
  it('returns 32 bytes and differs from the vault key material', async () => {
    const masterKey = await deriveMasterKey(PASSWORD, SALT)
    const stretched = await deriveStretchedKey(masterKey)
    const authHash = await deriveAuthHash(masterKey, PASSWORD)

    expect(authHash).toHaveLength(32)
    expect(toBase64(authHash)).not.toBe(toBase64(stretched))
    expect(toBase64(authHash)).not.toBe(toBase64(masterKey))
  })

  it('is deterministic', async () => {
    const masterKey = await deriveMasterKey(PASSWORD, SALT)

    expect(toBase64(await deriveAuthHash(masterKey, PASSWORD))).toBe(
      toBase64(await deriveAuthHash(masterKey, PASSWORD)),
    )
  })
})

describe('base64 round trip', () => {
  it('preserves bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])

    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes))
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: FAIL — `Cannot find module './encoding'`.

- [ ] **Step 4: Implement encoding and parameters**

`packages/crypto/src/encoding.ts`:

```ts
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
```

`packages/crypto/src/params.ts`:

```ts
/**
 * Vault key derivation. 64 MiB is the safe ceiling for Safari on iPhone;
 * raising it makes the vault fail to open on the phone, which defeats the
 * offline requirement. Do not change without re-testing on a real device.
 */
export const KDF_PARAMS = {
  memorySizeKiB: 65536,
  iterations: 3,
  parallelism: 1,
  hashLengthBytes: 32,
} as const

/**
 * Second, cheaper pass that separates the login credential from the vault key.
 * Its input is already a 32-byte high-entropy key, so it needs far less work
 * than the first pass and must not double the cost of unlocking on mobile.
 */
export const AUTH_HASH_PARAMS = {
  memorySizeKiB: 16384,
  iterations: 1,
  parallelism: 1,
  hashLengthBytes: 32,
} as const

export const VAULT_HKDF_INFO = 'ledger-hq:vault'
```

- [ ] **Step 5: Implement derivation**

`packages/crypto/src/derive.ts`:

```ts
import { argon2id } from 'hash-wasm'
import { utf8 } from './encoding'
import { AUTH_HASH_PARAMS, KDF_PARAMS, VAULT_HKDF_INFO } from './params'

type Argon2Params = {
  readonly memorySizeKiB: number
  readonly iterations: number
  readonly parallelism: number
  readonly hashLengthBytes: number
}

async function argon2(
  password: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    memorySize: params.memorySizeKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLengthBytes,
    outputType: 'binary',
  })
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

/** Argon2id over the master password. The result never leaves the device. */
export function deriveMasterKey(
  masterPassword: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return argon2(utf8(masterPassword), salt, KDF_PARAMS)
}

/** HKDF expansion that produces the key wrapping the vault key. */
export async function deriveStretchedKey(masterKey: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveBits'])

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: utf8(VAULT_HKDF_INFO),
    },
    key,
    256,
  )

  return new Uint8Array(bits)
}

/**
 * The only derivative that travels to the server. Salting with the password
 * itself is what makes this branch uninvertible into the vault key.
 */
export function deriveAuthHash(
  masterKey: Uint8Array,
  masterPassword: string,
): Promise<Uint8Array> {
  return argon2(masterKey, utf8(masterPassword), AUTH_HASH_PARAMS)
}
```

`packages/crypto/src/index.ts`:

```ts
export * from './derive'
export * from './encoding'
export * from './params'
```

- [ ] **Step 6: Run the tests and create the snapshot**

Run: `pnpm --filter @ledger-hq/crypto test`
Expected: PASS. Vitest writes `packages/crypto/src/__snapshots__/derive.test.ts.snap` on this first run. Open it and confirm it contains a single 44-character base64 string.

Run it a second time: `pnpm --filter @ledger-hq/crypto test`
Expected: PASS with the snapshot now compared rather than written. If it fails on the second run, the derivation is not deterministic and must be fixed before continuing.

- [ ] **Step 7: Commit**

```bash
git add packages/crypto
git commit -m "feat(crypto): derive master, stretched and auth keys from the master password"
```

---

### Task 6: API scaffold, error handling and redacted logging

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/.env.example`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/common/logger.ts`, `apps/api/src/common/zod-validation.pipe.ts`, `apps/api/src/common/app-error.filter.ts`
- Create: `apps/api/src/health/health.controller.ts`, `apps/api/src/health/health.module.ts`
- Test: `apps/api/src/common/logger.test.ts`, `apps/api/src/common/zod-validation.pipe.test.ts`, `apps/api/src/common/app-error.filter.test.ts`

**Interfaces:**
- Consumes: `AppError`, `ErrorCode` from `@ledger-hq/domain`.
- Produces:
  - `LOGGER_OPTIONS` — the pino configuration object, exported so it can be asserted in tests.
  - `class ZodValidationPipe implements PipeTransform` — constructed with a Zod schema; throws `AppError('common.validation_failed', { issues })` where each issue is `{ path: string, code: string }`.
  - `class AppErrorFilter implements ExceptionFilter` — renders `{ error: { code, params } }` with the error's status.
  - `GET /api/v1/health` returning `{ status: 'ok' }`.

- [ ] **Step 1: Create the API package**

`apps/api/package.json`:

```json
{
  "name": "@ledger-hq/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src test",
    "test": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  },
  "dependencies": {
    "@ledger-hq/crypto": "workspace:*",
    "@ledger-hq/domain": "workspace:*",
    "@nestjs/common": "^10.4.4",
    "@nestjs/config": "^3.2.3",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@prisma/client": "^5.20.0",
    "cookie-parser": "^1.4.7",
    "helmet": "^8.0.0",
    "nestjs-pino": "^4.1.0",
    "pino": "^9.4.0",
    "pino-http": "^10.3.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "uuidv7": "^1.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@ledger-hq/config": "workspace:*",
    "@nestjs/cli": "^10.4.5",
    "@nestjs/testing": "^10.4.4",
    "@testcontainers/postgresql": "^10.13.2",
    "@types/cookie-parser": "^1.4.7",
    "@types/express": "^5.0.0",
    "@types/node": "^22.7.5",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.20.0",
    "supertest": "^7.0.0",
    "vitest": "^2.1.2"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "@ledger-hq/config/tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

`apps/api/.env.example`:

```
DATABASE_URL=postgresql://ledger:ledger@localhost:5432/ledger_hq
NODE_ENV=development
PORT=3000
COOKIE_SECURE=false
SESSION_TTL_DAYS=30
AUTH_SALT_SECRET=change-me-to-32-random-bytes-base64
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/common/logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LOGGER_REDACT_PATHS } from './logger'

describe('logger redaction', () => {
  it.each([
    'req.headers.cookie',
    'req.headers.authorization',
    'req.body.authHash',
    'req.body.kdfSalt',
    'req.body.ciphertext',
    'res.headers["set-cookie"]',
  ])('redacts %s', (path) => {
    expect(LOGGER_REDACT_PATHS).toContain(path)
  })
})
```

`apps/api/src/common/zod-validation.pipe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '@ledger-hq/domain'
import { ZodValidationPipe } from './zod-validation.pipe'

const schema = z.object({ name: z.string().min(1), age: z.number() })

describe('ZodValidationPipe', () => {
  it('returns the parsed value when valid', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(pipe.transform({ name: 'Ana', age: 40 })).toEqual({ name: 'Ana', age: 40 })
  })

  it('throws an AppError carrying one issue per failure', () => {
    const pipe = new ZodValidationPipe(schema)

    try {
      pipe.transform({ name: '', age: 'forty' })
      throw new Error('expected the pipe to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      const appError = error as AppError
      expect(appError.code).toBe('common.validation_failed')
      expect(appError.params.issues).toHaveLength(2)
      expect(appError.params.issues).toContainEqual({ path: 'name', code: 'too_small' })
    }
  })

  it('promotes a domain error code carried in the issue message', () => {
    const withDomainCode = z.object({
      endedOn: z.string(),
    }).superRefine((_value, context) => {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedOn'],
        message: 'employment.ended_before_started',
      })
    })
    const pipe = new ZodValidationPipe(withDomainCode)

    try {
      pipe.transform({ endedOn: '2020-01-01' })
      throw new Error('expected the pipe to throw')
    } catch (error) {
      const appError = error as AppError
      expect(appError.params.issues).toContainEqual({
        path: 'endedOn',
        code: 'employment.ended_before_started',
      })
    }
  })
})
```

`apps/api/src/common/app-error.filter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ArgumentsHost } from '@nestjs/common'
import { AppError } from '@ledger-hq/domain'
import { AppErrorFilter } from './app-error.filter'

function hostWithResponse() {
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost

  return { host, status, json }
}

describe('AppErrorFilter', () => {
  it('renders the code and params at the error status', () => {
    const { host, status, json } = hostWithResponse()

    new AppErrorFilter().catch(new AppError('clients.tax_id_taken', { taxId: '501442600' }, 409), host)

    expect(status).toHaveBeenCalledWith(409)
    expect(json).toHaveBeenCalledWith({
      error: { code: 'clients.tax_id_taken', params: { taxId: '501442600' } },
    })
  })

  it('never leaks prose', () => {
    const { host, json } = hostWithResponse()

    new AppErrorFilter().catch(new AppError('common.not_found', {}, 404), host)

    const payload = JSON.stringify(json.mock.calls[0]?.[0])
    expect(payload).not.toMatch(/[A-Z][a-z]+ [a-z]+ [a-z]+/)
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @ledger-hq/api test`
Expected: FAIL — modules `./logger`, `./zod-validation.pipe` and `./app-error.filter` are missing.

- [ ] **Step 4: Implement the three common pieces**

`apps/api/src/common/logger.ts`:

```ts
import type { Params } from 'nestjs-pino'

/**
 * Nothing that could reconstruct a credential may reach the log. Exported so
 * a test can assert the list, because a stray debugging log is easy to add and
 * easy to forget.
 */
export const LOGGER_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.body.authHash',
  'req.body.kdfSalt',
  'req.body.ciphertext',
  'req.body.password',
  'res.headers["set-cookie"]',
] as const

export const LOGGER_OPTIONS: Params = {
  pinoHttp: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: { paths: [...LOGGER_REDACT_PATHS], censor: '[redacted]' },
    autoLogging: { ignore: (request) => request.url === '/api/v1/health' },
  },
}
```

`apps/api/src/common/zod-validation.pipe.ts`:

```ts
import type { PipeTransform } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { ZodSchema } from 'zod'
import { AppError, ERROR_CODES } from '@ledger-hq/domain'

type Issue = { path: string; code: string }

function isErrorCode(value: string): boolean {
  return (ERROR_CODES as readonly string[]).includes(value)
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value)
    if (result.success) return result.data

    const issues: Issue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      // Cross-field rules carry a domain error code in the message; everything
      // else falls back to Zod's own machine-readable issue code.
      code: isErrorCode(issue.message) ? issue.message : issue.code,
    }))

    throw new AppError('common.validation_failed', { issues }, 422)
  }
}
```

`apps/api/src/common/app-error.filter.ts`:

```ts
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch } from '@nestjs/common'
import type { Response } from 'express'
import { AppError } from '@ledger-hq/domain'

@Catch(AppError)
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: AppError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()

    response.status(exception.status).json({
      error: { code: exception.code, params: exception.params },
    })
  }
}
```

- [ ] **Step 5: Run the unit tests**

Run: `pnpm --filter @ledger-hq/api test`
Expected: PASS, all cases.

- [ ] **Step 6: Wire the application**

`apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' }
  }
}
```

`apps/api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { LOGGER_OPTIONS } from './common/logger'
import { HealthModule } from './health/health.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(LOGGER_OPTIONS),
    HealthModule,
  ],
})
export class AppModule {}
```

`apps/api/src/main.ts`:

```ts
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { AppErrorFilter } from './common/app-error.filter'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  app.useLogger(app.get(Logger))
  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.use(helmet())
  app.useGlobalFilters(new AppErrorFilter())

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0')
}

void bootstrap()
```

- [ ] **Step 7: Verify the application starts**

```bash
pnpm --filter @ledger-hq/api build
node apps/api/dist/main.js &
sleep 2 && curl -s localhost:3000/api/v1/health
kill %1
```

Expected output: `{"status":"ok"}`

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): scaffold NestJS with error-code responses and redacted logging"
```

---

### Task 7: Database schema, constraints and the integration harness

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_init/migration.sql` (generated, then extended by hand)
- Create: `apps/api/src/common/prisma.service.ts`
- Create: `apps/api/test/database.ts`, `apps/api/test/global-setup.ts`, `apps/api/vitest.integration.config.ts`
- Test: `apps/api/test/schema-constraints.integration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the enum names, which must match `packages/domain/src/enums.ts` exactly.
- Produces:
  - `PrismaService` — a Nest-injectable Prisma client that connects on module init.
  - `getTestPrisma(): PrismaClient` and `resetDatabase(): Promise<void>` from `apps/api/test/database.ts`, used by every later integration test.
  - `pnpm --filter @ledger-hq/api test:integration`.

**Why the constraints get their own test:** the spec puts these invariants in the database on purpose. A test that only exercises the service layer would still pass if the constraints were silently dropped from a future migration.

- [ ] **Step 1: Write the schema**

`apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ClientKind {
  COMPANY
  INDIVIDUAL
}

enum LegalForm {
  LDA
  UNIPESSOAL_LDA
  SA
  ASSOCIATION
  OTHER
}

enum Accounting {
  ORGANIZED
  SIMPLIFIED
}

enum VatRegime {
  MONTHLY
  QUARTERLY
  EXEMPT
  NOT_APPLICABLE
}

enum IncomeTax {
  CIT
  PIT_CATEGORY_B
  PIT_EMPLOYMENT_ONLY
}

model User {
  id             String    @id @db.Uuid
  email          String    @unique
  kdfSalt        Bytes
  authHashDigest String
  locale         String    @default("pt-PT")
  createdAt      DateTime  @default(now()) @db.Timestamptz(3)
  sessions       Session[]
}

model Session {
  id        String   @id @db.Uuid
  userId    String   @db.Uuid
  tokenHash String   @unique
  expiresAt DateTime @db.Timestamptz(3)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Client {
  id               String     @id @db.Uuid
  kind             ClientKind
  name             String
  taxId            String     @unique
  accounting       Accounting
  email            String?
  phone            String?
  notes            String?
  archivedAt       DateTime?  @db.Timestamptz(3)
  // COMPANY only
  legalForm        LegalForm?
  // INDIVIDUAL only
  socialSecurityNo String?
  dateOfBirth      DateTime?  @db.Date
  createdAt        DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime   @updatedAt @db.Timestamptz(3)

  fiscalProfile         FiscalProfile?
  employmentsAsEmployer Employment[]   @relation("employer")
  employmentsAsEmployee Employment[]   @relation("employee")

  @@unique([id, kind])
  @@index([kind, name])
}

model FiscalProfile {
  clientId        String    @id @db.Uuid
  hasOpenActivity Boolean
  vatRegime       VatRegime
  incomeTax       IncomeTax
  hasEmployees    Boolean
  hasWithholding  Boolean
  isVatCashBasis  Boolean
  startedAt       DateTime  @db.Date
  updatedAt       DateTime  @updatedAt @db.Timestamptz(3)
  client          Client    @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

model Employment {
  id           String     @id @db.Uuid
  employerId   String     @db.Uuid
  employerKind ClientKind
  employeeId   String     @db.Uuid
  employeeKind ClientKind
  startedOn    DateTime   @db.Date
  endedOn      DateTime?  @db.Date
  jobTitle     String?
  notes        String?
  createdAt    DateTime   @default(now()) @db.Timestamptz(3)

  employer Client @relation("employer", fields: [employerId, employerKind], references: [id, kind])
  employee Client @relation("employee", fields: [employeeId, employeeKind], references: [id, kind])

  @@index([employerId])
  @@index([employeeId])
}

model AuditEvent {
  id         String   @id @db.Uuid
  entityType String
  entityId   String
  action     String
  metadata   Json
  occurredAt DateTime @default(now()) @db.Timestamptz(3)

  @@index([entityType, entityId])
  @@index([occurredAt])
}
```

- [ ] **Step 2: Generate the migration without applying it**

```bash
cd apps/api
docker run --rm -d --name lhq-dev-db -e POSTGRES_PASSWORD=ledger -e POSTGRES_USER=ledger -e POSTGRES_DB=ledger_hq -p 5432:5432 postgres:16-alpine
cp .env.example .env
pnpm exec prisma migrate dev --name init --create-only
```

Expected: a new directory `prisma/migrations/<timestamp>_init/` containing `migration.sql`.

- [ ] **Step 3: Append the constraints Prisma cannot express**

Append to the generated `migration.sql`:

```sql
-- Equality operators on uuid inside a GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Discriminated columns: company fields only on companies, personal fields
-- only on individuals.
ALTER TABLE "Client" ADD CONSTRAINT "client_kind_fields" CHECK (
  (
    "kind" = 'COMPANY'::"ClientKind"
    AND "legalForm" IS NOT NULL
    AND "socialSecurityNo" IS NULL
    AND "dateOfBirth" IS NULL
  )
  OR
  ("kind" = 'INDIVIDUAL'::"ClientKind" AND "legalForm" IS NULL)
);

-- An employer is always a company and an employee always a natural person.
ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_employer_is_company"
  CHECK ("employerKind" = 'COMPANY'::"ClientKind");

ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_employee_is_individual"
  CHECK ("employeeKind" = 'INDIVIDUAL'::"ClientKind");

ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_not_self"
  CHECK ("employerId" <> "employeeId");

ALTER TABLE "Employment"
  ADD CONSTRAINT "employment_ended_after_started"
  CHECK ("endedOn" IS NULL OR "endedOn" >= "startedOn");

-- No two overlapping spells for the same employer and employee pair.
ALTER TABLE "Employment" ADD CONSTRAINT "employment_no_overlap" EXCLUDE USING gist (
  "employerId" WITH =,
  "employeeId" WITH =,
  daterange("startedOn", "endedOn", '[]') WITH &&
);
```

Apply it:

```bash
pnpm exec prisma migrate dev
```

Expected: the migration applies cleanly and the Prisma client is generated.

- [ ] **Step 4: Create the Prisma service**

`apps/api/src/common/prisma.service.ts`:

```ts
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
```

- [ ] **Step 5: Build the integration harness**

`apps/api/test/global-setup.ts`:

```ts
import { execSync } from 'node:child_process'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

let container: StartedPostgreSqlContainer

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()

  process.env.DATABASE_URL = container.getConnectionUri()
  execSync('pnpm exec prisma migrate deploy', {
    cwd: new URL('..', import.meta.url).pathname,
    env: process.env,
    stdio: 'inherit',
  })
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
```

`apps/api/test/database.ts`:

```ts
import { PrismaClient } from '@prisma/client'

let client: PrismaClient | undefined

export function getTestPrisma(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
  return client
}

/** Order matters: children before parents. */
export async function resetDatabase(): Promise<void> {
  const prisma = getTestPrisma()

  await prisma.employment.deleteMany()
  await prisma.fiscalProfile.deleteMany()
  await prisma.auditEvent.deleteMany()
  await prisma.client.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
}
```

`apps/api/vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
```

- [ ] **Step 6: Write the constraint test**

`apps/api/test/schema-constraints.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { getTestPrisma, resetDatabase } from './database'

const prisma = getTestPrisma()

async function createCompany(taxId: string): Promise<string> {
  const id = uuidv7()
  await prisma.client.create({
    data: { id, kind: 'COMPANY', name: 'Padaria Central, Lda.', taxId, accounting: 'ORGANIZED', legalForm: 'LDA' },
  })
  return id
}

async function createIndividual(taxId: string): Promise<string> {
  const id = uuidv7()
  await prisma.client.create({
    data: { id, kind: 'INDIVIDUAL', name: 'Maria Santos', taxId, accounting: 'SIMPLIFIED' },
  })
  return id
}

function employment(employerId: string, employeeId: string, startedOn: string, endedOn?: string) {
  return {
    id: uuidv7(),
    employerId,
    employerKind: 'COMPANY' as const,
    employeeId,
    employeeKind: 'INDIVIDUAL' as const,
    startedOn: new Date(`${startedOn}T00:00:00Z`),
    endedOn: endedOn === undefined ? null : new Date(`${endedOn}T00:00:00Z`),
  }
}

beforeEach(resetDatabase)

describe('client kind constraints', () => {
  it('rejects a company without a legal form', async () => {
    await expect(
      prisma.client.create({
        data: { id: uuidv7(), kind: 'COMPANY', name: 'X', taxId: '501442600', accounting: 'ORGANIZED' },
      }),
    ).rejects.toThrow(/client_kind_fields/)
  })

  it('rejects a legal form on an individual', async () => {
    await expect(
      prisma.client.create({
        data: {
          id: uuidv7(),
          kind: 'INDIVIDUAL',
          name: 'Y',
          taxId: '123456789',
          accounting: 'SIMPLIFIED',
          legalForm: 'LDA',
        },
      }),
    ).rejects.toThrow(/client_kind_fields/)
  })

  it('rejects a social security number on a company', async () => {
    await expect(
      prisma.client.create({
        data: {
          id: uuidv7(),
          kind: 'COMPANY',
          name: 'Z',
          taxId: '501442600',
          accounting: 'ORGANIZED',
          legalForm: 'LDA',
          socialSecurityNo: '21234567890',
        },
      }),
    ).rejects.toThrow(/client_kind_fields/)
  })
})

describe('employment constraints', () => {
  it('accepts an open-ended spell between a company and a person', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    const created = await prisma.employment.create({ data: employment(employerId, employeeId, '2024-01-15') })

    expect(created.endedOn).toBeNull()
  })

  it('rejects a person as the employer', async () => {
    const personA = await createIndividual('123456789')
    const personB = await createIndividual('999999990')

    await expect(
      prisma.employment.create({
        data: { ...employment(personA, personB, '2024-01-15'), employerKind: 'INDIVIDUAL' },
      }),
    ).rejects.toThrow(/employment_employer_is_company/)
  })

  it('rejects overlapping spells for the same pair', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    await prisma.employment.create({ data: employment(employerId, employeeId, '2024-01-01', '2024-12-31') })

    await expect(
      prisma.employment.create({ data: employment(employerId, employeeId, '2024-06-01', '2025-01-31') }),
    ).rejects.toThrow(/employment_no_overlap/)
  })

  it('accepts consecutive spells for the same pair', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    await prisma.employment.create({ data: employment(employerId, employeeId, '2024-01-01', '2024-12-31') })
    const second = await prisma.employment.create({ data: employment(employerId, employeeId, '2025-01-01') })

    expect(second.startedOn).toEqual(new Date('2025-01-01T00:00:00Z'))
  })

  it('accepts concurrent spells with two different employers', async () => {
    const firstEmployer = await createCompany('501442600')
    const secondEmployer = await createCompany('999999990')
    const employeeId = await createIndividual('123456789')

    await prisma.employment.create({ data: employment(firstEmployer, employeeId, '2024-01-01') })

    await expect(
      prisma.employment.create({ data: employment(secondEmployer, employeeId, '2024-06-01') }),
    ).resolves.toBeDefined()
  })

  it('rejects an end date before the start date', async () => {
    const employerId = await createCompany('501442600')
    const employeeId = await createIndividual('123456789')

    await expect(
      prisma.employment.create({ data: employment(employerId, employeeId, '2024-06-01', '2024-01-01') }),
    ).rejects.toThrow(/employment_ended_after_started/)
  })
})
```

- [ ] **Step 7: Run the integration suite**

Run: `pnpm --filter @ledger-hq/api test:integration`
Expected: PASS, nine cases. The first run pulls the `postgres:16-alpine` image, so allow a minute.

If `employment_no_overlap` fails to create during migration with `data type uuid has no default operator class for access method "gist"`, the `CREATE EXTENSION btree_gist` line is missing or placed after the constraint.

- [ ] **Step 8: Add integration tests to CI**

Add to `.github/workflows/ci.yml`, after the `pnpm test` step:

```yaml
      - run: pnpm --filter @ledger-hq/api test:integration
```

Testcontainers uses the Docker daemon that `ubuntu-latest` already provides; no service container is needed.

- [ ] **Step 9: Commit**

```bash
git add apps/api .github
git commit -m "feat(api): add the database schema with kind and employment constraints"
```

---

### Task 8: Authentication with the zero-knowledge login handshake

**Files:**
- Create: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/session.guard.ts`, `apps/api/src/auth/csrf.guard.ts`, `apps/api/src/auth/current-user.decorator.ts`
- Create: `apps/api/test/app.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/auth.integration.test.ts`

**Interfaces:**
- Consumes: `bootstrapSchema`, `loginSchema`, `AppError` from `@ledger-hq/domain`; `KDF_PARAMS` from `@ledger-hq/crypto`; `PrismaService`; `ZodValidationPipe`.
- Produces:
  - `AuthService` with `bootstrapRequired()`, `kdfSaltFor(email)`, `bootstrap(input)`, `login(input)`, `resolveSession(token)`, `revokeSession(token)`.
  - `SessionGuard`, `CsrfGuard`, `@CurrentUser()` parameter decorator yielding `{ id, email, locale }`.
  - `createTestApp(): Promise<INestApplication>` from `apps/api/test/app.ts`, reused by every later integration test.
  - Routes: `GET /api/v1/auth/kdf`, `GET /api/v1/auth/bootstrap-required`, `POST /api/v1/auth/bootstrap`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/session`.

**The handshake, stated once:** the browser asks for the KDF salt, derives `masterKey` with Argon2id, derives `authHash` from it, and posts only `authHash`. The server stores `Argon2id(authHash)` with its own salt. The master password never crosses the network and is never stored in any form.

**Unknown-email handling:** `GET /auth/kdf` returns a deterministic salt derived from a server secret for emails that do not exist, so a wrong address is indistinguishable from a wrong password. It costs four lines and removes an account-enumeration oracle.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/auth.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { deriveAuthHash, deriveMasterKey, fromBase64, generateSalt, toBase64 } from '@ledger-hq/crypto'
import { createTestApp } from './app'
import { resetDatabase } from './database'

const EMAIL = 'paulo@example.com'
const PASSWORD = 'a long master password'

let app: INestApplication

async function credentialsFor(saltBase64: string): Promise<string> {
  const masterKey = await deriveMasterKey(PASSWORD, fromBase64(saltBase64))
  return toBase64(await deriveAuthHash(masterKey, PASSWORD))
}

async function bootstrap(): Promise<{ kdfSalt: string; authHash: string }> {
  const kdfSalt = toBase64(generateSalt())
  const authHash = await credentialsFor(kdfSalt)

  await request(app.getHttpServer())
    .post('/api/v1/auth/bootstrap')
    .set('X-Requested-With', 'ledger-hq')
    .send({ email: EMAIL, kdfSalt, authHash, locale: 'pt-PT' })
    .expect(201)

  return { kdfSalt, authHash }
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
})

describe('bootstrap', () => {
  it('reports that bootstrap is required on an empty database', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/bootstrap-required').expect(200)

    expect(response.body).toEqual({ required: true })
  })

  it('creates the single user and returns a session cookie', async () => {
    const kdfSalt = toBase64(generateSalt())
    const authHash = await credentialsFor(kdfSalt)

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/bootstrap')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, kdfSalt, authHash, locale: 'pt-PT' })
      .expect(201)

    const cookie = response.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain('lhq_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('refuses a second bootstrap', async () => {
    await bootstrap()

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/bootstrap')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: 'other@example.com', kdfSalt: toBase64(generateSalt()), authHash: await credentialsFor(toBase64(generateSalt())), locale: 'en-GB' })
      .expect(409)

    expect(response.body).toEqual({ error: { code: 'auth.already_bootstrapped', params: {} } })
  })
})

describe('kdf salt lookup', () => {
  it('returns the stored salt and the agreed parameters', async () => {
    const { kdfSalt } = await bootstrap()

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/kdf')
      .query({ email: EMAIL })
      .expect(200)

    expect(response.body.kdfSalt).toBe(kdfSalt)
    expect(response.body.params).toEqual({
      memorySizeKiB: 65536,
      iterations: 3,
      parallelism: 1,
      hashLengthBytes: 32,
    })
  })

  it('returns a stable decoy salt for an unknown address', async () => {
    const { kdfSalt } = await bootstrap()

    const first = await request(app.getHttpServer()).get('/api/v1/auth/kdf').query({ email: 'nobody@example.com' }).expect(200)
    const second = await request(app.getHttpServer()).get('/api/v1/auth/kdf').query({ email: 'nobody@example.com' }).expect(200)

    expect(first.body.kdfSalt).toBe(second.body.kdfSalt)
    expect(first.body.kdfSalt).not.toBe(kdfSalt)
  })
})

describe('login', () => {
  it('accepts the correct auth hash', async () => {
    const { authHash } = await bootstrap()

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash })
      .expect(200)

    expect(response.headers['set-cookie']?.[0]).toContain('lhq_session=')
  })

  it('rejects a wrong auth hash with the same code as a wrong address', async () => {
    await bootstrap()

    const wrongHash = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash: toBase64(new Uint8Array(32)) })
      .expect(401)

    const wrongEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: 'nobody@example.com', authHash: toBase64(new Uint8Array(32)) })
      .expect(401)

    expect(wrongHash.body).toEqual({ error: { code: 'auth.invalid_credentials', params: {} } })
    expect(wrongEmail.body).toEqual(wrongHash.body)
  })

  it('rejects a request without the CSRF header', async () => {
    const { authHash } = await bootstrap()

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, authHash })
      .expect(403)
  })
})

describe('session', () => {
  it('returns the current user while the cookie is valid', async () => {
    const { authHash } = await bootstrap()

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash })
      .expect(200)

    const cookie = login.headers['set-cookie'] ?? []

    const session = await request(app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', cookie).expect(200)

    expect(session.body).toEqual({ id: expect.any(String), email: EMAIL, locale: 'pt-PT' })
  })

  it('rejects a missing cookie', async () => {
    await bootstrap()

    const response = await request(app.getHttpServer()).get('/api/v1/auth/session').expect(401)

    expect(response.body).toEqual({ error: { code: 'auth.session_expired', params: {} } })
  })

  it('invalidates the session on logout', async () => {
    const { authHash } = await bootstrap()

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'ledger-hq')
      .send({ email: EMAIL, authHash })
      .expect(200)

    const cookie = login.headers['set-cookie'] ?? []

    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').expect(204)
    await request(app.getHttpServer()).get('/api/v1/auth/session').set('Cookie', cookie).expect(401)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/api test:integration auth`
Expected: FAIL — `Cannot find module './app'`.

- [ ] **Step 3: Implement the auth service**

`apps/api/src/auth/auth.service.ts`:

```ts
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { argon2Verify, argon2id } from 'hash-wasm'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { BootstrapInput, LoginInput } from '@ledger-hq/domain'
import { KDF_PARAMS } from '@ledger-hq/crypto'
import { PrismaService } from '../common/prisma.service'

/**
 * Server-side parameters for hashing the auth hash again. Lighter than the
 * client-side KDF because the input is already 32 bytes of high-entropy key,
 * not a human-chosen password.
 */
const SERVER_HASH_PARAMS = {
  memorySize: 19456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
} as const

export type SessionUser = { id: string; email: string; locale: string }

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async bootstrapRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0
  }

  /**
   * Returns the stored salt, or a deterministic decoy for unknown addresses so
   * that a wrong email cannot be distinguished from a wrong password.
   */
  async kdfSaltFor(email: string): Promise<{ kdfSalt: string; params: typeof KDF_PARAMS }> {
    const user = await this.prisma.user.findUnique({ where: { email } })

    if (user) {
      return { kdfSalt: Buffer.from(user.kdfSalt).toString('base64'), params: KDF_PARAMS }
    }

    const secret = this.config.getOrThrow<string>('AUTH_SALT_SECRET')
    const decoy = createHmac('sha256', secret).update(email).digest().subarray(0, 16)

    return { kdfSalt: decoy.toString('base64'), params: KDF_PARAMS }
  }

  async bootstrap(input: BootstrapInput): Promise<string> {
    if (!(await this.bootstrapRequired())) {
      throw new AppError('auth.already_bootstrapped', {}, 409)
    }

    const digest = await argon2id({
      password: Buffer.from(input.authHash, 'base64'),
      salt: randomBytes(16),
      ...SERVER_HASH_PARAMS,
      outputType: 'encoded',
    })

    const user = await this.prisma.user.create({
      data: {
        id: uuidv7(),
        email: input.email,
        kdfSalt: Buffer.from(input.kdfSalt, 'base64'),
        authHashDigest: digest,
        locale: input.locale,
      },
    })

    return this.createSession(user.id)
  }

  async login(input: LoginInput): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } })

    const valid =
      user !== null &&
      (await argon2Verify({
        password: Buffer.from(input.authHash, 'base64'),
        hash: user.authHashDigest,
      }))

    if (!user || !valid) {
      throw new AppError('auth.invalid_credentials', {}, 401)
    }

    return this.createSession(user.id)
  }

  async resolveSession(token: string): Promise<SessionUser> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    })

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError('auth.session_expired', {}, 401)
    }

    return { id: session.user.id, email: session.user.email, locale: session.user.locale }
  }

  async revokeSession(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    const ttlDays = Number(this.config.get<string>('SESSION_TTL_DAYS') ?? '30')

    await this.prisma.session.create({
      data: {
        id: uuidv7(),
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    })

    return token
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
```

- [ ] **Step 4: Implement the guards and decorator**

`apps/api/src/auth/csrf.guard.ts`:

```ts
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { ForbiddenException, Injectable } from '@nestjs/common'
import type { Request } from 'express'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * SameSite=Strict already blocks cross-site cookie sending. This header check
 * is the second lock: a cross-origin form post cannot set a custom header.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()

    if (SAFE_METHODS.has(request.method)) return true
    if (request.header('x-requested-with') === 'ledger-hq') return true

    throw new ForbiddenException()
  }
}
```

`apps/api/src/auth/session.guard.ts`:

```ts
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { AppError } from '@ledger-hq/domain'
import { AuthService } from './auth.service'
import type { SessionUser } from './auth.service'

export const SESSION_COOKIE = 'lhq_session'

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: SessionUser }>()
    const token = request.cookies?.[SESSION_COOKIE]

    if (typeof token !== 'string' || token.length === 0) {
      throw new AppError('auth.session_expired', {}, 401)
    }

    request.user = await this.auth.resolveSession(token)
    return true
  }
}
```

`apps/api/src/auth/current-user.decorator.ts`:

```ts
import { createParamDecorator } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { SessionUser } from './auth.service'

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => {
    const request = context.switchToHttp().getRequest<Request & { user: SessionUser }>()
    return request.user
  },
)
```

- [ ] **Step 5: Implement the controller and module**

`apps/api/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards, UsePipes } from '@nestjs/common'
import type { Request, Response } from 'express'
import { ConfigService } from '@nestjs/config'
import { bootstrapSchema, loginSchema } from '@ledger-hq/domain'
import type { BootstrapInput, LoginInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { AuthService, type SessionUser } from './auth.service'
import { SESSION_COOKIE, SessionGuard } from './session.guard'
import { CurrentUser } from './current-user.decorator'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('bootstrap-required')
  async bootstrapRequired(): Promise<{ required: boolean }> {
    return { required: await this.auth.bootstrapRequired() }
  }

  @Get('kdf')
  async kdf(@Query('email') email: string) {
    return this.auth.kdfSaltFor((email ?? '').trim())
  }

  @Post('bootstrap')
  @UsePipes(new ZodValidationPipe(bootstrapSchema))
  async bootstrap(@Body() body: BootstrapInput, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.setSessionCookie(response, await this.auth.bootstrap(body))
  }

  @Post('login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginInput, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.setSessionCookie(response, await this.auth.login(body))
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = request.cookies?.[SESSION_COOKIE]
    if (typeof token === 'string') await this.auth.revokeSession(token)

    response.clearCookie(SESSION_COOKIE, { path: '/' })
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@CurrentUser() user: SessionUser): SessionUser {
    return user
  }

  private setSessionCookie(response: Response, token: string): void {
    const ttlDays = Number(this.config.get<string>('SESSION_TTL_DAYS') ?? '30')

    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get<string>('COOKIE_SECURE') !== 'false',
      path: '/',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
    })
  }
}
```

`apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SessionGuard } from './session.guard'

@Module({
  controllers: [AuthController],
  providers: [AuthService, PrismaService, SessionGuard],
  exports: [AuthService, SessionGuard, PrismaService],
})
export class AuthModule {}
```

Register it and the CSRF guard in `apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { LOGGER_OPTIONS } from './common/logger'
import { HealthModule } from './health/health.module'
import { AuthModule } from './auth/auth.module'
import { CsrfGuard } from './auth/csrf.guard'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(LOGGER_OPTIONS),
    HealthModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: CsrfGuard }],
})
export class AppModule {}
```

- [ ] **Step 6: Create the shared test application factory**

`apps/api/test/app.ts`:

```ts
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { AppModule } from '../src/app.module'
import { AppErrorFilter } from '../src/common/app-error.filter'

export async function createTestApp(): Promise<INestApplication> {
  process.env.AUTH_SALT_SECRET ??= 'test-secret'
  process.env.COOKIE_SECURE ??= 'false'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

  const app = moduleRef.createNestApplication({ logger: false })
  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.useGlobalFilters(new AppErrorFilter())

  await app.init()
  return app
}
```

- [ ] **Step 7: Run the auth integration tests**

Run: `pnpm --filter @ledger-hq/api test:integration auth`
Expected: PASS, eleven cases.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add zero-knowledge login, sessions and CSRF protection"
```

---

### Task 9: Clients module

**Files:**
- Create: `apps/api/src/clients/clients.service.ts`, `apps/api/src/clients/clients.controller.ts`, `apps/api/src/clients/clients.module.ts`, `apps/api/src/clients/client.mapper.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/clients.integration.test.ts`

**Interfaces:**
- Consumes: `createClientSchema`, `updateClientSchema`, `AppError`, `PrismaService`, `SessionGuard`, `ZodValidationPipe`, `createTestApp`, `resetDatabase`.
- Produces:
  - `ClientsService` with `create`, `list({ kind?, search?, includeArchived? })`, `findOne(id)`, `update(id, input)`, `archive(id)`, `restore(id)`.
  - `toClientResponse(client)` in `client.mapper.ts` — converts `Date` fields to `YYYY-MM-DD` strings and drops nulls, so the API shape matches what the Zod schemas accept back.
  - Routes: `GET /api/v1/clients`, `POST /api/v1/clients`, `GET /api/v1/clients/:id`, `PATCH /api/v1/clients/:id`, `POST /api/v1/clients/:id/archive`, `POST /api/v1/clients/:id/restore`.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/clients.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app'
import { resetDatabase } from './database'
import { authenticate } from './authenticate'

const company = {
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
}

const individual = {
  kind: 'INDIVIDUAL',
  name: 'Maria Santos',
  taxId: '123456789',
  accounting: 'SIMPLIFIED',
  socialSecurityNo: '11234567890',
  dateOfBirth: '1980-07-14',
}

let app: INestApplication
let cookie: string[]

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

function post(path: string, body: unknown) {
  return request(app.getHttpServer()).post(path).set('Cookie', cookie).set('X-Requested-With', 'ledger-hq').send(body)
}

function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie)
}

describe('POST /clients', () => {
  it('creates a company', async () => {
    const response = await post('/api/v1/clients', company).expect(201)

    expect(response.body).toMatchObject({ ...company, archivedAt: null })
    expect(response.body.id).toEqual(expect.any(String))
  })

  it('creates an individual with personal fields', async () => {
    const response = await post('/api/v1/clients', individual).expect(201)

    expect(response.body.dateOfBirth).toBe('1980-07-14')
    expect(response.body.socialSecurityNo).toBe('11234567890')
  })

  it('rejects a duplicate tax number', async () => {
    await post('/api/v1/clients', company).expect(201)

    const response = await post('/api/v1/clients', { ...company, name: 'Other' }).expect(409)

    expect(response.body).toEqual({
      error: { code: 'clients.tax_id_taken', params: { taxId: '501442600' } },
    })
  })

  it('rejects an invalid payload with per-field issues', async () => {
    const response = await post('/api/v1/clients', { ...company, taxId: '000000000' }).expect(422)

    expect(response.body.error.code).toBe('common.validation_failed')
    expect(response.body.error.params.issues).toContainEqual({ path: 'taxId', code: 'custom' })
  })

  it('requires a session', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/clients')
      .set('X-Requested-With', 'ledger-hq')
      .send(company)
      .expect(401)
  })
})

describe('GET /clients', () => {
  it('filters by kind', async () => {
    await post('/api/v1/clients', company).expect(201)
    await post('/api/v1/clients', individual).expect(201)

    const companies = await get('/api/v1/clients?kind=COMPANY').expect(200)

    expect(companies.body).toHaveLength(1)
    expect(companies.body[0].kind).toBe('COMPANY')
  })

  it('searches by name and tax number, case-insensitively', async () => {
    await post('/api/v1/clients', company).expect(201)
    await post('/api/v1/clients', individual).expect(201)

    expect((await get('/api/v1/clients?search=padaria').expect(200)).body).toHaveLength(1)
    expect((await get('/api/v1/clients?search=12345').expect(200)).body).toHaveLength(1)
  })

  it('hides archived clients unless asked', async () => {
    const created = await post('/api/v1/clients', company).expect(201)
    await post(`/api/v1/clients/${created.body.id}/archive`, {}).expect(200)

    expect((await get('/api/v1/clients').expect(200)).body).toHaveLength(0)
    expect((await get('/api/v1/clients?includeArchived=true').expect(200)).body).toHaveLength(1)
  })
})

describe('PATCH /clients/:id', () => {
  it('updates mutable fields', async () => {
    const created = await post('/api/v1/clients', company).expect(201)

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/clients/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ kind: 'COMPANY', phone: '+351 210 000 000' })
      .expect(200)

    expect(response.body.phone).toBe('+351 210 000 000')
    expect(response.body.name).toBe(company.name)
  })

  it('refuses to edit an archived client', async () => {
    const created = await post('/api/v1/clients', company).expect(201)
    await post(`/api/v1/clients/${created.body.id}/archive`, {}).expect(200)

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/clients/${created.body.id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ kind: 'COMPANY', phone: '+351 210 000 000' })
      .expect(409)

    expect(response.body.error.code).toBe('clients.archived')
  })

  it('returns not found for an unknown id', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/clients/0192f1a0-0000-7000-8000-0000000000ff')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'ledger-hq')
      .send({ kind: 'COMPANY', phone: '1' })
      .expect(404)

    expect(response.body.error.code).toBe('common.not_found')
  })
})

describe('archive and restore', () => {
  it('round-trips', async () => {
    const created = await post('/api/v1/clients', company).expect(201)

    const archived = await post(`/api/v1/clients/${created.body.id}/archive`, {}).expect(200)
    expect(archived.body.archivedAt).toEqual(expect.any(String))

    const restored = await post(`/api/v1/clients/${created.body.id}/restore`, {}).expect(200)
    expect(restored.body.archivedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Add the shared authentication helper**

`apps/api/test/authenticate.ts`:

```ts
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { deriveAuthHash, deriveMasterKey, fromBase64, generateSalt, toBase64 } from '@ledger-hq/crypto'

/** Bootstraps the single user and returns the session cookie header. */
export async function authenticate(app: INestApplication): Promise<string[]> {
  const kdfSalt = toBase64(generateSalt())
  const masterKey = await deriveMasterKey('a long master password', fromBase64(kdfSalt))
  const authHash = toBase64(await deriveAuthHash(masterKey, 'a long master password'))

  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/bootstrap')
    .set('X-Requested-With', 'ledger-hq')
    .send({ email: 'paulo@example.com', kdfSalt, authHash, locale: 'pt-PT' })
    .expect(201)

  return response.headers['set-cookie'] ?? []
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `pnpm --filter @ledger-hq/api test:integration clients`
Expected: FAIL — 404 on `POST /api/v1/clients`, because no controller is registered.

- [ ] **Step 4: Implement the mapper**

`apps/api/src/clients/client.mapper.ts`:

```ts
import type { Client } from '@prisma/client'

export type ClientResponse = {
  id: string
  kind: Client['kind']
  name: string
  taxId: string
  accounting: Client['accounting']
  email: string | null
  phone: string | null
  notes: string | null
  legalForm: Client['legalForm']
  socialSecurityNo: string | null
  dateOfBirth: string | null
  archivedAt: string | null
}

/** `date` columns become plain YYYY-MM-DD strings; instants become ISO 8601. */
export function toClientResponse(client: Client): ClientResponse {
  return {
    id: client.id,
    kind: client.kind,
    name: client.name,
    taxId: client.taxId,
    accounting: client.accounting,
    email: client.email,
    phone: client.phone,
    notes: client.notes,
    legalForm: client.legalForm,
    socialSecurityNo: client.socialSecurityNo,
    dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
    archivedAt: client.archivedAt ? client.archivedAt.toISOString() : null,
  }
}
```

- [ ] **Step 5: Implement the service**

`apps/api/src/clients/clients.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { Client, Prisma } from '@prisma/client'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreateClientInput, UpdateClientInput } from '@ledger-hq/domain'
import { PrismaService } from '../common/prisma.service'

export type ListFilters = {
  kind?: Client['kind']
  search?: string
  includeArchived?: boolean
}

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateClientInput): Promise<Client> {
    await this.assertTaxIdFree(input.taxId)

    return this.prisma.client.create({
      data: { id: uuidv7(), ...toPersistedFields(input) } as Prisma.ClientUncheckedCreateInput,
    })
  }

  async list(filters: ListFilters): Promise<Client[]> {
    const search = filters.search?.trim()

    return this.prisma.client.findMany({
      where: {
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.includeArchived ? {} : { archivedAt: null }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { taxId: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    })
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.prisma.client.findUnique({ where: { id } })
    if (!client) throw new AppError('common.not_found', {}, 404)

    return client
  }

  async update(id: string, input: UpdateClientInput): Promise<Client> {
    const existing = await this.findOne(id)
    if (existing.archivedAt) throw new AppError('clients.archived', {}, 409)

    const { kind: _kind, ...changes } = input
    if (typeof changes.taxId === 'string' && changes.taxId !== existing.taxId) {
      await this.assertTaxIdFree(changes.taxId)
    }

    return this.prisma.client.update({ where: { id }, data: toPersistedFields(changes) })
  }

  async archive(id: string): Promise<Client> {
    await this.findOne(id)
    return this.prisma.client.update({ where: { id }, data: { archivedAt: new Date() } })
  }

  async restore(id: string): Promise<Client> {
    await this.findOne(id)
    return this.prisma.client.update({ where: { id }, data: { archivedAt: null } })
  }

  private async assertTaxIdFree(taxId: string): Promise<void> {
    const clash = await this.prisma.client.findUnique({ where: { taxId } })
    if (clash) throw new AppError('clients.tax_id_taken', { taxId }, 409)
  }
}

/** Converts the wire shape's date strings into the `Date` values Prisma wants. */
function toPersistedFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields = { ...input }
  delete fields.kind

  if (typeof fields.dateOfBirth === 'string') {
    fields.dateOfBirth = new Date(`${fields.dateOfBirth}T00:00:00Z`)
  }

  return 'kind' in input ? { ...fields, kind: input.kind } : fields
}
```

- [ ] **Step 6: Implement the controller and module**

`apps/api/src/clients/clients.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { createClientSchema, updateClientSchema } from '@ledger-hq/domain'
import type { CreateClientInput, UpdateClientInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { SessionGuard } from '../auth/session.guard'
import { ClientsService } from './clients.service'
import { toClientResponse } from './client.mapper'
import type { ClientResponse } from './client.mapper'

@Controller('clients')
@UseGuards(SessionGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  async list(
    @Query('kind') kind?: 'COMPANY' | 'INDIVIDUAL',
    @Query('search') search?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ClientResponse[]> {
    const found = await this.clients.list({
      ...(kind ? { kind } : {}),
      ...(search ? { search } : {}),
      includeArchived: includeArchived === 'true',
    })

    return found.map(toClientResponse)
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
  ): Promise<ClientResponse> {
    return toClientResponse(await this.clients.create(body))
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ClientResponse> {
    return toClientResponse(await this.clients.findOne(id))
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
  ): Promise<ClientResponse> {
    return toClientResponse(await this.clients.update(id, body))
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<ClientResponse> {
    return toClientResponse(await this.clients.archive(id))
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string): Promise<ClientResponse> {
    return toClientResponse(await this.clients.restore(id))
  }
}
```

`apps/api/src/clients/clients.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaService } from '../common/prisma.service'
import { ClientsController } from './clients.controller'
import { ClientsService } from './clients.service'

@Module({
  imports: [AuthModule],
  controllers: [ClientsController],
  providers: [ClientsService, PrismaService],
  exports: [ClientsService],
})
export class ClientsModule {}
```

Add `ClientsModule` to the `imports` array in `apps/api/src/app.module.ts`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @ledger-hq/api test:integration clients`
Expected: PASS, twelve cases.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add client register for companies and individuals"
```

---

### Task 10: Fiscal profiles and audit trail

**Files:**
- Create: `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.module.ts`
- Create: `apps/api/src/fiscal-profiles/fiscal-profiles.service.ts`, `apps/api/src/fiscal-profiles/fiscal-profiles.controller.ts`, `apps/api/src/fiscal-profiles/fiscal-profiles.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/fiscal-profiles.integration.test.ts`

**Interfaces:**
- Consumes: `fiscalProfileInputSchema`, `checkFiscalProfileConsistency`, `ClientsService`, `PrismaService`, `SessionGuard`.
- Produces:
  - `AuditService.record({ entityType, entityId, action, metadata })` — writes one `AuditEvent`.
  - `FiscalProfilesService.get(clientId)` and `.upsert(clientId, input)`.
  - Routes: `GET /api/v1/clients/:id/fiscal-profile`, `PUT /api/v1/clients/:id/fiscal-profile`.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/fiscal-profiles.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app'
import { getTestPrisma, resetDatabase } from './database'
import { authenticate } from './authenticate'

const prisma = getTestPrisma()

const companyProfile = {
  hasOpenActivity: true,
  vatRegime: 'QUARTERLY',
  incomeTax: 'CIT',
  hasEmployees: true,
  hasWithholding: true,
  isVatCashBasis: false,
  startedAt: '2020-01-01',
}

const employeeProfile = {
  hasOpenActivity: false,
  vatRegime: 'NOT_APPLICABLE',
  incomeTax: 'PIT_EMPLOYMENT_ONLY',
  hasEmployees: false,
  hasWithholding: false,
  isVatCashBasis: false,
  startedAt: '2021-03-01',
}

let app: INestApplication
let cookie: string[]

async function createClient(payload: Record<string, unknown>): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/clients')
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send(payload)
    .expect(201)

  return response.body.id
}

function putProfile(clientId: string, body: unknown) {
  return request(app.getHttpServer())
    .put(`/api/v1/clients/${clientId}/fiscal-profile`)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send(body)
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('PUT /clients/:id/fiscal-profile', () => {
  it('stores a company profile', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    const response = await putProfile(clientId, companyProfile).expect(200)

    expect(response.body).toMatchObject(companyProfile)
  })

  it('stores a profile for an employee with no activity of their own', async () => {
    const clientId = await createClient({
      kind: 'INDIVIDUAL',
      name: 'Maria Santos',
      taxId: '123456789',
      accounting: 'SIMPLIFIED',
    })

    await putProfile(clientId, employeeProfile).expect(200)
  })

  it('rejects corporate income tax on an individual', async () => {
    const clientId = await createClient({
      kind: 'INDIVIDUAL',
      name: 'Maria Santos',
      taxId: '123456789',
      accounting: 'SIMPLIFIED',
    })

    const response = await putProfile(clientId, { ...employeeProfile, incomeTax: 'CIT' }).expect(422)

    expect(response.body.error.params.issues).toContainEqual({
      path: 'incomeTax',
      code: 'fiscal_profile.income_tax_incompatible_with_kind',
    })
  })

  it('reports every consistency violation at once', async () => {
    const clientId = await createClient({
      kind: 'INDIVIDUAL',
      name: 'Maria Santos',
      taxId: '123456789',
      accounting: 'SIMPLIFIED',
    })

    const response = await putProfile(clientId, {
      ...employeeProfile,
      incomeTax: 'CIT',
      hasEmployees: true,
    }).expect(422)

    expect(response.body.error.params.issues).toHaveLength(2)
  })

  it('is idempotent and overwrites on a second call', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    await putProfile(clientId, companyProfile).expect(200)
    const updated = await putProfile(clientId, { ...companyProfile, vatRegime: 'MONTHLY' }).expect(200)

    expect(updated.body.vatRegime).toBe('MONTHLY')
  })

  it('writes an audit event recording the change', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    await putProfile(clientId, companyProfile).expect(200)
    await putProfile(clientId, { ...companyProfile, vatRegime: 'MONTHLY' }).expect(200)

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'FiscalProfile', entityId: clientId },
      orderBy: { occurredAt: 'asc' },
    })

    expect(events).toHaveLength(2)
    expect(events[1]?.action).toBe('fiscal_profile.changed')
    expect(events[1]?.metadata).toMatchObject({
      changed: { vatRegime: { from: 'QUARTERLY', to: 'MONTHLY' } },
    })
  })

  it('returns not found for an unknown client', async () => {
    await putProfile('0192f1a0-0000-7000-8000-0000000000ff', companyProfile).expect(404)
  })
})

describe('GET /clients/:id/fiscal-profile', () => {
  it('returns 404 before a profile is set', async () => {
    const clientId = await createClient({
      kind: 'COMPANY',
      name: 'Padaria Central, Lda.',
      taxId: '501442600',
      accounting: 'ORGANIZED',
      legalForm: 'LDA',
    })

    await request(app.getHttpServer())
      .get(`/api/v1/clients/${clientId}/fiscal-profile`)
      .set('Cookie', cookie)
      .expect(404)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/api test:integration fiscal-profiles`
Expected: FAIL — 404 on the `PUT` route.

- [ ] **Step 3: Implement the audit service**

`apps/api/src/audit/audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { uuidv7 } from 'uuidv7'
import { PrismaService } from '../common/prisma.service'

export type AuditInput = {
  entityType: string
  entityId: string
  /** A machine code, never prose. The frontend translates it. */
  action: string
  metadata: Prisma.InputJsonValue
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    await this.prisma.auditEvent.create({ data: { id: uuidv7(), ...input } })
  }
}
```

`apps/api/src/audit/audit.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { AuditService } from './audit.service'

@Module({ providers: [AuditService, PrismaService], exports: [AuditService] })
export class AuditModule {}
```

- [ ] **Step 4: Implement the fiscal profile service**

`apps/api/src/fiscal-profiles/fiscal-profiles.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { FiscalProfile } from '@prisma/client'
import { AppError, checkFiscalProfileConsistency } from '@ledger-hq/domain'
import type { ErrorCode, FiscalProfileInput } from '@ledger-hq/domain'
import { PrismaService } from '../common/prisma.service'
import { ClientsService } from '../clients/clients.service'
import { AuditService } from '../audit/audit.service'

/** Maps each consistency rule to the field a form should highlight. */
const FIELD_FOR_CODE: Record<string, string> = {
  'fiscal_profile.open_activity_required_for_company': 'hasOpenActivity',
  'fiscal_profile.vat_regime_requires_open_activity': 'vatRegime',
  'fiscal_profile.income_tax_incompatible_with_kind': 'incomeTax',
  'fiscal_profile.employees_flag_not_allowed_for_individual': 'hasEmployees',
}

@Injectable()
export class FiscalProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  async get(clientId: string): Promise<FiscalProfile> {
    await this.clients.findOne(clientId)

    const profile = await this.prisma.fiscalProfile.findUnique({ where: { clientId } })
    if (!profile) throw new AppError('common.not_found', {}, 404)

    return profile
  }

  async upsert(clientId: string, input: FiscalProfileInput): Promise<FiscalProfile> {
    const client = await this.clients.findOne(clientId)

    const violations = checkFiscalProfileConsistency(client.kind, input)
    if (violations.length > 0) throw validationError(violations)

    const before = await this.prisma.fiscalProfile.findUnique({ where: { clientId } })
    const data = { ...input, startedAt: new Date(`${input.startedAt}T00:00:00Z`) }

    const profile = await this.prisma.fiscalProfile.upsert({
      where: { clientId },
      create: { clientId, ...data },
      update: data,
    })

    await this.audit.record({
      entityType: 'FiscalProfile',
      entityId: clientId,
      action: before ? 'fiscal_profile.changed' : 'fiscal_profile.created',
      metadata: { changed: diff(before, profile) },
    })

    return profile
  }
}

function validationError(codes: ErrorCode[]): AppError {
  const issues = codes.map((code) => ({ path: FIELD_FOR_CODE[code] ?? '', code }))
  return new AppError('common.validation_failed', { issues }, 422)
}

/** Field-level before/after, so the audit log says what actually moved. */
function diff(
  before: FiscalProfile | null,
  after: FiscalProfile,
): Record<string, { from: unknown; to: unknown }> {
  if (!before) return {}

  const changed: Record<string, { from: unknown; to: unknown }> = {}

  for (const [key, value] of Object.entries(after)) {
    const previous = (before as Record<string, unknown>)[key]
    if (key === 'updatedAt') continue

    const from = previous instanceof Date ? previous.toISOString() : previous
    const to = value instanceof Date ? value.toISOString() : value

    if (from !== to) changed[key] = { from, to }
  }

  return changed
}
```

- [ ] **Step 5: Implement the controller and module**

`apps/api/src/fiscal-profiles/fiscal-profiles.controller.ts`:

```ts
import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { fiscalProfileInputSchema } from '@ledger-hq/domain'
import type { FiscalProfileInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { SessionGuard } from '../auth/session.guard'
import { FiscalProfilesService } from './fiscal-profiles.service'
import type { FiscalProfile } from '@prisma/client'

type FiscalProfileResponse = Omit<FiscalProfile, 'startedAt' | 'updatedAt'> & {
  startedAt: string
  updatedAt: string
}

function toResponse(profile: FiscalProfile): FiscalProfileResponse {
  return {
    ...profile,
    startedAt: profile.startedAt.toISOString().slice(0, 10),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

@Controller('clients/:clientId/fiscal-profile')
@UseGuards(SessionGuard)
export class FiscalProfilesController {
  constructor(private readonly profiles: FiscalProfilesService) {}

  @Get()
  async get(@Param('clientId') clientId: string): Promise<FiscalProfileResponse> {
    return toResponse(await this.profiles.get(clientId))
  }

  @Put()
  async put(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(fiscalProfileInputSchema)) body: FiscalProfileInput,
  ): Promise<FiscalProfileResponse> {
    return toResponse(await this.profiles.upsert(clientId, body))
  }
}
```

`apps/api/src/fiscal-profiles/fiscal-profiles.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { ClientsModule } from '../clients/clients.module'
import { PrismaService } from '../common/prisma.service'
import { FiscalProfilesController } from './fiscal-profiles.controller'
import { FiscalProfilesService } from './fiscal-profiles.service'

@Module({
  imports: [AuthModule, AuditModule, ClientsModule],
  controllers: [FiscalProfilesController],
  providers: [FiscalProfilesService, PrismaService],
})
export class FiscalProfilesModule {}
```

Add `AuditModule` and `FiscalProfilesModule` to `apps/api/src/app.module.ts`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @ledger-hq/api test:integration fiscal-profiles`
Expected: PASS, eight cases.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add fiscal profiles with kind-aware rules and an audit trail"
```

---

### Task 11: Employment links

**Files:**
- Create: `apps/api/src/employments/employments.service.ts`, `apps/api/src/employments/employments.controller.ts`, `apps/api/src/employments/employments.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/employments.integration.test.ts`

**Interfaces:**
- Consumes: `createEmploymentSchema`, `endEmploymentSchema`, `ClientsService`, `PrismaService`, `SessionGuard`.
- Produces:
  - `EmploymentsService` with `create(input)`, `listForClient(clientId)`, `end(id, endedOn)`.
  - Routes: `POST /api/v1/employments`, `GET /api/v1/clients/:id/employments`, `POST /api/v1/employments/:id/end`.
  - Response shape: `{ id, employerId, employerName, employeeId, employeeName, startedOn, endedOn, jobTitle, notes }`, so a company page can render its staff list without a second request per row.

**Kind and overlap checks happen twice on purpose.** The service checks them first so the API can return a precise error code; the database constraints from Task 7 remain as the backstop that a future code path cannot bypass.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/employments.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app'
import { resetDatabase } from './database'
import { authenticate } from './authenticate'

let app: INestApplication
let cookie: string[]

async function createClient(payload: Record<string, unknown>): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/clients')
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send(payload)
    .expect(201)

  return response.body.id
}

const companyPayload = (taxId: string, name = 'Padaria Central, Lda.') => ({
  kind: 'COMPANY',
  name,
  taxId,
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
})

const personPayload = (taxId: string, name = 'Maria Santos') => ({
  kind: 'INDIVIDUAL',
  name,
  taxId,
  accounting: 'SIMPLIFIED',
})

function post(path: string, body: unknown) {
  return request(app.getHttpServer())
    .post(path)
    .set('Cookie', cookie)
    .set('X-Requested-With', 'ledger-hq')
    .send(body)
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('POST /employments', () => {
  it('links a person to a company', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-01-15',
      jobTitle: 'Bookkeeper',
    }).expect(201)

    expect(response.body).toMatchObject({
      employerId,
      employerName: 'Padaria Central, Lda.',
      employeeId,
      employeeName: 'Maria Santos',
      startedOn: '2024-01-15',
      endedOn: null,
      jobTitle: 'Bookkeeper',
    })
  })

  it('rejects a person as the employer', async () => {
    const employerId = await createClient(personPayload('123456789'))
    const employeeId = await createClient(personPayload('999999990', 'João Dias'))

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-01-15',
    }).expect(422)

    expect(response.body.error.code).toBe('employment.employer_must_be_company')
  })

  it('rejects a company as the employee', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(companyPayload('999999990', 'Outra, Lda.'))

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-01-15',
    }).expect(422)

    expect(response.body.error.code).toBe('employment.employee_must_be_individual')
  })

  it('rejects an overlapping spell for the same pair', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-01', endedOn: '2024-12-31' }).expect(201)

    const response = await post('/api/v1/employments', {
      employerId,
      employeeId,
      startedOn: '2024-06-01',
    }).expect(409)

    expect(response.body.error.code).toBe('employment.overlapping_spell')
  })

  it('accepts a consecutive spell for the same pair', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-01', endedOn: '2024-12-31' }).expect(201)
    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2025-01-01' }).expect(201)
  })

  it('accepts concurrent spells with different employers', async () => {
    const firstEmployer = await createClient(companyPayload('501442600'))
    const secondEmployer = await createClient(companyPayload('999999990', 'Outra, Lda.'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId: firstEmployer, employeeId, startedOn: '2024-01-01' }).expect(201)
    await post('/api/v1/employments', { employerId: secondEmployer, employeeId, startedOn: '2024-06-01' }).expect(201)
  })

  it('rejects self-employment at the schema level', async () => {
    const id = await createClient(companyPayload('501442600'))

    const response = await post('/api/v1/employments', { employerId: id, employeeId: id, startedOn: '2024-01-01' }).expect(422)

    expect(response.body.error.params.issues).toContainEqual({
      path: 'employeeId',
      code: 'employment.self_employment',
    })
  })

  it('returns not found for an unknown client', async () => {
    const employerId = await createClient(companyPayload('501442600'))

    await post('/api/v1/employments', {
      employerId,
      employeeId: '0192f1a0-0000-7000-8000-0000000000ff',
      startedOn: '2024-01-01',
    }).expect(404)
  })
})

describe('GET /clients/:id/employments', () => {
  it('lists spells from both sides of the relationship', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-15' }).expect(201)

    const fromCompany = await request(app.getHttpServer())
      .get(`/api/v1/clients/${employerId}/employments`)
      .set('Cookie', cookie)
      .expect(200)

    const fromPerson = await request(app.getHttpServer())
      .get(`/api/v1/clients/${employeeId}/employments`)
      .set('Cookie', cookie)
      .expect(200)

    expect(fromCompany.body).toHaveLength(1)
    expect(fromPerson.body).toHaveLength(1)
    expect(fromCompany.body[0].id).toBe(fromPerson.body[0].id)
  })
})

describe('POST /employments/:id/end', () => {
  it('closes an open spell', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    const created = await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-15' }).expect(201)

    const ended = await post(`/api/v1/employments/${created.body.id}/end`, { endedOn: '2026-03-31' }).expect(200)

    expect(ended.body.endedOn).toBe('2026-03-31')
  })

  it('rejects an end date before the start date', async () => {
    const employerId = await createClient(companyPayload('501442600'))
    const employeeId = await createClient(personPayload('123456789'))

    const created = await post('/api/v1/employments', { employerId, employeeId, startedOn: '2024-01-15' }).expect(201)

    const response = await post(`/api/v1/employments/${created.body.id}/end`, { endedOn: '2023-01-01' }).expect(422)

    expect(response.body.error.code).toBe('employment.ended_before_started')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/api test:integration employments`
Expected: FAIL — 404 on `POST /api/v1/employments`.

- [ ] **Step 3: Implement the service**

`apps/api/src/employments/employments.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { Client, Employment } from '@prisma/client'
import { uuidv7 } from 'uuidv7'
import { AppError } from '@ledger-hq/domain'
import type { CreateEmploymentInput } from '@ledger-hq/domain'
import { PrismaService } from '../common/prisma.service'
import { ClientsService } from '../clients/clients.service'

export type EmploymentWithNames = Employment & {
  employer: Pick<Client, 'name'>
  employee: Pick<Client, 'name'>
}

const WITH_NAMES = {
  employer: { select: { name: true } },
  employee: { select: { name: true } },
} as const

@Injectable()
export class EmploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  async create(input: CreateEmploymentInput): Promise<EmploymentWithNames> {
    const employer = await this.clients.findOne(input.employerId)
    const employee = await this.clients.findOne(input.employeeId)

    if (employer.kind !== 'COMPANY') {
      throw new AppError('employment.employer_must_be_company', {}, 422)
    }

    if (employee.kind !== 'INDIVIDUAL') {
      throw new AppError('employment.employee_must_be_individual', {}, 422)
    }

    await this.assertNoOverlap(input.employerId, input.employeeId, input.startedOn, input.endedOn ?? null)

    return this.prisma.employment.create({
      data: {
        id: uuidv7(),
        employerId: input.employerId,
        employerKind: 'COMPANY',
        employeeId: input.employeeId,
        employeeKind: 'INDIVIDUAL',
        startedOn: toDate(input.startedOn),
        endedOn: input.endedOn === undefined ? null : toDate(input.endedOn),
        jobTitle: input.jobTitle ?? null,
        notes: input.notes ?? null,
      },
      include: WITH_NAMES,
    })
  }

  async listForClient(clientId: string): Promise<EmploymentWithNames[]> {
    await this.clients.findOne(clientId)

    return this.prisma.employment.findMany({
      where: { OR: [{ employerId: clientId }, { employeeId: clientId }] },
      include: WITH_NAMES,
      orderBy: { startedOn: 'desc' },
    })
  }

  async end(id: string, endedOn: string): Promise<EmploymentWithNames> {
    const existing = await this.prisma.employment.findUnique({ where: { id } })
    if (!existing) throw new AppError('common.not_found', {}, 404)

    if (toDate(endedOn) < existing.startedOn) {
      throw new AppError('employment.ended_before_started', {}, 422)
    }

    return this.prisma.employment.update({
      where: { id },
      data: { endedOn: toDate(endedOn) },
      include: WITH_NAMES,
    })
  }

  /**
   * Checked here so the API can name the problem. The GiST exclusion
   * constraint in the database remains the authoritative guard.
   */
  private async assertNoOverlap(
    employerId: string,
    employeeId: string,
    startedOn: string,
    endedOn: string | null,
  ): Promise<void> {
    const start = toDate(startedOn)
    const end = endedOn === null ? null : toDate(endedOn)

    const clash = await this.prisma.employment.findFirst({
      where: {
        employerId,
        employeeId,
        startedOn: end === null ? undefined : { lte: end },
        OR: [{ endedOn: null }, { endedOn: { gte: start } }],
      },
    })

    if (clash) throw new AppError('employment.overlapping_spell', {}, 409)
  }
}

function toDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`)
}
```

- [ ] **Step 4: Implement the controller and module**

`apps/api/src/employments/employments.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { createEmploymentSchema, endEmploymentSchema } from '@ledger-hq/domain'
import type { CreateEmploymentInput, EndEmploymentInput } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { SessionGuard } from '../auth/session.guard'
import { EmploymentsService } from './employments.service'
import type { EmploymentWithNames } from './employments.service'

type EmploymentResponse = {
  id: string
  employerId: string
  employerName: string
  employeeId: string
  employeeName: string
  startedOn: string
  endedOn: string | null
  jobTitle: string | null
  notes: string | null
}

function toResponse(employment: EmploymentWithNames): EmploymentResponse {
  return {
    id: employment.id,
    employerId: employment.employerId,
    employerName: employment.employer.name,
    employeeId: employment.employeeId,
    employeeName: employment.employee.name,
    startedOn: employment.startedOn.toISOString().slice(0, 10),
    endedOn: employment.endedOn ? employment.endedOn.toISOString().slice(0, 10) : null,
    jobTitle: employment.jobTitle,
    notes: employment.notes,
  }
}

@Controller()
@UseGuards(SessionGuard)
export class EmploymentsController {
  constructor(private readonly employments: EmploymentsService) {}

  @Post('employments')
  async create(
    @Body(new ZodValidationPipe(createEmploymentSchema)) body: CreateEmploymentInput,
  ): Promise<EmploymentResponse> {
    return toResponse(await this.employments.create(body))
  }

  @Get('clients/:clientId/employments')
  async listForClient(@Param('clientId') clientId: string): Promise<EmploymentResponse[]> {
    return (await this.employments.listForClient(clientId)).map(toResponse)
  }

  @Post('employments/:id/end')
  async end(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endEmploymentSchema)) body: EndEmploymentInput,
  ): Promise<EmploymentResponse> {
    return toResponse(await this.employments.end(id, body.endedOn))
  }
}
```

`apps/api/src/employments/employments.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ClientsModule } from '../clients/clients.module'
import { PrismaService } from '../common/prisma.service'
import { EmploymentsController } from './employments.controller'
import { EmploymentsService } from './employments.service'

@Module({
  imports: [AuthModule, ClientsModule],
  controllers: [EmploymentsController],
  providers: [EmploymentsService, PrismaService],
})
export class EmploymentsModule {}
```

Add `EmploymentsModule` to `apps/api/src/app.module.ts`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ledger-hq/api test:integration employments`
Expected: PASS, eleven cases.

- [ ] **Step 6: Run the whole API suite and commit**

```bash
pnpm --filter @ledger-hq/api test && pnpm --filter @ledger-hq/api test:integration
git add apps/api
git commit -m "feat(api): link individuals to companies through employment spells"
```

---

### Task 12: Web application scaffold

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/vitest.config.ts`, `apps/web/.env.example`
- Create: `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `apps/web/src/router.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/shell/AppLayout.tsx`
- Test: `apps/web/src/api/client.test.ts`

**Interfaces:**
- Consumes: nothing from the API package at build time; it talks to `/api/v1` over HTTP.
- Produces:
  - `apiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>` — sends the CSRF header and credentials, and throws `ApiError { code, params, status }` built from the server's error envelope.
  - `class ApiError extends Error` with `code: string`, `params: Record<string, unknown>`, `status: number`.
  - `AppLayout` — the shell with navigation and an outlet.
  - `pnpm --filter @ledger-hq/web dev` serving on port 5173 with `/api` proxied to the API.

- [ ] **Step 1: Create the package**

`apps/web/package.json`:

```json
{
  "name": "@ledger-hq/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "i18n:check": "node scripts/check-locales.mjs"
  },
  "dependencies": {
    "@ledger-hq/crypto": "workspace:*",
    "@ledger-hq/domain": "workspace:*",
    "@tanstack/react-query": "^5.59.0",
    "@tanstack/react-router": "^1.58.15",
    "i18next": "^23.15.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-i18next": "^15.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@ledger-hq/config": "workspace:*",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.2",
    "eslint-plugin-i18next": "^6.1.0",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "vite": "^6.0.0",
    "vite-plugin-pwa": "^0.20.5",
    "vitest": "^2.1.2"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "@ledger-hq/config/tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "e2e", "scripts"]
}
```

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
})
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

`apps/web/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="pt-PT">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Ledger HQ</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/styles.css`:

```css
@import 'tailwindcss';
```

- [ ] **Step 2: Write the failing API client test**

`apps/web/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('sends the CSRF header and credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { id: '1' }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/clients')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/clients',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Requested-With': 'ledger-hq' }),
      }),
    )
  })

  it('serialises the body as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, {}))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/clients', { method: 'POST', body: { name: 'Ana' } })

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'Ana' }),
    })
  })

  it('throws an ApiError carrying the server error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(409, { error: { code: 'clients.tax_id_taken', params: { taxId: '501442600' } } }),
      ),
    )

    await expect(apiFetch('/clients')).rejects.toMatchObject({
      code: 'clients.tax_id_taken',
      params: { taxId: '501442600' },
      status: 409,
    })
  })

  it('falls back to a generic code when the server sends no envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(500, {})))

    await expect(apiFetch('/clients')).rejects.toBeInstanceOf(ApiError)
    await expect(apiFetch('/clients')).rejects.toMatchObject({ code: 'common.unexpected' })
  })

  it('surfaces a network failure as an offline code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiFetch('/clients')).rejects.toMatchObject({ code: 'common.offline', status: 0 })
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/web test`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 4: Implement the API client**

`apps/web/src/api/client.ts`:

```ts
const BASE_PATH = '/api/v1'

export class ApiError extends Error {
  readonly code: string
  readonly params: Record<string, unknown>
  readonly status: number

  constructor(code: string, params: Record<string, unknown>, status: number) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.params = params
    this.status = status
  }
}

type Options = { method?: string; body?: unknown }

export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        // Second lock against cross-site posts; the API rejects mutations
        // that arrive without it.
        'X-Requested-With': 'ledger-hq',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new ApiError('common.offline', {}, 0)
  }

  const payload: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const envelope = (payload as { error?: { code?: string; params?: Record<string, unknown> } }).error

    throw new ApiError(envelope?.code ?? 'common.unexpected', envelope?.params ?? {}, response.status)
  }

  return payload as T
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @ledger-hq/web test`
Expected: PASS, five cases.

- [ ] **Step 6: Add the shell and entry point**

`apps/web/src/shell/AppLayout.tsx`:

```tsx
import { Link, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export function AppLayout() {
  const { t } = useTranslation('common')

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/" className="font-semibold">
            {t('appName')}
          </Link>
          <Link to="/clients" className="text-sm">
            {t('nav.clients')}
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
```

`apps/web/src/router.tsx`:

```tsx
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppLayout } from './shell/AppLayout'

const rootRoute = createRootRoute({ component: AppLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => null,
})

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

const container = document.getElementById('root')
if (!container) throw new Error('root element missing')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
```

`AppLayout` calls `useTranslation`, which Task 13 sets up. Until then the shell renders raw keys, which is expected and is why the i18n task comes next.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): scaffold the Vite React application with a typed API client"
```

---

### Task 13: Internationalisation infrastructure

**Files:**
- Create: `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/format.ts`, `apps/web/src/i18n/i18next.d.ts`
- Create: `apps/web/src/i18n/locales/pt/{common,clients,employments,errors,domain}.json`
- Create: `apps/web/src/i18n/locales/en/{common,clients,employments,errors,domain}.json`
- Create: `apps/web/src/i18n/locales/pt/index.ts`, `apps/web/src/i18n/locales/en/index.ts`
- Create: `apps/web/scripts/check-locales.mjs`
- Create: `apps/web/src/shell/LanguageSwitcher.tsx`
- Modify: `apps/web/src/main.tsx`, `packages/config/eslint.config.js`, `.github/workflows/ci.yml`
- Test: `apps/web/src/i18n/format.test.ts`, `apps/web/src/i18n/locales/locales.test.ts`

**Interfaces:**
- Consumes: the enum value arrays and `ERROR_CODES` from `@ledger-hq/domain`.
- Produces:
  - `initI18n(): Promise<void>` and `SUPPORTED_LOCALES = ['pt-PT', 'en-GB']`.
  - `formatDate`, `formatLongDate`, `formatCurrency`, `formatQuarter` from `format.ts`.
  - `LanguageSwitcher` component.
  - `pnpm --filter @ledger-hq/web i18n:check`.

- [ ] **Step 1: Write the failing format test**

`apps/web/src/i18n/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatLongDate, formatQuarter } from './format'

/** Intl inserts non-breaking and narrow spaces; normalise before comparing. */
function normalise(value: string): string {
  return value.replace(/[  ]/g, ' ')
}

describe('formatDate', () => {
  it('uses day-first ordering in both locales', () => {
    expect(formatDate('2026-09-04', 'pt-PT')).toBe('04/09/2026')
    expect(formatDate('2026-09-04', 'en-GB')).toBe('04/09/2026')
  })
})

describe('formatLongDate', () => {
  it('spells the month in the active language', () => {
    expect(normalise(formatLongDate('2026-09-04', 'pt-PT'))).toContain('setembro')
    expect(normalise(formatLongDate('2026-09-04', 'en-GB'))).toContain('September')
  })
})

describe('formatCurrency', () => {
  it('renders euros from integer cents', () => {
    expect(normalise(formatCurrency(123456, 'pt-PT'))).toBe('1 234,56 €')
    expect(normalise(formatCurrency(123456, 'en-GB'))).toBe('€1,234.56')
  })

  it('handles zero and negative amounts', () => {
    expect(normalise(formatCurrency(0, 'pt-PT'))).toBe('0,00 €')
    expect(normalise(formatCurrency(-500, 'en-GB'))).toBe('-€5.00')
  })
})

describe('formatQuarter', () => {
  it('renders period labels idiomatically', () => {
    expect(formatQuarter('2026-Q1', 'pt-PT')).toBe('1.º trimestre de 2026')
    expect(formatQuarter('2026-Q1', 'en-GB')).toBe('Q1 2026')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/web test format`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: Implement the format module**

`apps/web/src/i18n/format.ts`:

```ts
export type SupportedLocale = 'pt-PT' | 'en-GB'

/** Deadlines are calendar dates, so they are parsed as UTC and never shifted. */
function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`)
}

export function formatDate(isoDate: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcDate(isoDate))
}

export function formatLongDate(isoDate: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcDate(isoDate))
}

export function formatCurrency(amountCents: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(
    amountCents / 100,
  )
}

/** Turns a stored period label such as `2026-Q1` into readable text. */
export function formatQuarter(periodLabel: string, locale: SupportedLocale): string {
  const [year, quarter] = periodLabel.split('-Q')
  if (year === undefined || quarter === undefined) return periodLabel

  return locale === 'pt-PT' ? `${quarter}.º trimestre de ${year}` : `Q${quarter} ${year}`
}
```

- [ ] **Step 4: Run the format tests**

Run: `pnpm --filter @ledger-hq/web test format`
Expected: PASS, six cases. If a currency case fails on spacing, confirm the `normalise` helper is being applied — Node's ICU may use a narrow no-break space.

- [ ] **Step 5: Write the locale files**

`apps/web/src/i18n/locales/pt/common.json`:

```json
{
  "appName": "Ledger HQ",
  "nav": { "clients": "Clientes" },
  "actions": {
    "save": "Guardar",
    "cancel": "Cancelar",
    "create": "Criar",
    "edit": "Editar",
    "archive": "Arquivar",
    "restore": "Restaurar",
    "signIn": "Entrar",
    "signOut": "Sair"
  },
  "connection": {
    "online": "Ligado",
    "offline": "Sem ligação ao servidor",
    "lastSync": "Última sincronização: {{time}}"
  },
  "language": { "label": "Idioma", "pt-PT": "Português", "en-GB": "English" }
}
```

`apps/web/src/i18n/locales/en/common.json`:

```json
{
  "appName": "Ledger HQ",
  "nav": { "clients": "Clients" },
  "actions": {
    "save": "Save",
    "cancel": "Cancel",
    "create": "Create",
    "edit": "Edit",
    "archive": "Archive",
    "restore": "Restore",
    "signIn": "Sign in",
    "signOut": "Sign out"
  },
  "connection": {
    "online": "Online",
    "offline": "No connection to the server",
    "lastSync": "Last synchronised: {{time}}"
  },
  "language": { "label": "Language", "pt-PT": "Português", "en-GB": "English" }
}
```

`apps/web/src/i18n/locales/pt/domain.json`:

```json
{
  "clientKind": { "COMPANY": "Empresa", "INDIVIDUAL": "Pessoa singular" },
  "legalForm": {
    "LDA": "Sociedade por quotas",
    "UNIPESSOAL_LDA": "Unipessoal por quotas",
    "SA": "Sociedade anónima",
    "ASSOCIATION": "Associação",
    "OTHER": "Outra"
  },
  "accounting": { "ORGANIZED": "Organizada", "SIMPLIFIED": "Não organizada" },
  "vatRegime": {
    "MONTHLY": "Mensal",
    "QUARTERLY": "Trimestral",
    "EXEMPT": "Isento",
    "NOT_APPLICABLE": "Não aplicável"
  },
  "incomeTax": {
    "CIT": "IRC",
    "PIT_CATEGORY_B": "IRS categoria B",
    "PIT_EMPLOYMENT_ONLY": "IRS trabalho dependente"
  }
}
```

`apps/web/src/i18n/locales/en/domain.json`:

```json
{
  "clientKind": { "COMPANY": "Company", "INDIVIDUAL": "Individual" },
  "legalForm": {
    "LDA": "Private limited company",
    "UNIPESSOAL_LDA": "Single-member private limited company",
    "SA": "Public limited company",
    "ASSOCIATION": "Association",
    "OTHER": "Other"
  },
  "accounting": { "ORGANIZED": "Organized", "SIMPLIFIED": "Simplified" },
  "vatRegime": {
    "MONTHLY": "Monthly",
    "QUARTERLY": "Quarterly",
    "EXEMPT": "Exempt",
    "NOT_APPLICABLE": "Not applicable"
  },
  "incomeTax": {
    "CIT": "Corporate income tax",
    "PIT_CATEGORY_B": "Personal income tax, category B",
    "PIT_EMPLOYMENT_ONLY": "Personal income tax, employment only"
  }
}
```

`apps/web/src/i18n/locales/pt/errors.json`:

```json
{
  "common": {
    "validation_failed": "Há campos por corrigir.",
    "not_found": "Registo não encontrado.",
    "offline": "Sem ligação ao servidor.",
    "unexpected": "Ocorreu um erro inesperado."
  },
  "auth": {
    "invalid_credentials": "Credenciais inválidas.",
    "already_bootstrapped": "A conta já existe.",
    "not_bootstrapped": "Ainda não existe conta configurada.",
    "session_expired": "A sessão expirou. Entra outra vez."
  },
  "clients": {
    "tax_id_taken": "Já existe um cliente com o NIF {{taxId}}.",
    "archived": "O cliente está arquivado."
  },
  "fiscal_profile": {
    "open_activity_required_for_company": "Uma empresa tem sempre atividade aberta.",
    "vat_regime_requires_open_activity": "Sem atividade aberta, o regime de IVA tem de ser «Não aplicável».",
    "income_tax_incompatible_with_kind": "O imposto sobre o rendimento não corresponde ao tipo de cliente.",
    "employees_flag_not_allowed_for_individual": "Uma pessoa singular não pode ter empregados neste registo."
  },
  "employment": {
    "employer_must_be_company": "O empregador tem de ser uma empresa.",
    "employee_must_be_individual": "O empregado tem de ser uma pessoa singular.",
    "self_employment": "Um cliente não pode empregar-se a si próprio.",
    "overlapping_spell": "Já existe um vínculo sobreposto para este par.",
    "ended_before_started": "A data de cessação é anterior à de admissão."
  }
}
```

`apps/web/src/i18n/locales/en/errors.json`:

```json
{
  "common": {
    "validation_failed": "Some fields need correcting.",
    "not_found": "Record not found.",
    "offline": "No connection to the server.",
    "unexpected": "Something went wrong."
  },
  "auth": {
    "invalid_credentials": "Invalid credentials.",
    "already_bootstrapped": "The account already exists.",
    "not_bootstrapped": "No account has been set up yet.",
    "session_expired": "Your session expired. Sign in again."
  },
  "clients": {
    "tax_id_taken": "A client with tax number {{taxId}} already exists.",
    "archived": "This client is archived."
  },
  "fiscal_profile": {
    "open_activity_required_for_company": "A company always has open activity.",
    "vat_regime_requires_open_activity": "Without open activity the VAT regime must be “Not applicable”.",
    "income_tax_incompatible_with_kind": "The income tax type does not match the client kind.",
    "employees_flag_not_allowed_for_individual": "An individual cannot have employees in this register."
  },
  "employment": {
    "employer_must_be_company": "The employer must be a company.",
    "employee_must_be_individual": "The employee must be an individual.",
    "self_employment": "A client cannot employ themselves.",
    "overlapping_spell": "An overlapping spell already exists for this pair.",
    "ended_before_started": "The end date is before the start date."
  }
}
```

Create `clients.json` and `employments.json` in both locales with the keys the screens in Tasks 15 and 16 use. Start each pair with:

`apps/web/src/i18n/locales/pt/clients.json`:

```json
{
  "title": "Clientes",
  "empty": "Ainda não há clientes.",
  "filter": { "all": "Todos", "search": "Pesquisar por nome ou NIF", "showArchived": "Mostrar arquivados" },
  "form": {
    "name": { "label": "Nome" },
    "taxId": { "label": "NIF" },
    "kind": { "label": "Tipo" },
    "legalForm": { "label": "Forma jurídica" },
    "accounting": { "label": "Contabilidade" },
    "socialSecurityNo": { "label": "NISS" },
    "dateOfBirth": { "label": "Data de nascimento" },
    "email": { "label": "Email" },
    "phone": { "label": "Telefone" },
    "notes": { "label": "Notas" }
  },
  "profile": {
    "title": "Perfil fiscal",
    "hasOpenActivity": "Atividade aberta",
    "vatRegime": "Regime de IVA",
    "incomeTax": "Imposto sobre o rendimento",
    "hasEmployees": "Tem empregados",
    "hasWithholding": "Faz retenções na fonte",
    "isVatCashBasis": "IVA de caixa",
    "startedAt": "Início"
  }
}
```

`apps/web/src/i18n/locales/en/clients.json`:

```json
{
  "title": "Clients",
  "empty": "No clients yet.",
  "filter": { "all": "All", "search": "Search by name or tax number", "showArchived": "Show archived" },
  "form": {
    "name": { "label": "Name" },
    "taxId": { "label": "Tax number" },
    "kind": { "label": "Kind" },
    "legalForm": { "label": "Legal form" },
    "accounting": { "label": "Accounting" },
    "socialSecurityNo": { "label": "Social security number" },
    "dateOfBirth": { "label": "Date of birth" },
    "email": { "label": "Email" },
    "phone": { "label": "Phone" },
    "notes": { "label": "Notes" }
  },
  "profile": {
    "title": "Fiscal profile",
    "hasOpenActivity": "Open activity",
    "vatRegime": "VAT regime",
    "incomeTax": "Income tax",
    "hasEmployees": "Has employees",
    "hasWithholding": "Withholds tax at source",
    "isVatCashBasis": "VAT cash basis",
    "startedAt": "Start date"
  }
}
```

`apps/web/src/i18n/locales/pt/employments.json`:

```json
{
  "employeesTitle": "Empregados",
  "employmentsTitle": "Vínculos",
  "empty": "Sem vínculos registados.",
  "add": "Adicionar vínculo",
  "end": "Cessar vínculo",
  "current": "Em vigor",
  "columns": { "person": "Pessoa", "company": "Empresa", "jobTitle": "Cargo", "period": "Período" },
  "form": {
    "employee": { "label": "Pessoa" },
    "employer": { "label": "Empresa" },
    "startedOn": { "label": "Data de admissão" },
    "endedOn": { "label": "Data de cessação" },
    "jobTitle": { "label": "Cargo" }
  }
}
```

`apps/web/src/i18n/locales/en/employments.json`:

```json
{
  "employeesTitle": "Employees",
  "employmentsTitle": "Employments",
  "empty": "No employment records.",
  "add": "Add employment",
  "end": "End employment",
  "current": "Current",
  "columns": { "person": "Person", "company": "Company", "jobTitle": "Job title", "period": "Period" },
  "form": {
    "employee": { "label": "Person" },
    "employer": { "label": "Company" },
    "startedOn": { "label": "Start date" },
    "endedOn": { "label": "End date" },
    "jobTitle": { "label": "Job title" }
  }
}
```

- [ ] **Step 6: Write the locale coverage test**

`apps/web/src/i18n/locales/locales.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ACCOUNTING_VALUES,
  CLIENT_KIND_VALUES,
  ERROR_CODES,
  INCOME_TAX_VALUES,
  LEGAL_FORM_VALUES,
  VAT_REGIME_VALUES,
} from '@ledger-hq/domain'
import * as pt from './pt'
import * as en from './en'

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]

  return Object.entries(value).flatMap(([key, nested]) =>
    flatten(nested, prefix === '' ? key : `${prefix}.${key}`),
  )
}

describe('locale bundles', () => {
  it('define exactly the same keys', () => {
    const ptKeys = flatten(pt.resources).sort()
    const enKeys = flatten(en.resources).sort()

    expect(enKeys).toEqual(ptKeys)
  })
})

describe('domain enumerations', () => {
  it.each([
    ['clientKind', CLIENT_KIND_VALUES],
    ['legalForm', LEGAL_FORM_VALUES],
    ['accounting', ACCOUNTING_VALUES],
    ['vatRegime', VAT_REGIME_VALUES],
    ['incomeTax', INCOME_TAX_VALUES],
  ])('translate every %s value in both locales', (group, values) => {
    for (const value of values) {
      expect(pt.resources.domain[group as keyof typeof pt.resources.domain]).toHaveProperty(value)
      expect(en.resources.domain[group as keyof typeof en.resources.domain]).toHaveProperty(value)
    }
  })
})

describe('error codes', () => {
  it('every registered code has a message in both locales', () => {
    const ptKeys = new Set(flatten(pt.resources.errors))
    const enKeys = new Set(flatten(en.resources.errors))

    for (const code of ERROR_CODES) {
      expect(ptKeys.has(code)).toBe(true)
      expect(enKeys.has(code)).toBe(true)
    }
  })
})
```

- [ ] **Step 7: Wire i18next**

`apps/web/src/i18n/locales/pt/index.ts`:

```ts
import clients from './clients.json'
import common from './common.json'
import domain from './domain.json'
import employments from './employments.json'
import errors from './errors.json'

export const resources = { clients, common, domain, employments, errors }
```

`apps/web/src/i18n/locales/en/index.ts` is identical with the `en` JSON imports.

`apps/web/src/i18n/index.ts`:

```ts
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources as en } from './locales/en'
import { resources as pt } from './locales/pt'

export const SUPPORTED_LOCALES = ['pt-PT', 'en-GB'] as const

// Declared once in ./format and re-exported here, so the two modules cannot
// drift into two incompatible unions with the same name.
export type { SupportedLocale } from './format'
import type { SupportedLocale } from './format'

const STORAGE_KEY = 'lhq_locale'

function initialLocale(): SupportedLocale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'pt-PT' || stored === 'en-GB') return stored

  return navigator.language.startsWith('en') ? 'en-GB' : 'pt-PT'
}

export async function initI18n(): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources: { 'pt-PT': pt, 'en-GB': en },
    lng: initialLocale(),
    fallbackLng: 'pt-PT',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

  document.documentElement.lang = i18next.language
}

export async function setLocale(locale: SupportedLocale): Promise<void> {
  localStorage.setItem(STORAGE_KEY, locale)
  await i18next.changeLanguage(locale)
  document.documentElement.lang = locale
}
```

`apps/web/src/i18n/i18next.d.ts`:

```ts
import type { resources } from './locales/pt'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof resources
  }
}
```

`apps/web/src/shell/LanguageSwitcher.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, setLocale } from '../i18n'
import type { SupportedLocale } from '../i18n'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')

  return (
    <label className="text-sm">
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={i18n.language}
        onChange={(event) => void setLocale(event.target.value as SupportedLocale)}
        className="rounded border border-slate-300 px-2 py-1"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`language.${locale}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
```

Await `initI18n()` before rendering in `apps/web/src/main.tsx`:

```tsx
import { initI18n } from './i18n'

await initI18n()
```

Place that line above `createRoot(...)`, and add `<LanguageSwitcher />` to the `AppLayout` navigation.

- [ ] **Step 8: Add the CI key-parity script**

`apps/web/scripts/check-locales.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localesDir = new URL('../src/i18n/locales', import.meta.url).pathname
const locales = ['pt', 'en']

function flatten(value, prefix = '') {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, nested]) =>
    flatten(nested, prefix === '' ? key : `${prefix}.${key}`),
  )
}

function keysFor(locale) {
  const dir = join(localesDir, locale)
  const keys = new Set()

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const namespace = file.replace(/\.json$/, '')
    const contents = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    for (const key of flatten(contents)) keys.add(`${namespace}:${key}`)
  }

  return keys
}

const [pt, en] = locales.map(keysFor)
const missingInEn = [...pt].filter((key) => !en.has(key))
const missingInPt = [...en].filter((key) => !pt.has(key))

if (missingInEn.length > 0 || missingInPt.length > 0) {
  console.error('Locale bundles diverge.')
  for (const key of missingInEn) console.error(`  missing in en: ${key}`)
  for (const key of missingInPt) console.error(`  missing in pt: ${key}`)
  process.exit(1)
}

console.log(`Locale bundles agree on ${pt.size} keys.`)
```

Add `no-console` exemption for the script by appending to `packages/config/eslint.config.js`:

```js
  { files: ['**/scripts/**'], rules: { 'no-console': 'off' } },
```

Add the literal-string rule for web components in the same file:

```js
  {
    files: ['apps/web/src/**/*.tsx'],
    plugins: { i18next: (await import('eslint-plugin-i18next')).default },
    rules: { 'i18next/no-literal-string': ['error', { markupOnly: true }] },
  },
```

Add to `.github/workflows/ci.yml` after `pnpm test`:

```yaml
      - run: pnpm --filter @ledger-hq/web i18n:check
```

- [ ] **Step 9: Run everything**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web i18n:check && pnpm --filter @ledger-hq/web lint`
Expected: PASS. The locale test fails if any `ERROR_CODES` entry lacks a message — add it to both `errors.json` files rather than deleting the code.

- [ ] **Step 10: Commit**

```bash
git add apps/web packages/config .github
git commit -m "feat(web): add typed pt-PT and en-GB internationalisation with CI parity checks"
```

---

### Task 14: Login and first-run setup in the browser

**Files:**
- Create: `apps/web/src/auth/credentials.ts`, `apps/web/src/auth/session.ts`
- Create: `apps/web/src/auth/LoginPage.tsx`, `apps/web/src/auth/SetupPage.tsx`
- Create: `apps/web/src/shell/ErrorMessage.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/auth/credentials.test.ts`, `apps/web/src/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError`, `deriveAuthHash`, `deriveMasterKey`, `fromBase64`, `generateSalt`, `toBase64`.
- Produces:
  - `deriveAuthCredentials(email: string, masterPassword: string): Promise<{ authHash: string }>` — fetches the salt and derives.
  - `createAccount(email, masterPassword, locale): Promise<void>` — generates a salt, derives, posts `bootstrap`.
  - `signIn(email, masterPassword): Promise<void>`, `signOut(): Promise<void>`.
  - `useSession()` — React Query hook returning `{ id, email, locale }` or throwing `ApiError`.
  - `useBootstrapRequired()` — hook returning `boolean | undefined`.
  - `ErrorMessage({ error })` — translates an `ApiError` code through the `errors` namespace.

**The master password never leaves this file.** `deriveAuthCredentials` takes it, derives, and returns only the auth hash. No component stores it in state beyond the form field, and no code path puts it in a query cache.

- [ ] **Step 1: Write the failing credentials test**

`apps/web/src/auth/credentials.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBase64 } from '@ledger-hq/crypto'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiFetch, ApiError: class extends Error {} }))

const { createAccount, deriveAuthCredentials } = await import('./credentials')

afterEach(() => {
  apiFetch.mockReset()
})

describe('deriveAuthCredentials', () => {
  it('asks the server for the salt and returns only the auth hash', async () => {
    const kdfSalt = toBase64(new Uint8Array(16).fill(7))
    apiFetch.mockResolvedValue({ kdfSalt, params: {} })

    const result = await deriveAuthCredentials('paulo@example.com', 'a long master password')

    expect(apiFetch).toHaveBeenCalledWith('/auth/kdf?email=paulo%40example.com')
    expect(result.authHash).toHaveLength(44)
    expect(Object.keys(result)).toEqual(['authHash'])
  })

  it('produces a different hash for a different password', async () => {
    const kdfSalt = toBase64(new Uint8Array(16).fill(7))
    apiFetch.mockResolvedValue({ kdfSalt, params: {} })

    const first = await deriveAuthCredentials('paulo@example.com', 'password one')
    const second = await deriveAuthCredentials('paulo@example.com', 'password two')

    expect(first.authHash).not.toBe(second.authHash)
  })
})

describe('createAccount', () => {
  it('generates a fresh salt and never sends the password', async () => {
    apiFetch.mockResolvedValue({})

    await createAccount('paulo@example.com', 'a long master password', 'pt-PT')

    const [path, options] = apiFetch.mock.calls[0] ?? []
    expect(path).toBe('/auth/bootstrap')
    expect(options.method).toBe('POST')
    expect(options.body.kdfSalt).toHaveLength(24)
    expect(options.body.authHash).toHaveLength(44)
    expect(JSON.stringify(options.body)).not.toContain('a long master password')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/web test credentials`
Expected: FAIL — `Cannot find module './credentials'`.

- [ ] **Step 3: Implement credentials and session helpers**

`apps/web/src/auth/credentials.ts`:

```ts
import { deriveAuthHash, deriveMasterKey, fromBase64, generateSalt, toBase64 } from '@ledger-hq/crypto'
import { apiFetch } from '../api/client'

type KdfResponse = { kdfSalt: string }

/**
 * Derives the only credential the server ever sees. The master password stays
 * in this function's scope: it is never returned, stored or logged.
 */
export async function deriveAuthCredentials(
  email: string,
  masterPassword: string,
): Promise<{ authHash: string }> {
  const { kdfSalt } = await apiFetch<KdfResponse>(`/auth/kdf?email=${encodeURIComponent(email)}`)

  const masterKey = await deriveMasterKey(masterPassword, fromBase64(kdfSalt))

  return { authHash: toBase64(await deriveAuthHash(masterKey, masterPassword)) }
}

export async function createAccount(
  email: string,
  masterPassword: string,
  locale: 'pt-PT' | 'en-GB',
): Promise<void> {
  const kdfSalt = toBase64(generateSalt())
  const masterKey = await deriveMasterKey(masterPassword, fromBase64(kdfSalt))
  const authHash = toBase64(await deriveAuthHash(masterKey, masterPassword))

  await apiFetch('/auth/bootstrap', {
    method: 'POST',
    body: { email, kdfSalt, authHash, locale },
  })
}

export async function signIn(email: string, masterPassword: string): Promise<void> {
  const { authHash } = await deriveAuthCredentials(email, masterPassword)

  await apiFetch('/auth/login', { method: 'POST', body: { email, authHash } })
}

export async function signOut(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' })
}
```

`apps/web/src/auth/session.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'

export type Session = { id: string; email: string; locale: string }

export const SESSION_QUERY_KEY = ['session'] as const

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiFetch<Session>('/auth/session'),
    retry: false,
  })
}

export function useBootstrapRequired() {
  return useQuery({
    queryKey: ['bootstrap-required'],
    queryFn: () => apiFetch<{ required: boolean }>('/auth/bootstrap-required'),
    retry: false,
  })
}
```

- [ ] **Step 4: Run the credentials tests**

Run: `pnpm --filter @ledger-hq/web test credentials`
Expected: PASS, three cases. Each Argon2id derivation takes roughly 150 ms at 64 MiB, so the file takes a few seconds.

- [ ] **Step 5: Write the failing login page test**

`apps/web/src/auth/LoginPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initI18n } from '../i18n'

import { ApiError } from '../api/client'

const signIn = vi.hoisted(() => vi.fn())
vi.mock('./credentials', () => ({ signIn }))

const { LoginPage } = await import('./LoginPage')

await initI18n()

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <LoginPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('LoginPage', () => {
  it('submits the email and master password', async () => {
    signIn.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'a long master password')
    await userEvent.click(screen.getByRole('button', { name: /entrar|sign in/i }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('paulo@example.com', 'a long master password')
    })
  })

  it('shows a translated message when the credentials are rejected', async () => {
    // A real ApiError, because ErrorMessage translates only instances of it.
    signIn.mockRejectedValue(new ApiError('auth.invalid_credentials', {}, 401))
    renderPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'paulo@example.com')
    await userEvent.type(screen.getByLabelText(/palavra-passe|master password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /entrar|sign in/i }))

    expect(await screen.findByText(/credenciais inválidas/i)).toBeInTheDocument()
  })
})
```

Add the auth keys used above to both `common.json` files under an `auth` section: `auth.emailLabel`, `auth.masterPasswordLabel`, `auth.setupTitle`, `auth.loginTitle`, `auth.recoveryWarning`. Use "Palavra-passe mestra" and "Master password" as the labels.

- [ ] **Step 6: Implement the pages**

`apps/web/src/shell/ErrorMessage.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation('errors')

  if (error === null || error === undefined) return null

  const code = error instanceof ApiError ? error.code : 'common.unexpected'
  const params = error instanceof ApiError ? error.params : {}

  return (
    <p role="alert" className="text-sm text-red-700">
      {t(code, params as Record<string, string>)}
    </p>
  )
}
```

`apps/web/src/auth/LoginPage.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorMessage } from '../shell/ErrorMessage'
import { signIn } from './credentials'
import { SESSION_QUERY_KEY } from './session'

export function LoginPage() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () => signIn(email, masterPassword),
    onSuccess: async () => {
      setMasterPassword('')
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
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

      <ErrorMessage error={mutation.error} />

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {t('actions.signIn')}
      </button>
    </form>
  )
}
```

`apps/web/src/auth/SetupPage.tsx` is the same form plus a confirmation field and a prominent warning rendered from `t('auth.recoveryWarning')`, calling `createAccount(email, masterPassword, i18n.language)` instead of `signIn`. It must refuse to submit when the two password fields differ.

- [ ] **Step 7: Gate the router**

In `apps/web/src/router.tsx`, wrap the authenticated routes in a component that reads `useSession()` and `useBootstrapRequired()`:

```tsx
import { useBootstrapRequired, useSession } from './auth/session'
import { LoginPage } from './auth/LoginPage'
import { SetupPage } from './auth/SetupPage'

export function RequireSession({ children }: { children: React.ReactNode }) {
  const bootstrap = useBootstrapRequired()
  const session = useSession()

  if (bootstrap.isPending || session.isPending) return null
  if (bootstrap.data?.required === true) return <SetupPage />
  if (session.isError) return <LoginPage />

  return <>{children}</>
}
```

Render `RequireSession` around `<Outlet />` inside `AppLayout`.

- [ ] **Step 8: Run the tests and commit**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web i18n:check`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): derive login credentials in the browser and gate the application"
```

---

### Task 15: Client register screens

**Files:**
- Create: `apps/web/src/clients/api.ts`, `apps/web/src/clients/ClientListPage.tsx`, `apps/web/src/clients/ClientFormPage.tsx`, `apps/web/src/clients/ClientDetailPage.tsx`, `apps/web/src/clients/FiscalProfileForm.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/clients/ClientListPage.test.tsx`, `apps/web/src/clients/ClientFormPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `createClientSchema`, `fiscalProfileInputSchema`, `checkFiscalProfileConsistency`, the enum arrays, `formatDate`.
- Produces:
  - `apps/web/src/clients/api.ts` exporting `listClients(filters)`, `getClient(id)`, `createClient(input)`, `updateClient(id, input)`, `archiveClient(id)`, `restoreClient(id)`, `getFiscalProfile(clientId)`, `putFiscalProfile(clientId, input)`, and `type ClientResponse` mirroring the API mapper's shape.
  - Routes `/clients`, `/clients/new`, `/clients/$clientId`.

- [ ] **Step 1: Write the failing list test**

`apps/web/src/clients/ClientListPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listClients = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listClients }))

const { ClientListPage } = await import('./ClientListPage')

await initI18n()

const company = {
  id: '1',
  kind: 'COMPANY',
  name: 'Padaria Central, Lda.',
  taxId: '501442600',
  accounting: 'ORGANIZED',
  legalForm: 'LDA',
  email: null,
  phone: null,
  notes: null,
  socialSecurityNo: null,
  dateOfBirth: null,
  archivedAt: null,
}

const person = { ...company, id: '2', kind: 'INDIVIDUAL', name: 'Maria Santos', taxId: '123456789', legalForm: null }

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ClientListPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ClientListPage', () => {
  it('lists clients with their kind', async () => {
    listClients.mockResolvedValue([company, person])
    renderPage()

    expect(await screen.findByText('Padaria Central, Lda.')).toBeInTheDocument()
    expect(screen.getByText('Maria Santos')).toBeInTheDocument()
    expect(screen.getAllByText(/Empresa|Pessoa singular/)).toHaveLength(2)
  })

  it('shows an empty state', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText(/ainda não há clientes/i)).toBeInTheDocument()
  })

  it('passes the search term to the query', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.type(await screen.findByRole('searchbox'), 'padaria')

    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'padaria' }))
    })
  })

  it('filters by kind', async () => {
    listClients.mockResolvedValue([])
    renderPage()

    await userEvent.selectOptions(await screen.findByLabelText(/tipo|kind/i), 'COMPANY')

    await vi.waitFor(() => {
      expect(listClients).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'COMPANY' }))
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/web test ClientListPage`
Expected: FAIL — `Cannot find module './ClientListPage'`.

- [ ] **Step 3: Implement the client API module**

`apps/web/src/clients/api.ts`:

```ts
import type { ClientKind, CreateClientInput, FiscalProfileInput, UpdateClientInput } from '@ledger-hq/domain'
import { apiFetch } from '../api/client'

export type ClientResponse = {
  id: string
  kind: ClientKind
  name: string
  taxId: string
  accounting: 'ORGANIZED' | 'SIMPLIFIED'
  email: string | null
  phone: string | null
  notes: string | null
  legalForm: string | null
  socialSecurityNo: string | null
  dateOfBirth: string | null
  archivedAt: string | null
}

export type ClientFilters = { kind?: ClientKind; search?: string; includeArchived?: boolean }

export function listClients(filters: ClientFilters): Promise<ClientResponse[]> {
  const query = new URLSearchParams()
  if (filters.kind) query.set('kind', filters.kind)
  if (filters.search) query.set('search', filters.search)
  if (filters.includeArchived) query.set('includeArchived', 'true')

  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiFetch<ClientResponse[]>(`/clients${suffix}`)
}

export const getClient = (id: string) => apiFetch<ClientResponse>(`/clients/${id}`)

export const createClient = (input: CreateClientInput) =>
  apiFetch<ClientResponse>('/clients', { method: 'POST', body: input })

export const updateClient = (id: string, input: UpdateClientInput) =>
  apiFetch<ClientResponse>(`/clients/${id}`, { method: 'PATCH', body: input })

export const archiveClient = (id: string) =>
  apiFetch<ClientResponse>(`/clients/${id}/archive`, { method: 'POST' })

export const restoreClient = (id: string) =>
  apiFetch<ClientResponse>(`/clients/${id}/restore`, { method: 'POST' })

export type FiscalProfileResponse = FiscalProfileInput & { clientId: string; updatedAt: string }

export const getFiscalProfile = (clientId: string) =>
  apiFetch<FiscalProfileResponse>(`/clients/${clientId}/fiscal-profile`)

export const putFiscalProfile = (clientId: string, input: FiscalProfileInput) =>
  apiFetch<FiscalProfileResponse>(`/clients/${clientId}/fiscal-profile`, { method: 'PUT', body: input })
```

- [ ] **Step 4: Implement the list page**

`apps/web/src/clients/ClientListPage.tsx`:

```tsx
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CLIENT_KIND_VALUES } from '@ledger-hq/domain'
import type { ClientKind } from '@ledger-hq/domain'
import { listClients } from './api'
import type { ClientFilters } from './api'

export function ClientListPage() {
  const { t } = useTranslation(['clients', 'common', 'domain'])
  const [filters, setFilters] = useState<ClientFilters>({})

  const clients = useQuery({
    queryKey: ['clients', filters],
    queryFn: () => listClients(filters),
    placeholderData: keepPreviousData,
  })

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('clients:title')}</h1>
        <Link to="/clients/new" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
          {t('common:actions.create')}
        </Link>
      </header>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder={t('clients:filter.search')}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />

        <label className="flex items-center gap-2 text-sm">
          {t('clients:form.kind.label')}
          <select
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                kind: event.target.value === '' ? undefined : (event.target.value as ClientKind),
              }))
            }
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="">{t('clients:filter.all')}</option>
            {CLIENT_KIND_VALUES.map((kind) => (
              <option key={kind} value={kind}>
                {t(`domain:clientKind.${kind}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            onChange={(event) =>
              setFilters((current) => ({ ...current, includeArchived: event.target.checked }))
            }
          />
          {t('clients:filter.showArchived')}
        </label>
      </div>

      {clients.data?.length === 0 ? (
        <p className="text-sm text-slate-600">{t('clients:empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {clients.data?.map((client) => (
            <li key={client.id} className="flex items-center justify-between px-4 py-3">
              <Link to="/clients/$clientId" params={{ clientId: client.id }} className="font-medium">
                {client.name}
              </Link>
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {t(`domain:clientKind.${client.kind}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run the list tests**

Run: `pnpm --filter @ledger-hq/web test ClientListPage`
Expected: PASS, four cases.

- [ ] **Step 6: Write the failing form test**

`apps/web/src/clients/ClientFormPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const createClient = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ createClient }))

const { ClientFormPage } = await import('./ClientFormPage')

await initI18n()

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ClientFormPage />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ClientFormPage', () => {
  it('shows the legal form field for a company and hides the personal fields', async () => {
    renderPage()

    await userEvent.selectOptions(screen.getByLabelText(/tipo|kind/i), 'COMPANY')

    expect(screen.getByLabelText(/forma jurídica|legal form/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/NISS|social security/i)).not.toBeInTheDocument()
  })

  it('shows the personal fields for an individual and hides the legal form', async () => {
    renderPage()

    await userEvent.selectOptions(screen.getByLabelText(/tipo|kind/i), 'INDIVIDUAL')

    expect(screen.getByLabelText(/NISS|social security/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/forma jurídica|legal form/i)).not.toBeInTheDocument()
  })

  it('rejects an invalid tax number before calling the API', async () => {
    renderPage()

    await userEvent.selectOptions(screen.getByLabelText(/tipo|kind/i), 'COMPANY')
    await userEvent.type(screen.getByLabelText(/nome|^name/i), 'Padaria')
    await userEvent.type(screen.getByLabelText(/NIF|tax number/i), '000000000')
    await userEvent.click(screen.getByRole('button', { name: /guardar|save/i }))

    expect(createClient).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('submits a valid company', async () => {
    createClient.mockResolvedValue({ id: '1' })
    renderPage()

    await userEvent.selectOptions(screen.getByLabelText(/tipo|kind/i), 'COMPANY')
    await userEvent.type(screen.getByLabelText(/nome|^name/i), 'Padaria Central, Lda.')
    await userEvent.type(screen.getByLabelText(/NIF|tax number/i), '501442600')
    await userEvent.click(screen.getByRole('button', { name: /guardar|save/i }))

    await vi.waitFor(() => {
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'COMPANY', taxId: '501442600', legalForm: 'LDA' }),
      )
    })
  })
})
```

- [ ] **Step 7: Implement the form**

`apps/web/src/clients/ClientFormPage.tsx` renders a `kind` selector that switches between two field sets, validates with `createClientSchema.safeParse` before submitting, renders per-field issues through the `errors` namespace, and calls `createClient` on success. Default `legalForm` to `LDA` and `accounting` to `ORGANIZED` for companies, `SIMPLIFIED` for individuals. Strip empty optional strings to `undefined` before parsing, because the schema rejects an empty email rather than treating it as absent.

`apps/web/src/clients/ClientDetailPage.tsx` shows the client's fields, the archive and restore buttons, the `FiscalProfileForm`, and the employment section added in Task 16.

`apps/web/src/clients/FiscalProfileForm.tsx` renders the seven profile fields, runs `checkFiscalProfileConsistency(client.kind, values)` on every change to show violations live, disables submit while violations exist, and calls `putFiscalProfile`. It hides `hasEmployees` entirely for individuals and forces `hasOpenActivity` to true and read-only for companies — both rules come from `checkFiscalProfileConsistency`, so the form and the API cannot disagree.

- [ ] **Step 8: Register the routes**

Add `/clients`, `/clients/new` and `/clients/$clientId` to `apps/web/src/router.tsx` as children of the root route.

- [ ] **Step 9: Run everything and commit**

Run: `pnpm --filter @ledger-hq/web test && pnpm --filter @ledger-hq/web lint && pnpm --filter @ledger-hq/web i18n:check`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): add client register screens with kind-aware forms"
```

---

### Task 16: Employment sections

**Files:**
- Create: `apps/web/src/employments/api.ts`, `apps/web/src/employments/EmploymentSection.tsx`, `apps/web/src/employments/AddEmploymentForm.tsx`
- Modify: `apps/web/src/clients/ClientDetailPage.tsx`
- Test: `apps/web/src/employments/EmploymentSection.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `listClients`, `formatDate`, `createEmploymentSchema`.
- Produces:
  - `listEmployments(clientId)`, `createEmployment(input)`, `endEmployment(id, endedOn)` and `type EmploymentResponse` matching the API controller's response shape exactly.
  - `EmploymentSection({ client })` — renders the *Employees* heading for a company and *Employments* for an individual, from the same data.

- [ ] **Step 1: Write the failing test**

`apps/web/src/employments/EmploymentSection.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'

const listEmployments = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listEmployments, createEmployment: vi.fn(), endEmployment: vi.fn() }))
vi.mock('../clients/api', () => ({ listClients: vi.fn().mockResolvedValue([]) }))

const { EmploymentSection } = await import('./EmploymentSection')

await initI18n()

const spell = {
  id: 'e1',
  employerId: 'c1',
  employerName: 'Padaria Central, Lda.',
  employeeId: 'p1',
  employeeName: 'Maria Santos',
  startedOn: '2024-01-15',
  endedOn: null,
  jobTitle: 'Bookkeeper',
  notes: null,
}

function renderSection(kind: 'COMPANY' | 'INDIVIDUAL', id: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <EmploymentSection client={{ id, kind, name: 'X' }} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('EmploymentSection', () => {
  it('shows the counterparty name from a company page', async () => {
    listEmployments.mockResolvedValue([spell])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText('Maria Santos')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /empregados|employees/i })).toBeInTheDocument()
  })

  it('shows the counterparty name from a person page', async () => {
    listEmployments.mockResolvedValue([spell])
    renderSection('INDIVIDUAL', 'p1')

    expect(await screen.findByText('Padaria Central, Lda.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /vínculos|employments/i })).toBeInTheDocument()
  })

  it('marks an open spell as current', async () => {
    listEmployments.mockResolvedValue([spell])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/em vigor|current/i)).toBeInTheDocument()
  })

  it('renders dates in day-first format', async () => {
    listEmployments.mockResolvedValue([{ ...spell, endedOn: '2025-06-30' }])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/15\/01\/2024/)).toBeInTheDocument()
    expect(screen.getByText(/30\/06\/2025/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    listEmployments.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/sem vínculos|no employment/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/web test EmploymentSection`
Expected: FAIL — `Cannot find module './EmploymentSection'`.

- [ ] **Step 3: Implement the API module**

`apps/web/src/employments/api.ts`:

```ts
import type { CreateEmploymentInput } from '@ledger-hq/domain'
import { apiFetch } from '../api/client'

export type EmploymentResponse = {
  id: string
  employerId: string
  employerName: string
  employeeId: string
  employeeName: string
  startedOn: string
  endedOn: string | null
  jobTitle: string | null
  notes: string | null
}

export const listEmployments = (clientId: string) =>
  apiFetch<EmploymentResponse[]>(`/clients/${clientId}/employments`)

export const createEmployment = (input: CreateEmploymentInput) =>
  apiFetch<EmploymentResponse>('/employments', { method: 'POST', body: input })

export const endEmployment = (id: string, endedOn: string) =>
  apiFetch<EmploymentResponse>(`/employments/${id}/end`, { method: 'POST', body: { endedOn } })
```

- [ ] **Step 4: Implement the section**

`apps/web/src/employments/EmploymentSection.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ClientKind } from '@ledger-hq/domain'
import { formatDate } from '../i18n/format'
import type { SupportedLocale } from '../i18n/format'
import { listEmployments } from './api'
import { AddEmploymentForm } from './AddEmploymentForm'

type Props = { client: { id: string; kind: ClientKind; name: string } }

export function EmploymentSection({ client }: Props) {
  const { t, i18n } = useTranslation(['employments', 'common'])
  const locale = i18n.language as SupportedLocale
  const isCompany = client.kind === 'COMPANY'

  const employments = useQuery({
    queryKey: ['employments', client.id],
    queryFn: () => listEmployments(client.id),
  })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">
        {isCompany ? t('employments:employeesTitle') : t('employments:employmentsTitle')}
      </h2>

      {employments.data?.length === 0 ? (
        <p className="text-sm text-slate-600">{t('employments:empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {employments.data?.map((spell) => {
            const counterpartyId = isCompany ? spell.employeeId : spell.employerId
            const counterpartyName = isCompany ? spell.employeeName : spell.employerName

            return (
              <li key={spell.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link to="/clients/$clientId" params={{ clientId: counterpartyId }} className="font-medium">
                  {counterpartyName}
                </Link>
                <span className="text-slate-600">{spell.jobTitle}</span>
                <span className="text-slate-600">
                  {formatDate(spell.startedOn, locale)}
                  {spell.endedOn === null ? '' : ` – ${formatDate(spell.endedOn, locale)}`}
                </span>
                {spell.endedOn === null ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                    {t('employments:current')}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <AddEmploymentForm client={client} />
    </section>
  )
}
```

`apps/web/src/employments/AddEmploymentForm.tsx` renders a counterparty picker populated by `listClients({ kind: isCompany ? 'INDIVIDUAL' : 'COMPANY' })` — so a company page can only pick people and a person page only companies — plus start date, optional end date and job title. It validates with `createEmploymentSchema` before posting, and shows API errors such as `employment.overlapping_spell` through `ErrorMessage`.

Render `<EmploymentSection client={client} />` inside `ClientDetailPage`.

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm --filter @ledger-hq/web test EmploymentSection`
Expected: PASS, five cases.

```bash
git add apps/web
git commit -m "feat(web): show employment links on company and person pages"
```

---

### Task 17: Installable PWA and connection status

**Files:**
- Modify: `apps/web/vite.config.ts`, `apps/web/src/shell/AppLayout.tsx`
- Create: `apps/web/src/shell/useOnlineStatus.ts`, `apps/web/src/shell/ConnectionStatus.tsx`
- Create: `apps/web/public/icon-192.png`, `apps/web/public/icon-512.png`, `apps/web/public/icon-maskable.png`
- Test: `apps/web/src/shell/useOnlineStatus.test.ts`, `apps/web/src/shell/ConnectionStatus.test.tsx`

**Interfaces:**
- Consumes: the i18n `common.connection.*` keys added in Task 13.
- Produces:
  - `useOnlineStatus(): boolean` — tracks `navigator.onLine` plus the `online` and `offline` events.
  - `ConnectionStatus` — renders the state and the last successful synchronisation time.
  - A service worker precaching the application shell, and a web app manifest making the site installable.

**Locale bundles need no special caching rule.** They are imported as JSON modules, so Vite inlines them into the JavaScript bundle, which Workbox precaches. The spec's requirement that both bundles are precached rather than lazily fetched is satisfied structurally, not by configuration that could be changed by accident.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/shell/useOnlineStatus.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus'

describe('useOnlineStatus', () => {
  it('starts from navigator.onLine', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toBe(false)
  })

  it('reacts to the offline and online events', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })
})
```

`apps/web/src/shell/ConnectionStatus.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ConnectionStatus } from './ConnectionStatus'

await initI18n()

function renderStatus() {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ConnectionStatus />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('ConnectionStatus', () => {
  it('announces that the server is unreachable when offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderStatus()

    expect(screen.getByText(/sem ligação ao servidor|no connection/i)).toBeInTheDocument()
  })

  it('says nothing alarming when online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    renderStatus()

    expect(screen.queryByText(/sem ligação ao servidor|no connection/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @ledger-hq/web test shell`
Expected: FAIL — `Cannot find module './useOnlineStatus'`.

- [ ] **Step 3: Implement the hook and the indicator**

`apps/web/src/shell/useOnlineStatus.ts`:

```ts
import { useEffect, useState } from 'react'

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
```

`apps/web/src/shell/ConnectionStatus.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * Staleness must be visible. A credential rotated two days ago, shown as
 * current with no warning, costs a quarter of an hour of failed logins.
 */
export function ConnectionStatus() {
  const { t, i18n } = useTranslation('common')
  const online = useOnlineStatus()
  const queryClient = useQueryClient()

  if (online) return null

  const lastUpdated = Math.max(
    0,
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.dataUpdatedAt),
  )

  const time =
    lastUpdated > 0
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(lastUpdated),
        )
      : ''

  return (
    <div role="status" className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>{t('connection.offline')}</span>
      {time === '' ? null : <span className="ml-2">{t('connection.lastSync', { time })}</span>}
    </div>
  )
}
```

Render `<ConnectionStatus />` directly beneath the header in `AppLayout`.

- [ ] **Step 4: Configure the PWA**

Add to `apps/web/vite.config.ts`:

```ts
import { VitePWA } from 'vite-plugin-pwa'

// inside plugins:
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable.png'],
      manifest: {
        name: 'Ledger HQ',
        short_name: 'Ledger HQ',
        lang: 'pt-PT',
        dir: 'ltr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Reads degrade to the last known state, clearly marked as stale.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/v1') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-reads',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Writes fail loudly rather than pretending to succeed.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
```

Generate the three icons as solid-background PNGs carrying the letters "LHQ" at 192, 512 and 512 pixels. Any image tool will do; they are placeholders that can be replaced later without touching code.

- [ ] **Step 5: Verify installability**

```bash
pnpm --filter @ledger-hq/web build
pnpm --filter @ledger-hq/web preview
```

Open the preview URL in Chrome, then in DevTools check Application → Manifest for no errors and Application → Service Workers for an activated worker. Tick "Offline" in the Network panel and reload: the shell must still render, with the amber offline banner visible.

- [ ] **Step 6: Run the tests and commit**

Run: `pnpm --filter @ledger-hq/web test`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): make the application installable and show connection status"
```

---

### Task 18: Containers, remote access and backups

**Files:**
- Create: `docker/Dockerfile.api`, `docker/Dockerfile.web`, `docker/Caddyfile`, `docker/backup.sh`
- Create: `docker-compose.yml`, `.env.example`
- Create: `apps/api/prisma/migrations/<timestamp>_system_health/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/system/system.controller.ts`, `apps/api/src/system/system.module.ts`
- Create: `docs/operations.md`
- Test: `apps/api/test/system.integration.test.ts`

**Interfaces:**
- Consumes: `PrismaService`, `SessionGuard`.
- Produces:
  - `SystemHealth` model: `{ id, check, status, detail, occurredAt }`.
  - `GET /api/v1/system/health-report` → `{ lastBackup: { status, occurredAt } | null, consecutiveFailures: number }`.
  - `docker compose up -d` bringing up `postgres`, `api` and `web`.
  - `docker/backup.sh` producing an encrypted dump and recording the outcome.

- [ ] **Step 1: Add the health record model**

Append to `apps/api/prisma/schema.prisma`:

```prisma
model SystemHealth {
  id         String   @id @db.Uuid
  check      String
  status     String   // "OK" | "FAILED"
  detail     String?
  occurredAt DateTime @default(now()) @db.Timestamptz(3)

  @@index([check, occurredAt])
}
```

```bash
cd apps/api && pnpm exec prisma migrate dev --name system_health
```

Add `systemHealth` to the delete list at the top of `resetDatabase` in `apps/api/test/database.ts`.

- [ ] **Step 2: Write the failing test**

`apps/api/test/system.integration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { uuidv7 } from 'uuidv7'
import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './app'
import { getTestPrisma, resetDatabase } from './database'
import { authenticate } from './authenticate'

const prisma = getTestPrisma()

let app: INestApplication
let cookie: string[]

async function recordBackup(status: string, minutesAgo: number): Promise<void> {
  await prisma.systemHealth.create({
    data: {
      id: uuidv7(),
      check: 'backup',
      status,
      occurredAt: new Date(Date.now() - minutesAgo * 60_000),
    },
  })
}

beforeEach(async () => {
  await resetDatabase()
  app = await createTestApp()
  cookie = await authenticate(app)
})

describe('GET /system/health-report', () => {
  it('reports no backup on a fresh installation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/system/health-report')
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body).toEqual({ lastBackup: null, consecutiveFailures: 0 })
  })

  it('returns the most recent backup outcome', async () => {
    await recordBackup('OK', 600)
    await recordBackup('FAILED', 60)

    const response = await request(app.getHttpServer())
      .get('/api/v1/system/health-report')
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body.lastBackup.status).toBe('FAILED')
    expect(response.body.consecutiveFailures).toBe(1)
  })

  it('counts consecutive failures and stops at the last success', async () => {
    await recordBackup('OK', 5000)
    await recordBackup('FAILED', 3000)
    await recordBackup('FAILED', 2000)
    await recordBackup('FAILED', 1000)

    const response = await request(app.getHttpServer())
      .get('/api/v1/system/health-report')
      .set('Cookie', cookie)
      .expect(200)

    expect(response.body.consecutiveFailures).toBe(3)
  })

  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/system/health-report').expect(401)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @ledger-hq/api test:integration system`
Expected: FAIL — 404 on the route.

- [ ] **Step 4: Implement the endpoint**

`apps/api/src/system/system.controller.ts`:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { SessionGuard } from '../auth/session.guard'

type HealthReport = {
  lastBackup: { status: string; occurredAt: string } | null
  consecutiveFailures: number
}

@Controller('system')
@UseGuards(SessionGuard)
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health-report')
  async healthReport(): Promise<HealthReport> {
    const recent = await this.prisma.systemHealth.findMany({
      where: { check: 'backup' },
      orderBy: { occurredAt: 'desc' },
      take: 30,
    })

    const latest = recent[0]
    let consecutiveFailures = 0
    for (const record of recent) {
      if (record.status !== 'FAILED') break
      consecutiveFailures += 1
    }

    return {
      lastBackup: latest ? { status: latest.status, occurredAt: latest.occurredAt.toISOString() } : null,
      consecutiveFailures,
    }
  }
}
```

`apps/api/src/system/system.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaService } from '../common/prisma.service'
import { SystemController } from './system.controller'

@Module({ imports: [AuthModule], controllers: [SystemController], providers: [PrismaService] })
export class SystemModule {}
```

Add `SystemModule` to `apps/api/src/app.module.ts`, then run the test again: PASS, four cases.

- [ ] **Step 5: Write the container definitions**

`docker/Dockerfile.api`:

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ledger-hq/api exec prisma generate
RUN pnpm --filter @ledger-hq/api build
RUN pnpm deploy --filter @ledger-hq/api --prod /app

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

`docker/Dockerfile.web`:

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ledger-hq/web build

FROM caddy:2-alpine
COPY --from=build /repo/apps/web/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
```

`docker/Caddyfile`:

```
:8080 {
	encode gzip

	handle /api/* {
		reverse_proxy api:3000
	}

	handle {
		root * /srv
		try_files {path} /index.html
		file_server

		header {
			# No external origins at all: the vault's defence against a
			# malicious script being injected into the page.
			Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
			X-Content-Type-Options "nosniff"
			Referrer-Policy "no-referrer"
		}
	}
}
```

`'wasm-unsafe-eval'` is required: Argon2id runs as WebAssembly, and without it the vault cannot derive a key.

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16.4-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: docker/Dockerfile.api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      NODE_ENV: production
      TZ: Europe/Lisbon
      COOKIE_SECURE: "true"
      SESSION_TTL_DAYS: "30"
      AUTH_SALT_SECRET: ${AUTH_SALT_SECRET}

  web:
    build:
      context: .
      dockerfile: docker/Dockerfile.web
    restart: unless-stopped
    depends_on:
      - api
    ports:
      # Bound to loopback only. Tailscale terminates TLS in front of it.
      - "127.0.0.1:8080:8080"

volumes:
  postgres-data:
```

`.env.example` at the repository root:

```
POSTGRES_USER=ledger
POSTGRES_PASSWORD=generate-a-long-random-password
POSTGRES_DB=ledger_hq
AUTH_SALT_SECRET=generate-32-random-bytes-base64
BACKUP_AGE_RECIPIENT=age1...
BACKUP_LOCAL_DIR=/var/backups/ledger-hq
BACKUP_REMOTE=remote:ledger-hq
```

- [ ] **Step 6: Write the backup script**

`docker/backup.sh`:

```bash
#!/usr/bin/env bash
# Nightly encrypted backup. Records its own outcome so the application can
# show a failing backup instead of failing silently.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a && . ./.env && set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_LOCAL_DIR}/ledger-hq-${STAMP}.dump.age"
STATUS="OK"
DETAIL=""

mkdir -p "${BACKUP_LOCAL_DIR}"

if docker compose exec -T postgres pg_dump \
      --format=custom --username "${POSTGRES_USER}" "${POSTGRES_DB}" \
    | age --recipient "${BACKUP_AGE_RECIPIENT}" --output "${ARCHIVE}"
then
  find "${BACKUP_LOCAL_DIR}" -name 'ledger-hq-*.dump.age' -mtime +30 -delete
  rclone copy "${ARCHIVE}" "${BACKUP_REMOTE}" || { STATUS="FAILED"; DETAIL="offsite copy failed"; }
else
  STATUS="FAILED"
  DETAIL="pg_dump or encryption failed"
  rm -f "${ARCHIVE}"
fi

docker compose exec -T postgres psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --command "INSERT INTO \"SystemHealth\" (id, check, status, detail) VALUES (gen_random_uuid(), 'backup', '${STATUS}', NULLIF('${DETAIL}', ''));"

[ "${STATUS}" = "OK" ]
```

The `id` column is a UUID string, and `gen_random_uuid()` is available in PostgreSQL 16 without an extension. Backup rows are the one place where a v4 identifier is acceptable, because nothing sorts or joins on them.

Make it executable and schedule it:

```bash
chmod +x docker/backup.sh
crontab -e   # add: 0 3 * * * /path/to/ledger-hq/docker/backup.sh >> /var/log/ledger-hq-backup.log 2>&1
```

- [ ] **Step 7: Bring the stack up and expose it over Tailscale**

```bash
cp .env.example .env   # then fill in real values
docker compose up -d --build
curl -s localhost:8080/api/v1/health
```

Expected: `{"status":"ok"}`

Then, on the host:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

Expected: the status output shows `https://<machine>.<tailnet>.ts.net` proxying to `127.0.0.1:8080`. Open that URL on the phone with Tailscale connected; the browser must show a valid certificate, which is what makes WebCrypto and the service worker available.

- [ ] **Step 8: Write the operations runbook**

`docs/operations.md` covering, with exact commands:

- First-time setup: clone, `.env`, `docker compose up -d --build`, `tailscale serve`, create the account, store the recovery code on paper off-site.
- Daily operation: where logs go, how to read them, what the connection banner means.
- Update: `git pull && docker compose up -d --build`; migrations run at API startup.
- Rollback: `docker compose down`, restore the most recent dump, `git checkout <previous tag>`, `docker compose up -d --build`.
- Restore drill, quarterly: decrypt with `age --decrypt`, `pg_restore` into a throwaway database, compare row counts against production, drop the throwaway.
- What is stored where: the Postgres volume, the backup directory, the offsite remote, and the two secrets that live only on paper.

- [ ] **Step 9: Commit**

```bash
git add docker docker-compose.yml .env.example apps/api docs/operations.md
git commit -m "feat(ops): containerise the stack with Tailscale access and encrypted backups"
```

---

### Task 19: End-to-end tests

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/setup-and-clients.spec.ts`, `apps/web/e2e/offline.spec.ts`
- Modify: `apps/web/package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the running API and web preview server.
- Produces: `pnpm --filter @ledger-hq/web test:e2e`.

- [ ] **Step 1: Configure Playwright**

```bash
pnpm --filter @ledger-hq/web add -D @playwright/test
pnpm --filter @ledger-hq/web exec playwright install --with-deps chromium
```

`apps/web/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', locale: 'pt-PT' },
  webServer: [
    {
      command: 'pnpm --filter @ledger-hq/api start',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @ledger-hq/web preview --port 4173',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
```

Add to `apps/web/package.json` scripts: `"test:e2e": "playwright test"`.

The preview server does not proxy `/api`, so add a proxy to `apps/web/vite.config.ts` under `preview` mirroring the `server.proxy` block.

- [ ] **Step 2: Write the main journey**

`apps/web/e2e/setup-and-clients.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

const MASTER_PASSWORD = 'a sufficiently long master password'

test('sets up the account, registers a company and a person, and links them', async ({ page }) => {
  await page.goto('/')

  // First run: the setup form appears instead of login.
  await page.getByLabel(/email/i).fill('paulo@example.com')
  await page.getByLabel(/^palavra-passe mestra$/i).fill(MASTER_PASSWORD)
  await page.getByLabel(/confirmar/i).fill(MASTER_PASSWORD)
  await page.getByRole('button', { name: /criar|entrar/i }).click()

  await expect(page.getByRole('link', { name: /clientes/i })).toBeVisible()

  // A company.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('COMPANY')
  await page.getByLabel(/^nome$/i).fill('Padaria Central, Lda.')
  await page.getByLabel(/^nif$/i).fill('501442600')
  await page.getByRole('button', { name: /guardar/i }).click()

  await expect(page.getByText('Padaria Central, Lda.')).toBeVisible()

  // A person.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: /criar/i }).click()
  await page.getByLabel(/tipo/i).selectOption('INDIVIDUAL')
  await page.getByLabel(/^nome$/i).fill('Maria Santos')
  await page.getByLabel(/^nif$/i).fill('123456789')
  await page.getByRole('button', { name: /guardar/i }).click()

  // Link them from the company page.
  await page.getByRole('link', { name: /clientes/i }).click()
  await page.getByRole('link', { name: 'Padaria Central, Lda.' }).click()
  await page.getByLabel(/pessoa/i).selectOption({ label: 'Maria Santos' })
  await page.getByLabel(/data de admissão/i).fill('2024-01-15')
  await page.getByRole('button', { name: /adicionar vínculo/i }).click()

  await expect(page.getByText('Maria Santos')).toBeVisible()
  await expect(page.getByText(/em vigor/i)).toBeVisible()
})

test('switches language without losing the page', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('combobox', { name: /idioma|language/i }).selectOption('en-GB')

  await expect(page.getByRole('link', { name: 'Clients' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')
})
```

- [ ] **Step 3: Write the offline shell test**

`apps/web/e2e/offline.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('the application shell still renders with the network down', async ({ page, context }) => {
  await page.goto('/')
  // Let the service worker install and precache the shell.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  })

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByText(/ledger hq/i)).toBeVisible()
  await expect(page.getByRole('status')).toContainText(/sem ligação ao servidor/i)

  await context.setOffline(false)
})
```

This is the test that protects the spec's central promise. If a refactor breaks offline rendering, it fails here rather than on the owner's phone in a VAT week.

- [ ] **Step 4: Run the suite**

```bash
docker compose up -d postgres
pnpm --filter @ledger-hq/api exec prisma migrate deploy
pnpm build
pnpm --filter @ledger-hq/web test:e2e
```

Expected: three tests pass. The first run needs a clean database, because the journey begins with first-run setup.

- [ ] **Step 5: Add to CI**

Append to `.github/workflows/ci.yml`:

```yaml
      - run: pnpm --filter @ledger-hq/web exec playwright install --with-deps chromium
      - run: docker compose up -d postgres
      - run: pnpm --filter @ledger-hq/api exec prisma migrate deploy
        env:
          DATABASE_URL: postgresql://ledger:ledger@localhost:5432/ledger_hq
      - run: pnpm --filter @ledger-hq/web test:e2e
        env:
          DATABASE_URL: postgresql://ledger:ledger@localhost:5432/ledger_hq
          AUTH_SALT_SECRET: ci-secret
          COOKIE_SECURE: "false"
```

Add a `ports: ["5432:5432"]` mapping to the `postgres` service in `docker-compose.yml` so CI can reach it, bound to `127.0.0.1` for safety.

- [ ] **Step 6: Commit**

```bash
git add apps/web .github docker-compose.yml
git commit -m "test(web): cover setup, client registration, language switching and offline shell"
```

---

### Task 20: Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`, `docs/security-model.md`
- Create: `docs/adr/0001-typescript-monorepo.md`, `docs/adr/0002-zero-knowledge-vault.md`, `docs/adr/0003-clients-as-companies-and-individuals.md`, `docs/adr/0004-error-codes-not-prose.md`

**Interfaces:**
- Consumes: the finished Phase 0 system.
- Produces: documentation a reader with no context can act on.

- [ ] **Step 1: Rewrite the README**

Cover, in this order: what Ledger HQ is in two sentences; requirements (Node 22, pnpm 9, Docker, a Tailscale account); five-minute local setup (`pnpm install`, `docker compose up -d postgres`, `prisma migrate dev`, `pnpm dev` in both apps); the test commands for each layer; the repository map from this plan's file structure section; and links to `docs/architecture.md`, `docs/operations.md` and `docs/security-model.md`.

- [ ] **Step 2: Write the architecture overview**

`docs/architecture.md`: the module dependency table from the spec, the rule that `vault`, `obligations` and `billing` never import one another, why `domain` and `crypto` are shared packages, the API conventions (`/api/v1`, error-code envelope, Zod schemas shared with the browser), and the data model diagram in text form showing `Client` at the centre with `FiscalProfile`, `Employment`, and the future `vault`, `obligations` and `billing` aggregates.

- [ ] **Step 3: Write the security model**

`docs/security-model.md` states plainly what the design protects against and what it does not. Copy the substance of the spec's section 9.5: mitigated (stolen machine, stolen backups, database copies, disk access, lost phone) and not mitigated (a compromised server serving malicious JavaScript to an unlocked session; a keylogger on the device). Include the derivation diagram, the KDF parameters and why 64 MiB is a ceiling, and the warning that losing both the master password and the recovery code is unrecoverable by design.

- [ ] **Step 4: Write the four decision records**

Each ADR is short: context, decision, consequences, and what would make us revisit it.

- `0001-typescript-monorepo.md` — one language across API, browser and shared rules; NestJS chosen for enforced module boundaries; the rejected alternatives and why.
- `0002-zero-knowledge-vault.md` — one master password with two derivations, the key envelope and why re-wrapping one key beats re-encrypting every credential, and the accepted cost that recovery is impossible without the recovery code.
- `0003-clients-as-companies-and-individuals.md` — why a `ClientKind` discriminator rather than a separate `Person` entity, why `LegalForm` lost `SOLE_TRADER`, and the recorded path to generalising `Employment` into `ClientRelationship` if shareholders are ever needed.
- `0004-error-codes-not-prose.md` — the API returns codes because the server must not know the caller's language and because one message must read identically whether it came from client-side or server-side validation.

- [ ] **Step 5: Verify the README works from scratch**

In a clean clone, follow the README's setup section exactly and confirm the application starts and the first-run setup screen appears. Fix any step that needed knowledge the README did not provide.

- [ ] **Step 6: Run the full verification and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @ledger-hq/api test:integration
pnpm --filter @ledger-hq/web i18n:check
```

Expected: all pass.

```bash
git add README.md docs
git commit -m "docs: document the architecture, security model and Phase 0 decisions"
```

---

## Definition of done for Phase 0

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes from a clean clone.
- [ ] `pnpm --filter @ledger-hq/api test:integration` passes against a real PostgreSQL container.
- [ ] `pnpm --filter @ledger-hq/web test:e2e` passes, including the offline shell test.
- [ ] `pnpm --filter @ledger-hq/web i18n:check` reports the two bundles in agreement.
- [ ] The stack runs under `docker compose up -d` and survives a host reboot.
- [ ] The site is reachable over Tailscale with a valid certificate, and installs as an app on the phone.
- [ ] A company and an individual can be registered, given fiscal profiles, and linked by employment.
- [ ] A nightly backup produces an encrypted dump locally and offsite, and a failure is visible through `GET /system/health-report`.
- [ ] The recovery code has been written on paper and stored off-site.
- [ ] `README.md`, `docs/architecture.md`, `docs/operations.md` and `docs/security-model.md` are current.

## What Phase 0 deliberately leaves out

These are Phase 1 and later, and no task above should grow to include them: the credential vault and its item encryption, TOTP generation, offline credential reads, the obligation catalog and engine, retainer plans, charges, payments and the client ledger, and any dashboard beyond the connection banner.

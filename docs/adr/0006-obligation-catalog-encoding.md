# 6. Encoding the fiscal catalog's ambiguous master-spec entries

## Status

Accepted.

## Context

The master spec's initial catalog table (section 7.5) gives 14 rows, three
of which do not map cleanly onto one `ObligationDefinition` row with one
`dueDate` rule:

- `VAT_PAYMENT` is listed once, but this catalog already splits its sibling
  `VAT_MONTHLY_RETURN`/`VAT_QUARTERLY_RETURN` by `vatRegime` — a client's
  VAT payment obligation follows whichever regime their return does, so a
  single undifferentiated `VAT_PAYMENT` code would either double-fire (if
  conditioned on `hasOpenActivity` alone, matching both regimes) or need a
  regime-conditional deadline a single `DeadlineRule` cannot express.
- `CIT_PAYMENT_ON_ACCOUNT` lists three distinct calendar deadlines ("July,
  September, 15 December") under one code, but `ObligationInstance` has
  exactly one `dueDate` column.
- `MODEL_30_NON_RESIDENT_PAYMENTS`'s "end of the 2nd following month" is not
  a fixed day-of-month; reusing a `day: 31` rule would silently roll over
  into the following month whenever the target month has fewer than 31 days.

## Decision

1. `VAT_PAYMENT` becomes two codes, `VAT_PAYMENT_MONTHLY` and
   `VAT_PAYMENT_QUARTERLY`, mirroring the return's own split exactly (same
   `vatRegime` conditions, same periodicities).
2. `CIT_PAYMENT_ON_ACCOUNT` becomes three annual codes,
   `CIT_PAYMENT_ON_ACCOUNT_1`/`_2`/`_3`, one per statutory payment.
3. A third `DeadlineRule` variant, `lastDayOfMonthAfterPeriodEnd`, joins
   `dayOfMonthAfterPeriodEnd` and `fixedDate` — computed via `Date.UTC(year,
   month + 1, 0)`, which JavaScript resolves to the last day of `month`
   regardless of its length, the same idiom used for Phase 0/1's other
   calendar-date arithmetic (`new Date(\`${value}T00:00:00Z\`)`).
4. `ObligationDefinition` rows are upserted by the generator itself
   (`syncCatalogDefinitions`, run at the start of every `generate` call), not
   seeded by a migration — unlike Phase 1's three fixed `Platform` seed rows,
   this catalog is expected to grow over the life of the practice, and a
   migration-time seed would drift the moment a code is added to the catalog
   file without an accompanying migration.

## Alternatives considered

- **Model `CIT_PAYMENT_ON_ACCOUNT` as one code with a `DeadlineRule` variant
  carrying multiple dates, generating three instances per period.**
  Rejected: every other multi-instance-per-period case in this domain (the
  monthly vs. quarterly VAT split) is already handled by separate codes, and
  a "one code, many instances" shape would need its own, unique generator
  branch just for this rule.
- **Seed `ObligationDefinition` at migration time, like `Platform`.**
  Rejected: `Platform`'s three rows are a small, genuinely fixed catalog (a
  government portal doesn't appear or disappear); the fiscal catalog is
  explicitly expected to be corrected and extended as legislation changes
  (design doc 3.1), which a migration-time seed cannot track.

## Consequences

- 18 catalog entries instead of the master spec's literal 14 — three codes
  became six (`VAT_PAYMENT`→2, `CIT_PAYMENT_ON_ACCOUNT`→3, net +4 minus the
  1 each replaced), which the owner's line-by-line review (design doc 3.1)
  covers the same as any other entry; the split itself, not just each
  entry's dates, is one more thing worth that review confirming.
- `syncCatalogDefinitions` runs on every `generate` call (dry-run and apply
  alike) — an 18-row upsert, negligible cost against the rest of the sweep.

/**
 * `AUTH_SALT_SECRET` seeds the decoy KDF salt for unknown emails (see
 * `AuthService#kdfSaltFor`). Reading it with `ConfigService#getOrThrow`
 * inside the request path fails lazily and only on the unknown-email
 * branch: a known address would answer 200 while an unknown one throws and
 * is rendered as a 500 by the catch-all filter — the status code alone
 * then reveals which addresses are real, exactly what the decoy exists to
 * prevent. Failing here, at `ConfigModule.forRoot({ validate })` time,
 * means the process refuses to start at all without it, instead of
 * degrading into that oracle only in production once traffic arrives.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const secret = config.AUTH_SALT_SECRET

  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('AUTH_SALT_SECRET must be set to a non-empty string')
  }

  // Same reasoning as above, one layer out: a missing attachments directory
  // fails lazily, on the first upload, in production, months after the
  // deploy that forgot it. Failing at ConfigModule.forRoot time means the
  // process refuses to start at all.
  const attachmentsDir = config.ATTACHMENTS_DIR

  if (typeof attachmentsDir !== 'string' || attachmentsDir.length === 0) {
    throw new Error('ATTACHMENTS_DIR must be set to a non-empty path')
  }

  return config
}

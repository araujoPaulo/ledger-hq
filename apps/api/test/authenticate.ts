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

  return (response.headers['set-cookie'] as unknown as string[] | undefined) ?? []
}

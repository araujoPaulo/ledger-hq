import { describe, expect, it, vi } from 'vitest'
import type { BillingService } from './billing.service.js'
import { BillingCron } from './billing.cron.js'

describe('BillingCron', () => {
  it('runs generateCharges for every client, applied, as of now', async () => {
    const generateCharges = vi.fn().mockResolvedValue({ toCreate: [] })
    const cron = new BillingCron({ generateCharges } as unknown as BillingService)

    await cron.runDailyGeneration()

    expect(generateCharges).toHaveBeenCalledWith({ asOf: expect.any(Date) }, false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { ObligationsService } from './obligations.service.js'
import { ObligationsCron } from './obligations.cron.js'

describe('ObligationsCron', () => {
  it('delegates to the service with dryRun=false and no clientId, so it sweeps every active client', async () => {
    const generate = vi.fn().mockResolvedValue({ toCreate: [], toRetract: [] })
    const service = { generate } as unknown as ObligationsService
    const cron = new ObligationsCron(service)

    await cron.runDailyGeneration()

    expect(generate).toHaveBeenCalledTimes(1)
    const [input, dryRun] = generate.mock.calls[0]!
    expect(dryRun).toBe(false)
    expect(input.clientId).toBeUndefined()
    expect(input.asOf).toBeInstanceOf(Date)
  })
})

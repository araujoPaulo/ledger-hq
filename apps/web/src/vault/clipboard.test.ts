import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_CLEAR_MS, copyAndClear } from './clipboard'

const writeText = vi.fn()

describe('copyAndClear', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the value, then clears the clipboard 30 seconds later', async () => {
    await copyAndClear('secret')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('secret')

    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1)
    expect(writeText).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenLastCalledWith('')
  })

  it('swallows a clear the browser refuses', async () => {
    writeText.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))

    await copyAndClear('secret')
    // An unhandled rejection from the timer would fail the run; reaching the
    // assertion after the clear has fired is the test.
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS)
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it('rejects when the write itself fails, so the caller can stay quiet', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    await expect(copyAndClear('secret')).rejects.toThrow('denied')
  })

  it('does not schedule a clear for a write that failed', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    await expect(copyAndClear('secret')).rejects.toThrow('denied')
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS)
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('rejects when there is no clipboard API at all (plain HTTP)', async () => {
    Object.assign(navigator, { clipboard: undefined })
    await expect(copyAndClear('secret')).rejects.toThrow()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVaultState, lockVault, noteActivity, subscribeVaultState, unlockVault } from './vault-session'

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
    const unsubscribe = subscribeVaultState(listener)
    unlockVault(fakeKey())
    lockVault()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})

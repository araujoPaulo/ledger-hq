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

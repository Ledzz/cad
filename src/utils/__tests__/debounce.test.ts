import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounceAsync } from '../../utils/debounce'

describe('debounceAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delays execution by the specified amount', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    const debounced = debounceAsync(fn, 100)

    const promise = debounced('arg1')

    // Not called yet
    expect(fn).not.toHaveBeenCalled()

    // Advance past the delay
    await vi.advanceTimersByTimeAsync(100)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('arg1')
    await expect(promise).resolves.toBe('result')
  })

  it('cancels pending call when a new call arrives', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    const debounced = debounceAsync(fn, 100)

    const promise1 = debounced('first')
    await vi.advanceTimersByTimeAsync(50)
    const promise2 = debounced('second')

    // Advance past the delay for the second call
    await vi.advanceTimersByTimeAsync(100)

    // Only the second call should have executed
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('second')

    // First promise resolves with undefined (cancelled)
    await expect(promise1).resolves.toBeUndefined()
    await expect(promise2).resolves.toBe('result')
  })

  it('cancel() prevents pending execution', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    const debounced = debounceAsync(fn, 100)

    debounced('arg')
    debounced.cancel()

    await vi.advanceTimersByTimeAsync(200)

    expect(fn).not.toHaveBeenCalled()
  })

  it('can be called again after cancel', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const debounced = debounceAsync(fn, 50)

    debounced('first')
    debounced.cancel()

    const promise = debounced('second')
    await vi.advanceTimersByTimeAsync(50)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('second')
    await expect(promise).resolves.toBe('ok')
  })

  it('batches rapid calls — only the last one executes', async () => {
    const fn = vi.fn().mockResolvedValue('done')
    const debounced = debounceAsync(fn, 100)

    debounced('a')
    await vi.advanceTimersByTimeAsync(30)
    debounced('b')
    await vi.advanceTimersByTimeAsync(30)
    debounced('c')
    await vi.advanceTimersByTimeAsync(30)
    const lastPromise = debounced('d')

    await vi.advanceTimersByTimeAsync(100)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('d')
    await expect(lastPromise).resolves.toBe('done')
  })
})

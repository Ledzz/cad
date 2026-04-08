/**
 * Debounced async function wrapper.
 *
 * Delays invocation by `delayMs`.  If a new call arrives while waiting, the
 * previous pending call is cancelled (its promise resolves with `undefined`).
 *
 * Useful for expensive async work (like OCCT rebuilds) triggered by rapid UI
 * events (slider drags, text input).
 */
export function debounceAsync<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  delayMs: number
): {
  (...args: Args): Promise<R | undefined>
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0 // monotonically increasing — lets us detect stale invocations
  let pendingResolve: ((value: R | undefined) => void) | null = null

  function clearPending() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    // Resolve any waiting promise with undefined so callers aren't stuck
    if (pendingResolve) {
      pendingResolve(undefined)
      pendingResolve = null
    }
  }

  const debounced = (...args: Args): Promise<R | undefined> => {
    clearPending()

    const thisGen = ++generation

    return new Promise((resolve) => {
      pendingResolve = resolve

      timer = setTimeout(async () => {
        timer = null
        pendingResolve = null

        if (thisGen !== generation) {
          resolve(undefined)
          return
        }
        try {
          const result = await fn(...args)
          if (thisGen === generation) {
            resolve(result)
          } else {
            resolve(undefined)
          }
        } catch (err) {
          if (thisGen === generation) {
            throw err
          }
          resolve(undefined)
        }
      }, delayMs)
    })
  }

  debounced.cancel = () => {
    clearPending()
    generation++
  }

  return debounced
}

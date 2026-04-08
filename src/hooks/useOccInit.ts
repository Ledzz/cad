import { useEffect, useRef, useState } from 'react'
import { getOccApi } from '../workers/occApi'

/**
 * Hook that initializes OpenCascade in the Web Worker.
 * Loads the WASM binary on first mount and reports loading/error state.
 */
export function useOccInit() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    async function init() {
      try {
        setLoading(true)

        // Initialize the OCCT worker (loads WASM)
        await getOccApi()

        setLoading(false)
      } catch (err) {
        console.error('[useOccInit] Failed:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      }
    }

    init()
  }, [])

  return { loading, error }
}

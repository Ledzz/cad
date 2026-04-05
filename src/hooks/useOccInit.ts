import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { getOccApi } from '../workers/occApi'
import { generateFeatureId } from '../engine/featureTypes'
import type { BoxFeature } from '../engine/featureTypes'

/**
 * Hook that initializes OpenCascade in the Web Worker and creates
 * a test box feature, adding it to the parametric feature tree.
 */
export function useOccInit() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const addFeature = useAppStore((s) => s.addFeature)
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    async function init() {
      try {
        setLoading(true)

        // Initialize the OCCT worker (loads WASM)
        await getOccApi()

        // Create a test box as a parametric feature
        const boxFeature: BoxFeature = {
          id: generateFeatureId('box'),
          name: 'Box (10 x 6 x 4)',
          type: 'box',
          suppressed: false,
          dx: 10,
          dy: 6,
          dz: 4,
        }

        await addFeature(boxFeature)
        setLoading(false)
      } catch (err) {
        console.error('[useOccInit] Failed:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      }
    }

    init()
  }, [addFeature])

  return { loading, error }
}

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../store/appStore'
import { getOccApi } from '../workers/occApi'

/**
 * Hook that initializes OpenCascade in the Web Worker and creates
 * a test box, adding its tessellated geometry to the app store.
 */
export function useOccInit() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const addSceneObject = useAppStore((s) => s.addSceneObject)
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    async function init() {
      try {
        setLoading(true)
        const api = await getOccApi()

        // Create a test box: 10x6x4
        const tessData = await api.makeBox('test-box', 10, 6, 4)

        // Convert tessellation data to Three.js BufferGeometry
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(tessData.vertices, 3))
        geometry.setAttribute('normal', new THREE.BufferAttribute(tessData.normals, 3))
        geometry.setIndex(new THREE.BufferAttribute(tessData.indices, 1))

        // Store face ranges as userData for picking
        geometry.userData = { faceRanges: tessData.faceRanges }

        addSceneObject('test-box', geometry)
        setLoading(false)
      } catch (err) {
        console.error('[useOccInit] Failed:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      }
    }

    init()
  }, [addSceneObject])

  return { loading, error }
}

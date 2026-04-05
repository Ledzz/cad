import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import { SceneObjects } from './SceneObjects'
import { SketchRenderer } from './SketchRenderer'
import { SketchInteraction } from './SketchInteraction'
import { useOccInit } from '../hooks/useOccInit'
import { useAppStore } from '../store/appStore'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Smoothly animates the camera to look at the sketch plane head-on.
 */
function SketchCameraController() {
  const activeSketch = useAppStore((s) => s.activeSketch)
  const { camera } = useThree()
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!activeSketch || hasAnimated.current) return
    hasAnimated.current = true

    const plane = activeSketch.plane
    const normal = new THREE.Vector3(...plane.normal)
    const origin = new THREE.Vector3(...plane.origin)

    // Position camera along the normal direction, looking at the origin
    const distance = 30
    const targetPos = origin.clone().add(normal.clone().multiplyScalar(distance))

    // Animate camera position
    const startPos = camera.position.clone()
    const startTarget = new THREE.Vector3(0, 0, 0) // default look-at
    const duration = 500 // ms
    const startTime = performance.now()

    function animate() {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)

      camera.position.lerpVectors(startPos, targetPos, ease)
      camera.lookAt(
        startTarget.x + (origin.x - startTarget.x) * ease,
        startTarget.y + (origin.y - startTarget.y) * ease,
        startTarget.z + (origin.z - startTarget.z) * ease
      )

      if (t < 1) {
        requestAnimationFrame(animate)
      }
    }

    animate()

    return () => {
      hasAnimated.current = false
    }
  }, [activeSketch, camera])

  return null
}

function SceneContent() {
  const mode = useAppStore((s) => s.mode)
  const isSketchMode = mode === 'sketching'

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-10, -5, -10]} intensity={0.2} />

      {/* Grid on XZ plane */}
      <Grid
        args={[100, 100]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#2a2a4a"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#3a3a5a"
        fadeDistance={50}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid
      />

      {/* Axis helper at origin */}
      <axesHelper args={[5]} />

      {/* OCCT-generated scene objects */}
      <SceneObjects />

      {/* Sketch overlay (only in sketch mode) */}
      {isSketchMode && (
        <>
          <SketchRenderer />
          <SketchInteraction />
          <SketchCameraController />
        </>
      )}

      {/* Camera controls — disabled orbit in sketch mode, allow pan+zoom only */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={1}
        maxDistance={500}
        enableRotate={!isSketchMode}
      />

      {/* Orientation gizmo in top-right corner */}
      <GizmoHelper alignment="top-right" margin={[80, 80]}>
        <GizmoViewport
          axisColors={['#ff4060', '#40ff60', '#4060ff']}
          labelColor="white"
        />
      </GizmoHelper>
    </>
  )
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/80 z-10">
      <div className="text-center">
        <div className="text-gray-300 text-sm mb-2">Loading OpenCascade WASM...</div>
        <div className="w-48 h-1 bg-[#2a2a4a] rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
        </div>
      </div>
    </div>
  )
}

function ErrorOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/80 z-10">
      <div className="text-center max-w-md px-4">
        <div className="text-red-400 text-sm font-semibold mb-2">Failed to load OpenCascade</div>
        <div className="text-gray-400 text-xs font-mono">{message}</div>
      </div>
    </div>
  )
}

export function Viewport() {
  const { loading, error } = useOccInit()
  const setSelection = useAppStore((s) => s.setSelection)
  const mode = useAppStore((s) => s.mode)
  const setSketchSelection = useAppStore((s) => s.setSketchSelection)

  const handlePointerMissed = () => {
    if (mode === 'sketching') {
      setSketchSelection([])
    } else {
      setSelection([])
    }
  }

  return (
    <div className="flex-1 relative bg-[#1a1a2e]">
      {loading && <LoadingOverlay />}
      {error && <ErrorOverlay message={error} />}
      <Canvas
        camera={{
          position: [15, 15, 15],
          fov: 45,
          near: 0.1,
          far: 1000,
        }}
        gl={{ antialias: true }}
        onPointerMissed={handlePointerMissed}
      >
        <SceneContent />
      </Canvas>
    </div>
  )
}

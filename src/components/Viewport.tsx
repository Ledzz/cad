import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import { SceneObjects } from './SceneObjects'
import { SketchRenderer } from './SketchRenderer'
import { SketchInteraction } from './SketchInteraction'
import { useOccInit } from '../hooks/useOccInit'
import { useAppStore } from '../store/appStore'
import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'

// ─── Named view camera positions ────────────────────────────

interface NamedView {
  label: string
  key: string
  position: [number, number, number]
  up?: [number, number, number]
}

const NAMED_VIEWS: NamedView[] = [
  { label: 'F', key: 'Front',  position: [0, 0, 30] },
  { label: 'B', key: 'Back',   position: [0, 0, -30] },
  { label: 'T', key: 'Top',    position: [0, 30, 0], up: [0, 0, -1] },
  { label: 'Bo', key: 'Bottom', position: [0, -30, 0], up: [0, 0, 1] },
  { label: 'L', key: 'Left',   position: [-30, 0, 0] },
  { label: 'R', key: 'Right',  position: [30, 0, 0] },
  { label: 'Iso', key: 'Iso',  position: [20, 20, 20] },
]

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

/**
 * Component that imperatively animates the camera to named views.
 * Accessed via a ref from the parent.
 */
interface CameraActions {
  flyToView: (position: [number, number, number], up?: [number, number, number]) => void
  zoomToFit: () => void
}

function CameraController({ actionsRef }: { actionsRef: React.MutableRefObject<CameraActions | null> }) {
  const { camera, scene } = useThree()

  actionsRef.current = {
    flyToView(position, up) {
      const startPos = camera.position.clone()
      const targetPos = new THREE.Vector3(...position)
      const startUp = camera.up.clone()
      const targetUp = up ? new THREE.Vector3(...up) : new THREE.Vector3(0, 1, 0)
      const target = new THREE.Vector3(0, 0, 0)
      const duration = 400
      const startTime = performance.now()

      function animate() {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / duration, 1)
        const ease = 1 - Math.pow(1 - t, 3)

        camera.position.lerpVectors(startPos, targetPos, ease)
        camera.up.lerpVectors(startUp, targetUp, ease).normalize()
        camera.lookAt(target)

        if (t < 1) {
          requestAnimationFrame(animate)
        }
      }

      animate()
    },

    zoomToFit() {
      // Compute bounding box of all meshes in the scene
      const box = new THREE.Box3()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          const meshBox = new THREE.Box3().setFromObject(obj)
          box.union(meshBox)
        }
      })

      if (box.isEmpty()) return

      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180)
      const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.5

      // Keep current direction, just adjust distance
      const dir = camera.position.clone().sub(center).normalize()
      const targetPos = center.clone().add(dir.multiplyScalar(distance))

      const startPos = camera.position.clone()
      const duration = 400
      const startTime = performance.now()

      function animate() {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / duration, 1)
        const ease = 1 - Math.pow(1 - t, 3)

        camera.position.lerpVectors(startPos, targetPos, ease)
        camera.lookAt(center)

        if (t < 1) {
          requestAnimationFrame(animate)
        }
      }

      animate()
    },
  }

  return null
}

function SceneContent({ cameraActionsRef }: { cameraActionsRef: React.MutableRefObject<CameraActions | null> }) {
  const mode = useAppStore((s) => s.mode)
  const isSketchMode = mode === 'sketching'

  return (
    <>
      {/* Camera controller for named views / zoom-to-fit */}
      <CameraController actionsRef={cameraActionsRef} />

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
  const setHoveredFace = useAppStore((s) => s.setHoveredFace)
  const cameraActionsRef = useRef<CameraActions | null>(null)

  const handlePointerMissed = () => {
    if (mode === 'sketching') {
      setSketchSelection([])
    } else {
      setSelection([])
      setHoveredFace(null)
    }
  }

  const handleZoomToFit = useCallback(() => {
    cameraActionsRef.current?.zoomToFit()
  }, [])

  const handleNamedView = useCallback((view: NamedView) => {
    cameraActionsRef.current?.flyToView(view.position, view.up)
  }, [])

  return (
    <div className="flex-1 relative bg-[#1a1a2e]">
      {loading && <LoadingOverlay />}
      {error && <ErrorOverlay message={error} />}

      {/* View control buttons — bottom-left overlay */}
      <div className="absolute bottom-3 left-3 z-10 flex gap-1">
        {NAMED_VIEWS.map((view) => (
          <button
            key={view.key}
            className="px-1.5 py-0.5 text-[10px] rounded bg-[#16162a]/80 text-gray-400 hover:text-gray-200 hover:bg-[#2a2a4a]/90 border border-[#2a2a4a]/50 cursor-pointer select-none transition-colors"
            onClick={() => handleNamedView(view)}
            title={view.key}
          >
            {view.label}
          </button>
        ))}
        <button
          className="px-1.5 py-0.5 text-[10px] rounded bg-[#16162a]/80 text-gray-400 hover:text-gray-200 hover:bg-[#2a2a4a]/90 border border-[#2a2a4a]/50 cursor-pointer select-none transition-colors"
          onClick={handleZoomToFit}
          title="Zoom to fit (show all geometry)"
        >
          Fit
        </button>
      </div>

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
        <SceneContent cameraActionsRef={cameraActionsRef} />
      </Canvas>
    </div>
  )
}

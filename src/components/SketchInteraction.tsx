import { useCallback, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../store/appStore'
import type { SketchPoint, SketchEntity } from '../engine/sketchTypes'

// ─── Constants ──────────────────────────────────────────────

const SNAP_DISTANCE = 0.5 // world units
const GRID_SNAP_SIZE = 1.0

// ─── Helpers ────────────────────────────────────────────────

/** Project a world-space point onto the sketch plane, returning 2D sketch coords */
function worldToSketch2D(
  worldPoint: THREE.Vector3,
  origin: THREE.Vector3,
  xDir: THREE.Vector3,
  yDir: THREE.Vector3
): { x: number; y: number } {
  const delta = worldPoint.clone().sub(origin)
  return {
    x: delta.dot(xDir),
    y: delta.dot(yDir),
  }
}

/** Snap to existing points, grid, or axes */
function findSnap(
  pos: { x: number; y: number },
  entities: Map<string, SketchEntity>,
  snapDistance: number
): { x: number; y: number; snapped: boolean } {
  // Check existing points for endpoint snap
  let closestDist = snapDistance
  let snappedPos = { ...pos }
  let snapped = false

  for (const entity of entities.values()) {
    if (entity.type !== 'point') continue
    const dx = pos.x - entity.x
    const dy = pos.y - entity.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < closestDist) {
      closestDist = dist
      snappedPos = { x: entity.x, y: entity.y }
      snapped = true
    }
  }

  if (snapped) return { ...snappedPos, snapped: true }

  // Grid snap
  const gridX = Math.round(pos.x / GRID_SNAP_SIZE) * GRID_SNAP_SIZE
  const gridY = Math.round(pos.y / GRID_SNAP_SIZE) * GRID_SNAP_SIZE
  const gridDx = pos.x - gridX
  const gridDy = pos.y - gridY
  const gridDist = Math.sqrt(gridDx * gridDx + gridDy * gridDy)
  if (gridDist < snapDistance * 0.7) {
    return { x: gridX, y: gridY, snapped: true }
  }

  return { ...pos, snapped: false }
}

/** Find the existing point at a position, or return null */
function findExistingPoint(
  pos: { x: number; y: number },
  entities: Map<string, SketchEntity>,
  threshold: number = 0.01
): SketchPoint | null {
  for (const entity of entities.values()) {
    if (entity.type !== 'point') continue
    const dx = pos.x - entity.x
    const dy = pos.y - entity.y
    if (Math.sqrt(dx * dx + dy * dy) < threshold) {
      return entity
    }
  }
  return null
}

// ─── Main Component ─────────────────────────────────────────

/**
 * Invisible interaction plane that captures mouse events for sketch drawing.
 * Renders as a large transparent plane on the sketch plane.
 */
export function SketchInteraction() {
  const activeSketch = useAppStore((s) => s.activeSketch)
  const addSketchEntity = useAppStore((s) => s.addSketchEntity)
  const addSketchEntities = useAppStore((s) => s.addSketchEntities)
  const setSketchPreviewPosition = useAppStore((s) => s.setSketchPreviewPosition)
  const addDrawingPoint = useAppStore((s) => s.addDrawingPoint)
  const resetDrawingState = useAppStore((s) => s.resetDrawingState)
  const generateId = useAppStore((s) => s.generateId)
  const { raycaster, camera, pointer } = useThree()

  // Build sketch plane geometry (for raycasting)
  const planeData = useMemo(() => {
    if (!activeSketch) return null
    const { origin, xDir, yDir, normal } = activeSketch.plane
    const o = new THREE.Vector3(...origin)
    const x = new THREE.Vector3(...xDir)
    const y = new THREE.Vector3(...yDir)
    const n = new THREE.Vector3(...normal)
    const plane = new THREE.Plane(n, -n.dot(o))
    return { origin: o, xDir: x, yDir: y, normal: n, plane }
  }, [activeSketch])

  // Raycast pointer onto the sketch plane → 2D coords
  const getSketchPosition = useCallback((): { x: number; y: number } | null => {
    if (!planeData || !activeSketch) return null

    raycaster.setFromCamera(pointer, camera)
    const intersection = new THREE.Vector3()
    const hit = raycaster.ray.intersectPlane(planeData.plane, intersection)
    if (!hit) return null

    const pos2d = worldToSketch2D(
      intersection,
      planeData.origin,
      planeData.xDir,
      planeData.yDir
    )

    // Apply snapping
    const snapped = findSnap(pos2d, activeSketch.entities, SNAP_DISTANCE)
    return { x: snapped.x, y: snapped.y }
  }, [planeData, activeSketch, raycaster, pointer, camera])

  /** Create or reuse a point at the given position */
  const getOrCreatePoint = useCallback(
    (pos: { x: number; y: number }): SketchPoint => {
      const sketch = useAppStore.getState().activeSketch
      if (!sketch) {
        // Fallback — should not happen
        return { type: 'point', id: 'fallback', x: pos.x, y: pos.y, construction: false }
      }
      // Check for existing point at this location
      const existing = findExistingPoint(pos, sketch.entities)
      if (existing) return existing

      const id = generateId('pt')
      const point: SketchPoint = {
        type: 'point',
        id,
        x: pos.x,
        y: pos.y,
        construction: false,
      }
      addSketchEntity(point)
      return point
    },
    [generateId, addSketchEntity]
  )

  // ─── Tool Handlers ──────────────────────────────────────

  const handleClick = useCallback(() => {
    const sketch = useAppStore.getState().activeSketch
    if (!sketch) return
    const { activeTool, drawingState } = sketch

    if (!activeTool) {
      // Selection mode — handled by entity click events in SketchRenderer
      return
    }

    const pos = getSketchPosition()
    if (!pos) return

    switch (activeTool) {
      case 'point': {
        getOrCreatePoint(pos)
        break
      }

      case 'line': {
        if (drawingState.placedPointIds.length === 0) {
          // First click: place start point
          const pt = getOrCreatePoint(pos)
          addDrawingPoint(pt.id)
        } else {
          // Second click: place end point and create line
          const pt = getOrCreatePoint(pos)
          const startId = drawingState.placedPointIds[0]
          const lineId = generateId('ln')
          addSketchEntity({
            type: 'line',
            id: lineId,
            startPointId: startId,
            endPointId: pt.id,
            construction: false,
          })
          // Chain: the end point becomes the start of the next line
          resetDrawingState()
          addDrawingPoint(pt.id)
        }
        break
      }

      case 'circle': {
        if (drawingState.placedPointIds.length === 0) {
          // First click: place center
          const pt = getOrCreatePoint(pos)
          addDrawingPoint(pt.id)
        } else {
          // Second click: set radius and create circle
          const centerId = drawingState.placedPointIds[0]
          const centerPt = sketch.entities.get(centerId) as SketchPoint | undefined
          if (!centerPt) break
          const dx = pos.x - centerPt.x
          const dy = pos.y - centerPt.y
          const radius = Math.sqrt(dx * dx + dy * dy)
          if (radius < 0.01) break

          const circleId = generateId('cir')
          addSketchEntity({
            type: 'circle',
            id: circleId,
            centerPointId: centerId,
            radius,
            construction: false,
          })
          resetDrawingState()
        }
        break
      }

      case 'arc': {
        if (drawingState.placedPointIds.length === 0) {
          // First click: start point
          const pt = getOrCreatePoint(pos)
          addDrawingPoint(pt.id)
        } else if (drawingState.placedPointIds.length === 1) {
          // Second click: end point
          const pt = getOrCreatePoint(pos)
          addDrawingPoint(pt.id)
        } else if (drawingState.placedPointIds.length === 2) {
          // Third click: a point that defines the arc (we compute center, radius, angles)
          const startPt = sketch.entities.get(drawingState.placedPointIds[0]) as SketchPoint
          const endPt = sketch.entities.get(drawingState.placedPointIds[1]) as SketchPoint
          if (!startPt || !endPt) break

          // Use the three points to compute a circular arc
          // midPoint on the arc is `pos`
          const { center, radius, startAngle, endAngle } = computeArcFromThreePoints(
            startPt.x, startPt.y,
            pos.x, pos.y,
            endPt.x, endPt.y
          )
          if (radius < 0.01) break

          // Create center point
          const centerPt = getOrCreatePoint({ x: center.x, y: center.y })

          const arcId = generateId('arc')
          addSketchEntity({
            type: 'arc',
            id: arcId,
            centerPointId: centerPt.id,
            startPointId: drawingState.placedPointIds[0],
            endPointId: drawingState.placedPointIds[1],
            radius,
            startAngle,
            endAngle,
            construction: false,
          })
          resetDrawingState()
        }
        break
      }

      case 'rectangle': {
        if (drawingState.placedPointIds.length === 0) {
          // First click: first corner
          const pt = getOrCreatePoint(pos)
          addDrawingPoint(pt.id)
        } else {
          // Second click: opposite corner — create 4 points + 4 lines
          const firstPt = sketch.entities.get(drawingState.placedPointIds[0]) as SketchPoint
          if (!firstPt) break

          const x1 = firstPt.x, y1 = firstPt.y
          const x2 = pos.x, y2 = pos.y

          // Create 3 more corner points (first corner already exists)
          const pt2 = getOrCreatePoint({ x: x2, y: y1 })
          const pt3 = getOrCreatePoint({ x: x2, y: y2 })
          const pt4 = getOrCreatePoint({ x: x1, y: y2 })

          // Create 4 lines
          const ln1Id = generateId('ln')
          const ln2Id = generateId('ln')
          const ln3Id = generateId('ln')
          const ln4Id = generateId('ln')

          addSketchEntities([
            { type: 'line', id: ln1Id, startPointId: firstPt.id, endPointId: pt2.id, construction: false },
            { type: 'line', id: ln2Id, startPointId: pt2.id, endPointId: pt3.id, construction: false },
            { type: 'line', id: ln3Id, startPointId: pt3.id, endPointId: pt4.id, construction: false },
            { type: 'line', id: ln4Id, startPointId: pt4.id, endPointId: firstPt.id, construction: false },
          ])

          resetDrawingState()
        }
        break
      }
    }
  }, [
    getSketchPosition,
    getOrCreatePoint,
    addSketchEntity,
    addSketchEntities,
    addDrawingPoint,
    resetDrawingState,
    generateId,
  ])

  const handlePointerMove = useCallback(() => {
    const sketch = useAppStore.getState().activeSketch
    if (!sketch?.activeTool) return

    const pos = getSketchPosition()
    setSketchPreviewPosition(pos)
  }, [getSketchPosition, setSketchPreviewPosition])

  const handleContextMenu = useCallback(
    (e: any) => {
      // Right-click cancels current drawing operation
      if (e?.nativeEvent?.preventDefault) {
        e.nativeEvent.preventDefault()
      }
      resetDrawingState()
    },
    [resetDrawingState]
  )

  // Build plane transform matrix
  const planeMatrix = useMemo(() => {
    if (!planeData) return new THREE.Matrix4()
    const m = new THREE.Matrix4()
    m.makeBasis(planeData.xDir, planeData.yDir, planeData.normal)
    m.setPosition(planeData.origin)
    return m
  }, [planeData])

  if (!activeSketch || !planeData) return null

  return (
    <mesh
      matrixAutoUpdate={false}
      matrix={planeMatrix}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onContextMenu={handleContextMenu}
      renderOrder={-1}
    >
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial
        visible={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// ─── Geometry Helpers ───────────────────────────────────────

/** Compute arc center, radius, and angles from 3 points (start, mid, end) */
function computeArcFromThreePoints(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number
): { center: { x: number; y: number }; radius: number; startAngle: number; endAngle: number } {
  // Find circumcenter of the triangle formed by 3 points
  const ax = x1, ay = y1
  const bx = x2, by = y2
  const cx = x3, cy = y3

  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))

  if (Math.abs(D) < 1e-10) {
    // Points are collinear — return degenerate arc
    return {
      center: { x: (x1 + x3) / 2, y: (y1 + y3) / 2 },
      radius: 0,
      startAngle: 0,
      endAngle: 0,
    }
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D

  const radius = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy))
  const startAngle = Math.atan2(y1 - uy, x1 - ux)
  const endAngle = Math.atan2(y3 - uy, x3 - ux)

  return { center: { x: ux, y: uy }, radius, startAngle, endAngle }
}

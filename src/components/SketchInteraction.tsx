import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../store/appStore'
import type {
  SketchPoint,
  SketchEntity,
  SnapTarget,
} from '../engine/sketchTypes'
import { inferConstraints } from '../engine/constraintInference'

// ─── Constants ──────────────────────────────────────────────

const SNAP_DISTANCE = 0.5 // world units
const ENTITY_HIT_THRESHOLD = 0.4 // how close a click must be to select an entity
const DRAG_SELECT_THRESHOLD = 0.15 // minimum drag distance to start a selection rectangle

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

/** Snap to existing points, grid, or axes — returns a rich SnapTarget */
function findSnap(
  pos: { x: number; y: number },
  entities: Map<string, SketchEntity>,
  snapDistance: number
): { x: number; y: number; snapped: boolean; snapTarget: SnapTarget } {
  // Check existing points for endpoint snap
  let closestDist = snapDistance
  let bestTarget: SnapTarget = null
  let snappedPos = { ...pos }

  for (const entity of entities.values()) {
    if (entity.type !== 'point') continue
    const dx = pos.x - entity.x
    const dy = pos.y - entity.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < closestDist) {
      closestDist = dist
      snappedPos = { x: entity.x, y: entity.y }
      bestTarget = { type: 'endpoint', pointId: entity.id, x: entity.x, y: entity.y }
    }
  }

  if (bestTarget) return { ...snappedPos, snapped: true, snapTarget: bestTarget }

  // Origin snap — snap to (0,0) if close enough
  const originDist = Math.sqrt(pos.x * pos.x + pos.y * pos.y)
  if (originDist < snapDistance) {
    return { x: 0, y: 0, snapped: true, snapTarget: { type: 'endpoint', pointId: '__origin__', x: 0, y: 0 } }
  }

  return { ...pos, snapped: false, snapTarget: null }
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

// ─── Geometric Hit Testing ──────────────────────────────────

/** Distance from a point to a line segment */
function distToLineSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)

  // Project point onto line, clamped to [0, 1]
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projX = x1 + t * dx
  const projY = y1 + t * dy
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
}

/** Distance from a point to a circle outline */
function distToCircle(
  px: number, py: number,
  cx: number, cy: number,
  radius: number
): number {
  const distToCenter = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
  return Math.abs(distToCenter - radius)
}

/** Distance from a point to an arc outline */
function distToArc(
  px: number, py: number,
  cx: number, cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): number {
  const distToCenter = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
  const angle = Math.atan2(py - cy, px - cx)

  // Normalize angles to check if the point's angle falls within the arc's sweep
  let sa = startAngle
  let ea = endAngle
  if (ea < sa) ea += Math.PI * 2

  let a = angle
  // Normalize a into the same range
  while (a < sa) a += Math.PI * 2
  while (a > sa + Math.PI * 2) a -= Math.PI * 2

  if (a >= sa && a <= ea) {
    // Point angle is within the arc — distance is |dist_to_center - radius|
    return Math.abs(distToCenter - radius)
  }

  // Outside the arc's angle range — distance to the nearest endpoint
  const startX = cx + Math.cos(startAngle) * radius
  const startY = cy + Math.sin(startAngle) * radius
  const endX = cx + Math.cos(endAngle) * radius
  const endY = cy + Math.sin(endAngle) * radius

  const dStart = Math.sqrt((px - startX) ** 2 + (py - startY) ** 2)
  const dEnd = Math.sqrt((px - endX) ** 2 + (py - endY) ** 2)
  return Math.min(dStart, dEnd)
}

/**
 * Find the nearest sketch entity to a 2D position.
 * Returns the entity and its distance, or null if nothing is within threshold.
 * Points are given slight priority (smaller effective threshold) since they're smaller targets.
 */
function findNearestEntity(
  pos: { x: number; y: number },
  entities: Map<string, SketchEntity>,
  threshold: number
): { entity: SketchEntity; distance: number } | null {
  let bestEntity: SketchEntity | null = null
  let bestDist = threshold

  for (const entity of entities.values()) {
    let dist: number

    switch (entity.type) {
      case 'point': {
        dist = Math.sqrt((pos.x - entity.x) ** 2 + (pos.y - entity.y) ** 2)
        // Give points a slight priority boost (0.8x distance) so they win over lines they sit on
        dist *= 0.8
        break
      }
      case 'line': {
        const startPt = entities.get(entity.startPointId) as SketchPoint | undefined
        const endPt = entities.get(entity.endPointId) as SketchPoint | undefined
        if (!startPt || !endPt) continue
        dist = distToLineSegment(pos.x, pos.y, startPt.x, startPt.y, endPt.x, endPt.y)
        break
      }
      case 'circle': {
        const center = entities.get(entity.centerPointId) as SketchPoint | undefined
        if (!center) continue
        dist = distToCircle(pos.x, pos.y, center.x, center.y, entity.radius)
        break
      }
      case 'arc': {
        const center = entities.get(entity.centerPointId) as SketchPoint | undefined
        if (!center) continue
        dist = distToArc(
          pos.x, pos.y,
          center.x, center.y,
          entity.radius,
          entity.startAngle,
          entity.endAngle
        )
        break
      }
      default:
        continue
    }

    if (dist < bestDist) {
      bestDist = dist
      bestEntity = entity
    }
  }

  return bestEntity ? { entity: bestEntity, distance: bestDist } : null
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
  const addConstraints = useAppStore((s) => s.addConstraints)
  const setSketchPreviewPosition = useAppStore((s) => s.setSketchPreviewPosition)
  const addDrawingPoint = useAppStore((s) => s.addDrawingPoint)
  const resetDrawingState = useAppStore((s) => s.resetDrawingState)
  const generateId = useAppStore((s) => s.generateId)
  const dragSketchPoint = useAppStore((s) => s.dragSketchPoint)
  const setSketchSelection = useAppStore((s) => s.setSketchSelection)
  const setSketchHovered = useAppStore((s) => s.setSketchHovered)
  const setSelectionRect = useAppStore((s) => s.setSelectionRect)
  const { raycaster, camera, pointer } = useThree()

  // Finalize selection rect on any pointer release (on-canvas or off-canvas)
  useEffect(() => {
    const handleGlobalPointerUp = (e: PointerEvent) => {
      if (!selectDragState.current?.isDragging) return

      const sketch = useAppStore.getState().activeSketch
      if (sketch?.selectionRect) {
        const { startX, startY, endX, endY } = sketch.selectionRect
        const isWindow = endX >= startX
        const rect = normalizeRect(startX, startY, endX, endY)
        const selected = getEntitiesInRect(rect, isWindow, sketch.entities)
        const additive = !!(e.shiftKey || e.metaKey || e.ctrlKey)

        if (additive) {
          const combined = new Set([...sketch.selectedEntityIds, ...selected])
          useAppStore.getState().setSketchSelection(Array.from(combined))
        } else {
          useAppStore.getState().setSketchSelection(selected)
        }
      }

      useAppStore.getState().setSelectionRect(null)
      // Keep isDragging true briefly so the R3F click event is suppressed
      setTimeout(() => { selectDragState.current = null }, 0)
    }
    window.addEventListener('pointerup', handleGlobalPointerUp)
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp)
  }, [])

  // Track point drag state
  const dragState = useRef<{
    pointId: string
    isDragging: boolean
  } | null>(null)

  // Track selection rectangle drag state
  const selectDragState = useRef<{
    startPos: { x: number; y: number }
    isDragging: boolean
  } | null>(null)

  // Track the current snap target for rendering indicators
  const snapTargetRef = useRef<SnapTarget>(null)

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
    snapTargetRef.current = snapped.snapTarget
    return { x: snapped.x, y: snapped.y }
  }, [planeData, activeSketch, raycaster, pointer, camera])

  // Raycast pointer onto sketch plane → 2D coords (no snapping, for selection rect)
  const getRawSketchPosition = useCallback((): { x: number; y: number } | null => {
    if (!planeData) return null

    raycaster.setFromCamera(pointer, camera)
    const intersection = new THREE.Vector3()
    const hit = raycaster.ray.intersectPlane(planeData.plane, intersection)
    if (!hit) return null

    return worldToSketch2D(intersection, planeData.origin, planeData.xDir, planeData.yDir)
  }, [planeData, raycaster, pointer, camera])

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

  /** Run auto-constraint inference on newly created entities */
  const runInference = useCallback(
    (newEntityIds: string[]) => {
      if (newEntityIds.length === 0) return
      const sketch = useAppStore.getState().activeSketch
      if (!sketch) return
      const inferred = inferConstraints(
        newEntityIds,
        sketch.entities,
        sketch.constraints,
        () => generateId('cst')
      )
      if (inferred.length > 0) {
        addConstraints(inferred)
      }
    },
    [generateId, addConstraints]
  )

  const handleClick = useCallback((e: any) => {
    // If a drag-select just completed, suppress this click
    if (selectDragState.current?.isDragging) return

    const sketch = useAppStore.getState().activeSketch
    if (!sketch) return
    const { activeTool, drawingState } = sketch

    if (!activeTool) {
      // Selection mode — find the nearest entity via geometric hit-testing
      const pos = getSketchPosition()
      if (!pos) return

      const hit = findNearestEntity(pos, sketch.entities, ENTITY_HIT_THRESHOLD)
      if (hit) {
        const nativeEvent = e?.nativeEvent ?? e
        const multiSelect = !!(nativeEvent?.shiftKey || nativeEvent?.metaKey || nativeEvent?.ctrlKey)
        if (multiSelect) {
          // Toggle: add/remove from current selection
          const current = sketch.selectedEntityIds
          if (current.includes(hit.entity.id)) {
            setSketchSelection(current.filter((id: string) => id !== hit.entity.id))
          } else {
            setSketchSelection([...current, hit.entity.id])
          }
        } else {
          setSketchSelection([hit.entity.id])
        }
      } else {
        // Clicked empty space — deselect all
        setSketchSelection([])
      }
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
          // Auto-infer constraints on the new line
          runInference([lineId])
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
          // Auto-infer constraints (e.g. tangent to existing lines)
          runInference([arcId, centerPt.id])
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

          // Auto-infer constraints: H/V on edges + equal on opposite pairs
          runInference([
            firstPt.id, pt2.id, pt3.id, pt4.id,
            ln1Id, ln2Id, ln3Id, ln4Id,
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
    runInference,
  ])

  const handlePointerMove = useCallback(() => {
    const sketch = useAppStore.getState().activeSketch

    // Handle point drag
    if (dragState.current?.isDragging) {
      const pos = getSketchPosition()
      if (pos) {
        dragSketchPoint(dragState.current.pointId, pos)
      }
      return
    }

    // Handle selection rectangle drag
    if (selectDragState.current) {
      const pos = getRawSketchPosition()
      if (pos) {
        const start = selectDragState.current.startPos
        const dx = pos.x - start.x
        const dy = pos.y - start.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist >= DRAG_SELECT_THRESHOLD) {
          selectDragState.current.isDragging = true
          setSelectionRect({
            startX: start.x,
            startY: start.y,
            endX: pos.x,
            endY: pos.y,
          })
        }
      }
      return
    }

    const pos = getSketchPosition()

    if (!sketch?.activeTool) {
      // Selection mode — update hover highlight
      if (pos && sketch) {
        const hit = findNearestEntity(pos, sketch.entities, ENTITY_HIT_THRESHOLD)
        setSketchHovered(hit ? hit.entity.id : null)
      } else {
        setSketchHovered(null)
      }
      return
    }

    // Drawing mode — update preview position
    setSketchPreviewPosition(pos)
  }, [getSketchPosition, getRawSketchPosition, setSketchPreviewPosition, dragSketchPoint, setSketchHovered, setSelectionRect])

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

  /** Start dragging a point or begin a selection rectangle on pointer down */
  const handlePointerDown = useCallback((e: any) => {
    const sketch = useAppStore.getState().activeSketch
    if (!sketch || sketch.activeTool) return

    // Only start drag-select on left mouse button
    const nativeEvent = e?.nativeEvent ?? e
    if (nativeEvent?.button !== undefined && nativeEvent.button !== 0) return

    const pos = getSketchPosition()
    if (!pos) return

    const hit = findNearestEntity(pos, sketch.entities, ENTITY_HIT_THRESHOLD)
    if (hit && hit.entity.type === 'point') {
      // Start dragging this point
      dragState.current = { pointId: hit.entity.id, isDragging: true }
    } else if (!hit) {
      // No entity hit — prepare for potential selection rectangle
      const rawPos = getRawSketchPosition()
      if (rawPos) {
        selectDragState.current = { startPos: rawPos, isDragging: false }
      }
    }
    // Selection is handled in handleClick (which fires after pointerDown + pointerUp)
  }, [getSketchPosition, getRawSketchPosition])

  const handlePointerUp = useCallback(() => {
    if (dragState.current?.isDragging) {
      dragState.current = null
    }
    // Selection rect finalization is handled by the global pointerup listener
    if (!selectDragState.current?.isDragging) {
      selectDragState.current = null
    }
  }, [])

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
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
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

// ─── Selection Rectangle Helpers ────────────────────────────

interface Rect {
  minX: number; minY: number; maxX: number; maxY: number
}

function normalizeRect(
  startX: number, startY: number, endX: number, endY: number
): Rect {
  return {
    minX: Math.min(startX, endX),
    minY: Math.min(startY, endY),
    maxX: Math.max(startX, endX),
    maxY: Math.max(startY, endY),
  }
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY
}

/** Check if a line segment intersects or is inside a rectangle */
function lineIntersectsRect(
  x1: number, y1: number, x2: number, y2: number, rect: Rect
): boolean {
  // If either endpoint is inside, the line intersects
  if (pointInRect(x1, y1, rect) || pointInRect(x2, y2, rect)) return true

  // Check if the line segment intersects any of the 4 edges of the rectangle
  const edges: [number, number, number, number][] = [
    [rect.minX, rect.minY, rect.maxX, rect.minY], // bottom
    [rect.maxX, rect.minY, rect.maxX, rect.maxY], // right
    [rect.maxX, rect.maxY, rect.minX, rect.maxY], // top
    [rect.minX, rect.maxY, rect.minX, rect.minY], // left
  ]

  for (const [ex1, ey1, ex2, ey2] of edges) {
    if (segmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) return true
  }
  return false
}

/** Check if two line segments intersect */
function segmentsIntersect(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number
): boolean {
  const d1 = cross(bx1, by1, bx2, by2, ax1, ay1)
  const d2 = cross(bx1, by1, bx2, by2, ax2, ay2)
  const d3 = cross(ax1, ay1, ax2, ay2, bx1, by1)
  const d4 = cross(ax1, ay1, ax2, ay2, bx2, by2)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  // Collinear cases
  if (d1 === 0 && onSegment(bx1, by1, bx2, by2, ax1, ay1)) return true
  if (d2 === 0 && onSegment(bx1, by1, bx2, by2, ax2, ay2)) return true
  if (d3 === 0 && onSegment(ax1, ay1, ax2, ay2, bx1, by1)) return true
  if (d4 === 0 && onSegment(ax1, ay1, ax2, ay2, bx2, by2)) return true

  return false
}

function cross(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function onSegment(
  px: number, py: number, qx: number, qy: number, rx: number, ry: number
): boolean {
  return (
    Math.min(px, qx) <= rx && rx <= Math.max(px, qx) &&
    Math.min(py, qy) <= ry && ry <= Math.max(py, qy)
  )
}

/** Check if a circle intersects or is inside a rectangle */
function circleIntersectsRect(
  cx: number, cy: number, radius: number, rect: Rect
): boolean {
  // Check if center is inside rect
  if (pointInRect(cx, cy, rect)) return true

  // Check if any edge of the rect intersects the circle
  const edges: [number, number, number, number][] = [
    [rect.minX, rect.minY, rect.maxX, rect.minY],
    [rect.maxX, rect.minY, rect.maxX, rect.maxY],
    [rect.maxX, rect.maxY, rect.minX, rect.maxY],
    [rect.minX, rect.maxY, rect.minX, rect.minY],
  ]

  for (const [ex1, ey1, ex2, ey2] of edges) {
    if (segmentIntersectsCircle(ex1, ey1, ex2, ey2, cx, cy, radius)) return true
  }
  return false
}

function segmentIntersectsCircle(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, r: number
): boolean {
  const dx = x2 - x1
  const dy = y2 - y1
  const fx = x1 - cx
  const fy = y1 - cy

  const a = dx * dx + dy * dy
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - r * r

  let discriminant = b * b - 4 * a * c
  if (discriminant < 0) return false

  discriminant = Math.sqrt(discriminant)
  const t1 = (-b - discriminant) / (2 * a)
  const t2 = (-b + discriminant) / (2 * a)

  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1)
}

/** Check if a circle is fully inside a rectangle */
function circleInsideRect(
  cx: number, cy: number, radius: number, rect: Rect
): boolean {
  return (
    cx - radius >= rect.minX &&
    cx + radius <= rect.maxX &&
    cy - radius >= rect.minY &&
    cy + radius <= rect.maxY
  )
}

/**
 * Determine which entities are selected by a drag rectangle.
 * isWindow=true (left-to-right): entities must be fully inside.
 * isWindow=false (right-to-left): entities that intersect the rect are selected (crossing).
 */
function getEntitiesInRect(
  rect: Rect,
  isWindow: boolean,
  entities: Map<string, SketchEntity>
): string[] {
  const result: string[] = []

  for (const entity of entities.values()) {
    switch (entity.type) {
      case 'point': {
        if (pointInRect(entity.x, entity.y, rect)) {
          result.push(entity.id)
        }
        break
      }
      case 'line': {
        const startPt = entities.get(entity.startPointId) as SketchPoint | undefined
        const endPt = entities.get(entity.endPointId) as SketchPoint | undefined
        if (!startPt || !endPt) break

        if (isWindow) {
          // Window: both endpoints must be inside
          if (pointInRect(startPt.x, startPt.y, rect) && pointInRect(endPt.x, endPt.y, rect)) {
            result.push(entity.id)
            // Also select the endpoints
            if (!result.includes(startPt.id)) result.push(startPt.id)
            if (!result.includes(endPt.id)) result.push(endPt.id)
          }
        } else {
          // Crossing: line intersects or is inside
          if (lineIntersectsRect(startPt.x, startPt.y, endPt.x, endPt.y, rect)) {
            result.push(entity.id)
            if (!result.includes(startPt.id)) result.push(startPt.id)
            if (!result.includes(endPt.id)) result.push(endPt.id)
          }
        }
        break
      }
      case 'circle': {
        const centerPt = entities.get(entity.centerPointId) as SketchPoint | undefined
        if (!centerPt) break

        if (isWindow) {
          if (circleInsideRect(centerPt.x, centerPt.y, entity.radius, rect)) {
            result.push(entity.id)
            if (!result.includes(centerPt.id)) result.push(centerPt.id)
          }
        } else {
          if (circleIntersectsRect(centerPt.x, centerPt.y, entity.radius, rect)) {
            result.push(entity.id)
            if (!result.includes(centerPt.id)) result.push(centerPt.id)
          }
        }
        break
      }
      case 'arc': {
        const centerPt = entities.get(entity.centerPointId) as SketchPoint | undefined
        const startPt = entities.get(entity.startPointId) as SketchPoint | undefined
        const endPt = entities.get(entity.endPointId) as SketchPoint | undefined
        if (!centerPt || !startPt || !endPt) break

        if (isWindow) {
          // Window: all associated points and the arc bounding must be inside
          if (
            pointInRect(startPt.x, startPt.y, rect) &&
            pointInRect(endPt.x, endPt.y, rect) &&
            pointInRect(centerPt.x, centerPt.y, rect)
          ) {
            result.push(entity.id)
            if (!result.includes(centerPt.id)) result.push(centerPt.id)
            if (!result.includes(startPt.id)) result.push(startPt.id)
            if (!result.includes(endPt.id)) result.push(endPt.id)
          }
        } else {
          // Crossing: check if any arc point is inside or arc crosses rect edges
          // Approximate arc as a polyline for crossing check
          const segments = 32
          let arcStart = entity.startAngle
          let arcEnd = entity.endAngle
          if (arcEnd < arcStart) arcEnd += 2 * Math.PI

          let intersects = false
          for (let i = 0; i < segments && !intersects; i++) {
            const t1 = arcStart + (arcEnd - arcStart) * (i / segments)
            const t2 = arcStart + (arcEnd - arcStart) * ((i + 1) / segments)
            const ax = centerPt.x + entity.radius * Math.cos(t1)
            const ay = centerPt.y + entity.radius * Math.sin(t1)
            const bx = centerPt.x + entity.radius * Math.cos(t2)
            const by = centerPt.y + entity.radius * Math.sin(t2)
            if (lineIntersectsRect(ax, ay, bx, by, rect)) {
              intersects = true
            }
          }

          if (intersects) {
            result.push(entity.id)
            if (!result.includes(centerPt.id)) result.push(centerPt.id)
            if (!result.includes(startPt.id)) result.push(startPt.id)
            if (!result.includes(endPt.id)) result.push(endPt.id)
          }
        }
        break
      }
    }
  }

  return result
}

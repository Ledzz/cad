import { useMemo } from 'react'
import * as THREE from 'three'
import { Line, Text } from '@react-three/drei'
import { useAppStore } from '../store/appStore'
import type {
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchConstraint,
  SketchEntity,
} from '../engine/sketchTypes'

// ─── Colors ─────────────────────────────────────────────────

const ENTITY_COLOR = '#4488ff'
const ENTITY_HOVER_COLOR = '#66aaff'
const ENTITY_SELECTED_COLOR = '#ffaa44'
const CONSTRUCTION_COLOR = '#446688'
const CONSTRAINT_COLOR = '#44dddd'
const CONSTRAINT_DIM_COLOR = '#44aa88'

const POINT_COLOR = '#88bbff'
const POINT_SELECTED_COLOR = '#ffcc66'
const PREVIEW_COLOR = '#4488ff'

const CIRCLE_SEGMENTS = 64

// ─── Helpers ────────────────────────────────────────────────

/** Convert 2D sketch coords to 3D using the sketch plane transform */
function useSketchTransform() {
  const activeSketch = useAppStore((s) => s.activeSketch)
  return useMemo(() => {
    if (!activeSketch) return null
    const { origin, xDir, yDir } = activeSketch.plane
    const o = new THREE.Vector3(...origin)
    const x = new THREE.Vector3(...xDir)
    const y = new THREE.Vector3(...yDir)

    // Build a 4x4 matrix that transforms local 2D sketch coords to world 3D
    const matrix = new THREE.Matrix4()
    const normal = new THREE.Vector3().crossVectors(x, y).normalize()
    matrix.makeBasis(x, y, normal)
    matrix.setPosition(o)

    return {
      matrix,
      to3D: (sx: number, sy: number): THREE.Vector3 => {
        return new THREE.Vector3(
          o.x + x.x * sx + y.x * sy,
          o.y + x.y * sx + y.y * sy,
          o.z + x.z * sx + y.z * sy
        )
      },
    }
  }, [activeSketch])
}

function getEntityColor(
  entityId: string,
  isConstruction: boolean,
  selectedIds: string[],
  hoveredId: string | null,
  statusColor?: string
): string {
  if (selectedIds.includes(entityId)) return ENTITY_SELECTED_COLOR
  if (hoveredId === entityId) return ENTITY_HOVER_COLOR
  if (isConstruction) return CONSTRUCTION_COLOR
  return statusColor ?? ENTITY_COLOR
}

// ─── Entity Renderers ───────────────────────────────────────

function SketchPointRenderer({
  point,
  to3D,
  isSelected,
  isHovered,
}: {
  point: SketchPoint
  to3D: (x: number, y: number) => THREE.Vector3
  isSelected: boolean
  isHovered: boolean
}) {
  const pos = to3D(point.x, point.y)
  const color = isSelected ? POINT_SELECTED_COLOR : isHovered ? ENTITY_HOVER_COLOR : POINT_COLOR
  const scale = isSelected || isHovered ? 0.18 : 0.12

  return (
    <mesh position={pos}>
      <sphereGeometry args={[scale, 8, 8]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

function SketchLineRenderer({
  line,
  entities,
  to3D,
  color,
  dashed,
}: {
  line: SketchLine
  entities: Map<string, any>
  to3D: (x: number, y: number) => THREE.Vector3
  color: string
  dashed: boolean
}) {
  const startPt = entities.get(line.startPointId) as SketchPoint | undefined
  const endPt = entities.get(line.endPointId) as SketchPoint | undefined
  if (!startPt || !endPt) return null

  const points = [to3D(startPt.x, startPt.y), to3D(endPt.x, endPt.y)]

  return (
    <Line
      points={points}
      color={color}
      lineWidth={dashed ? 1 : 2}
      dashed={dashed}
      dashSize={0.3}
      gapSize={0.2}
    />
  )
}

function SketchCircleRenderer({
  circle,
  entities,
  to3D,
  color,
  dashed,
}: {
  circle: SketchCircle
  entities: Map<string, any>
  to3D: (x: number, y: number) => THREE.Vector3
  color: string
  dashed: boolean
}) {
  const center = entities.get(circle.centerPointId) as SketchPoint | undefined
  if (!center) return null

  const points: THREE.Vector3[] = []
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2
    const x = center.x + Math.cos(angle) * circle.radius
    const y = center.y + Math.sin(angle) * circle.radius
    points.push(to3D(x, y))
  }

  return (
    <Line
      points={points}
      color={color}
      lineWidth={dashed ? 1 : 2}
      dashed={dashed}
      dashSize={0.3}
      gapSize={0.2}
    />
  )
}

function SketchArcRenderer({
  arc,
  entities,
  to3D,
  color,
  dashed,
}: {
  arc: SketchArc
  entities: Map<string, any>
  to3D: (x: number, y: number) => THREE.Vector3
  color: string
  dashed: boolean
}) {
  const center = entities.get(arc.centerPointId) as SketchPoint | undefined
  if (!center) return null

  let startAngle = arc.startAngle
  let endAngle = arc.endAngle
  // Ensure we go counter-clockwise from start to end
  if (endAngle < startAngle) {
    endAngle += Math.PI * 2
  }
  const sweep = endAngle - startAngle

  const segments = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * CIRCLE_SEGMENTS))
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = startAngle + t * sweep
    const x = center.x + Math.cos(angle) * arc.radius
    const y = center.y + Math.sin(angle) * arc.radius
    points.push(to3D(x, y))
  }

  return (
    <Line
      points={points}
      color={color}
      lineWidth={dashed ? 1 : 2}
      dashed={dashed}
      dashSize={0.3}
      gapSize={0.2}
    />
  )
}

// ─── Preview Line (rubber-band) ─────────────────────────────

function DrawingPreview({
  to3D,
}: {
  to3D: (x: number, y: number) => THREE.Vector3
}) {
  const activeSketch = useAppStore((s) => s.activeSketch)
  if (!activeSketch) return null

  const { drawingState, entities, activeTool } = activeSketch
  const { placedPointIds, previewPosition } = drawingState
  if (!previewPosition || placedPointIds.length === 0) return null

  const lastPointId = placedPointIds[placedPointIds.length - 1]
  const lastPoint = entities.get(lastPointId) as SketchPoint | undefined
  if (!lastPoint) return null

  if (activeTool === 'line' || activeTool === 'rectangle') {
    // Simple rubber-band line from last placed point to cursor
    const points = [
      to3D(lastPoint.x, lastPoint.y),
      to3D(previewPosition.x, previewPosition.y),
    ]

    if (activeTool === 'rectangle' && placedPointIds.length === 1) {
      // Show rectangle preview
      const p1 = lastPoint
      const p2 = previewPosition
      const rectPoints = [
        to3D(p1.x, p1.y),
        to3D(p2.x, p1.y),
        to3D(p2.x, p2.y),
        to3D(p1.x, p2.y),
        to3D(p1.x, p1.y),
      ]
      return (
        <Line points={rectPoints} color={PREVIEW_COLOR} lineWidth={1} dashed dashSize={0.2} gapSize={0.15} />
      )
    }

    return (
      <Line points={points} color={PREVIEW_COLOR} lineWidth={1} dashed dashSize={0.2} gapSize={0.15} />
    )
  }

  if (activeTool === 'circle' && placedPointIds.length === 1) {
    // Circle preview: center placed, radius follows cursor
    const dx = previewPosition.x - lastPoint.x
    const dy = previewPosition.y - lastPoint.y
    const radius = Math.sqrt(dx * dx + dy * dy)
    if (radius < 0.01) return null

    const points: THREE.Vector3[] = []
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      const x = lastPoint.x + Math.cos(angle) * radius
      const y = lastPoint.y + Math.sin(angle) * radius
      points.push(to3D(x, y))
    }
    return (
      <Line points={points} color={PREVIEW_COLOR} lineWidth={1} dashed dashSize={0.2} gapSize={0.15} />
    )
  }

  return null
}

// ─── Sketch Plane Visual ────────────────────────────────────

function SketchPlaneVisual() {
  const activeSketch = useAppStore((s) => s.activeSketch)
  if (!activeSketch) return null

  const { plane } = activeSketch
  const planeMatrix = useMemo(() => {
    const m = new THREE.Matrix4()
    const x = new THREE.Vector3(...plane.xDir)
    const y = new THREE.Vector3(...plane.yDir)
    const n = new THREE.Vector3(...plane.normal)
    const o = new THREE.Vector3(...plane.origin)
    m.makeBasis(x, y, n)
    m.setPosition(o)
    return m
  }, [plane])

  return (
    <mesh matrixAutoUpdate={false} matrix={planeMatrix}>
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial color="#4488ff" transparent opacity={0.03} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

// ─── Constraint Visualization ───────────────────────────────

function ConstraintRenderer({
  to3D,
}: {
  to3D: (x: number, y: number) => THREE.Vector3
}) {
  const activeSketch = useAppStore((s) => s.activeSketch)
  if (!activeSketch || activeSketch.constraints.length === 0) return null

  const { constraints, entities } = activeSketch

  return (
    <>
      {constraints.map((constraint) => (
        <ConstraintIcon
          key={constraint.id}
          constraint={constraint}
          entities={entities}
          to3D={to3D}
        />
      ))}
    </>
  )
}

function ConstraintIcon({
  constraint,
  entities,
  to3D,
}: {
  constraint: SketchConstraint
  entities: Map<string, SketchEntity>
  to3D: (x: number, y: number) => THREE.Vector3
}) {
  // Compute position and label for the constraint icon
  const { position, label, dimensionLine } = useMemo(() => {
    return getConstraintDisplayInfo(constraint, entities)
  }, [constraint, entities])

  if (!position) return null

  const pos3D = to3D(position.x, position.y)
  // Offset slightly above the sketch plane
  const normal = new THREE.Vector3(0, 0, 0.1)
  pos3D.add(normal)

  return (
    <>
      {/* Constraint symbol */}
      <Text
        position={pos3D}
        fontSize={0.35}
        color={dimensionLine ? CONSTRAINT_DIM_COLOR : CONSTRAINT_COLOR}
        anchorX="center"
        anchorY="middle"
        depthOffset={-1}
      >
        {label}
      </Text>

      {/* Dimension line for distance/angle/radius constraints */}
      {dimensionLine && (
        <Line
          points={[to3D(dimensionLine.from.x, dimensionLine.from.y), to3D(dimensionLine.to.x, dimensionLine.to.y)]}
          color={CONSTRAINT_DIM_COLOR}
          lineWidth={1}
          dashed
          dashSize={0.15}
          gapSize={0.1}
        />
      )}
    </>
  )
}

interface ConstraintDisplayInfo {
  position: { x: number; y: number } | null
  label: string
  dimensionLine: { from: { x: number; y: number }; to: { x: number; y: number } } | null
}

function getConstraintDisplayInfo(
  constraint: SketchConstraint,
  entities: Map<string, SketchEntity>
): ConstraintDisplayInfo {
  const getPoint = (id: string): SketchPoint | null => {
    const e = entities.get(id)
    return e?.type === 'point' ? e : null
  }

  const getLine = (id: string): SketchLine | null => {
    const e = entities.get(id)
    return e?.type === 'line' ? e : null
  }

  const midpoint = (p1: SketchPoint, p2: SketchPoint) => ({
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  })

  const offset = (pos: { x: number; y: number }, dx: number, dy: number) => ({
    x: pos.x + dx,
    y: pos.y + dy,
  })

  switch (constraint.type) {
    case 'coincident': {
      const p1 = getPoint(constraint.pointId1)
      if (!p1) return { position: null, label: '', dimensionLine: null }
      return { position: offset(p1, 0.3, 0.3), label: 'Co', dimensionLine: null }
    }

    case 'horizontal': {
      if (constraint.entityId) {
        const line = getLine(constraint.entityId)
        if (!line) return { position: null, label: '', dimensionLine: null }
        const p1 = getPoint(line.startPointId)
        const p2 = getPoint(line.endPointId)
        if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
        return { position: offset(midpoint(p1, p2), 0, 0.4), label: 'H', dimensionLine: null }
      }
      const p1 = constraint.pointId1 ? getPoint(constraint.pointId1) : null
      const p2 = constraint.pointId2 ? getPoint(constraint.pointId2) : null
      if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
      return { position: offset(midpoint(p1, p2), 0, 0.4), label: 'H', dimensionLine: null }
    }

    case 'vertical': {
      if (constraint.entityId) {
        const line = getLine(constraint.entityId)
        if (!line) return { position: null, label: '', dimensionLine: null }
        const p1 = getPoint(line.startPointId)
        const p2 = getPoint(line.endPointId)
        if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
        return { position: offset(midpoint(p1, p2), 0.4, 0), label: 'V', dimensionLine: null }
      }
      const p1 = constraint.pointId1 ? getPoint(constraint.pointId1) : null
      const p2 = constraint.pointId2 ? getPoint(constraint.pointId2) : null
      if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
      return { position: offset(midpoint(p1, p2), 0.4, 0), label: 'V', dimensionLine: null }
    }

    case 'fixed': {
      const p = getPoint(constraint.pointId)
      if (!p) return { position: null, label: '', dimensionLine: null }
      return { position: offset(p, 0.3, -0.3), label: 'Fix', dimensionLine: null }
    }

    case 'distance': {
      const p1 = getPoint(constraint.pointId1)
      const p2 = getPoint(constraint.pointId2)
      if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
      const mid = midpoint(p1, p2)
      // Offset perpendicular to the line
      const dx = p2.x - p1.x, dy = p2.y - p1.y
      const len = Math.sqrt(dx * dx + dy * dy)
      const nx = len > 0 ? -dy / len * 0.5 : 0.5
      const ny = len > 0 ? dx / len * 0.5 : 0
      const pos = offset(mid, nx, ny)
      const val = Math.round(constraint.value * 100) / 100
      return {
        position: pos,
        label: String(val),
        dimensionLine: { from: p1, to: p2 },
      }
    }

    case 'horizontalDistance': {
      const p1 = getPoint(constraint.pointId1)
      const p2 = getPoint(constraint.pointId2)
      if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
      const mid = midpoint(p1, p2)
      const val = Math.round(constraint.value * 100) / 100
      return { position: offset(mid, 0, -0.5), label: `DH:${val}`, dimensionLine: null }
    }

    case 'verticalDistance': {
      const p1 = getPoint(constraint.pointId1)
      const p2 = getPoint(constraint.pointId2)
      if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
      const mid = midpoint(p1, p2)
      const val = Math.round(constraint.value * 100) / 100
      return { position: offset(mid, 0.5, 0), label: `DV:${val}`, dimensionLine: null }
    }

    case 'angle': {
      const l1 = getLine(constraint.lineId1)
      const l2 = getLine(constraint.lineId2)
      if (!l1 || !l2) return { position: null, label: '', dimensionLine: null }
      // Show near the intersection of the two lines
      const p1s = getPoint(l1.startPointId)
      const p2s = getPoint(l2.startPointId)
      if (!p1s || !p2s) return { position: null, label: '', dimensionLine: null }
      const mid = midpoint(p1s, p2s)
      const val = Math.round(constraint.value * 10) / 10
      return { position: offset(mid, 0.5, 0.5), label: `${val}\u00B0`, dimensionLine: null }
    }

    case 'perpendicular': {
      const l1 = getLine(constraint.lineId1)
      const l2 = getLine(constraint.lineId2)
      if (!l1 || !l2) return { position: null, label: '', dimensionLine: null }
      const p1 = getPoint(l1.startPointId)
      const p2 = getPoint(l2.startPointId)
      if (!p1 || !p2) return { position: null, label: '', dimensionLine: null }
      return { position: offset(midpoint(p1, p2), 0.4, 0.4), label: '\u22A5', dimensionLine: null }
    }

    case 'parallel': {
      const l1 = getLine(constraint.lineId1)
      const l2 = getLine(constraint.lineId2)
      if (!l1 || !l2) return { position: null, label: '', dimensionLine: null }
      const p1e = getPoint(l1.endPointId)
      const p2e = getPoint(l2.endPointId)
      if (!p1e || !p2e) return { position: null, label: '', dimensionLine: null }
      return { position: offset(midpoint(p1e, p2e), 0.4, 0.4), label: '\u2225', dimensionLine: null }
    }

    case 'equal': {
      const e1 = entities.get(constraint.entityId1)
      const e2 = entities.get(constraint.entityId2)
      if (!e1 || !e2) return { position: null, label: '', dimensionLine: null }
      // Place near the first entity
      if (e1.type === 'line') {
        const p1 = getPoint(e1.startPointId)
        const p2 = getPoint(e1.endPointId)
        if (p1 && p2) return { position: offset(midpoint(p1, p2), 0, 0.4), label: '=', dimensionLine: null }
      }
      return { position: null, label: '', dimensionLine: null }
    }

    case 'radius': {
      const entity = entities.get(constraint.entityId)
      if (!entity) return { position: null, label: '', dimensionLine: null }
      if (entity.type === 'circle' || entity.type === 'arc') {
        const center = getPoint(entity.centerPointId)
        if (!center) return { position: null, label: '', dimensionLine: null }
        const val = Math.round(constraint.value * 100) / 100
        return {
          position: offset(center, entity.type === 'circle' ? (entity as SketchCircle).radius * 0.7 : (entity as SketchArc).radius * 0.7, 0.3),
          label: `R${val}`,
          dimensionLine: null,
        }
      }
      return { position: null, label: '', dimensionLine: null }
    }

    case 'tangent': {
      const e1 = entities.get(constraint.entityId1)
      const e2 = entities.get(constraint.entityId2)
      if (!e1 || !e2) return { position: null, label: '', dimensionLine: null }
      // Place between the two entities
      let cx = 0, cy = 0, count = 0
      for (const e of [e1, e2]) {
        if (e.type === 'circle' || e.type === 'arc') {
          const c = getPoint(e.centerPointId)
          if (c) { cx += c.x; cy += c.y; count++ }
        } else if (e.type === 'line') {
          const p1 = getPoint(e.startPointId)
          const p2 = getPoint(e.endPointId)
          if (p1 && p2) { cx += (p1.x + p2.x) / 2; cy += (p1.y + p2.y) / 2; count++ }
        }
      }
      if (count === 0) return { position: null, label: '', dimensionLine: null }
      return { position: { x: cx / count + 0.4, y: cy / count + 0.4 }, label: 'T', dimensionLine: null }
    }

    case 'midpoint': {
      const p = getPoint(constraint.pointId)
      if (!p) return { position: null, label: '', dimensionLine: null }
      return { position: offset(p, 0.3, 0.3), label: 'Mid', dimensionLine: null }
    }

    case 'pointOnEntity': {
      const p = getPoint(constraint.pointId)
      if (!p) return { position: null, label: '', dimensionLine: null }
      return { position: offset(p, 0.3, -0.3), label: 'On', dimensionLine: null }
    }

    default:
      return { position: null, label: '', dimensionLine: null }
  }
}

// ─── Main Component ─────────────────────────────────────────

export function SketchRenderer() {
  const activeSketch = useAppStore((s) => s.activeSketch)
  const transform = useSketchTransform()

  if (!activeSketch || !transform) return null

  const { entities, selectedEntityIds, hoveredEntityId, constraintStatus } = activeSketch

  // Determine base color based on constraint status
  const statusColor = constraintStatus.isOverConstrained
    ? '#ff4444' // Red for over-constrained
    : constraintStatus.dof === 0 && activeSketch.constraints.length > 0
      ? '#44cc44' // Green for fully constrained
      : ENTITY_COLOR // Default blue for under-constrained

  return (
    <>
      <SketchPlaneVisual />

      {Array.from(entities.values()).map((entity) => {
        const isSelected = selectedEntityIds.includes(entity.id)
        const isHovered = hoveredEntityId === entity.id

        switch (entity.type) {
          case 'point':
            return (
              <SketchPointRenderer
                key={entity.id}
                point={entity}
                to3D={transform.to3D}
                isSelected={isSelected}
                isHovered={isHovered}
              />
            )
          case 'line': {
            const color = getEntityColor(entity.id, entity.construction, selectedEntityIds, hoveredEntityId, statusColor)
            return (
              <SketchLineRenderer
                key={entity.id}
                line={entity}
                entities={entities}
                to3D={transform.to3D}
                color={color}
                dashed={entity.construction}
              />
            )
          }
          case 'circle': {
            const color = getEntityColor(entity.id, entity.construction, selectedEntityIds, hoveredEntityId, statusColor)
            return (
              <SketchCircleRenderer
                key={entity.id}
                circle={entity}
                entities={entities}
                to3D={transform.to3D}
                color={color}
                dashed={entity.construction}
              />
            )
          }
          case 'arc': {
            const color = getEntityColor(entity.id, entity.construction, selectedEntityIds, hoveredEntityId, statusColor)
            return (
              <SketchArcRenderer
                key={entity.id}
                arc={entity}
                entities={entities}
                to3D={transform.to3D}
                color={color}
                dashed={entity.construction}
              />
            )
          }
        }
      })}

      <DrawingPreview to3D={transform.to3D} />
      <ConstraintRenderer to3D={transform.to3D} />
    </>
  )
}

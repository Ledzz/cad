import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useAppStore } from '../store/appStore'
import type { SketchPoint, SketchLine, SketchCircle, SketchArc } from '../engine/sketchTypes'

// ─── Colors ─────────────────────────────────────────────────

const ENTITY_COLOR = '#4488ff'
const ENTITY_HOVER_COLOR = '#66aaff'
const ENTITY_SELECTED_COLOR = '#ffaa44'
const CONSTRUCTION_COLOR = '#446688'
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
  hoveredId: string | null
): string {
  if (selectedIds.includes(entityId)) return ENTITY_SELECTED_COLOR
  if (hoveredId === entityId) return ENTITY_HOVER_COLOR
  if (isConstruction) return CONSTRUCTION_COLOR
  return ENTITY_COLOR
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

// ─── Main Component ─────────────────────────────────────────

export function SketchRenderer() {
  const activeSketch = useAppStore((s) => s.activeSketch)
  const transform = useSketchTransform()

  if (!activeSketch || !transform) return null

  const { entities, selectedEntityIds, hoveredEntityId } = activeSketch

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
            const color = getEntityColor(entity.id, entity.construction, selectedEntityIds, hoveredEntityId)
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
            const color = getEntityColor(entity.id, entity.construction, selectedEntityIds, hoveredEntityId)
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
            const color = getEntityColor(entity.id, entity.construction, selectedEntityIds, hoveredEntityId)
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
    </>
  )
}

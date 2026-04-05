import * as THREE from 'three'
import type { SketchState, SketchPoint, SketchLine, SketchCircle, SketchArc } from './sketchTypes'
import { getOccApi } from '../workers/occApi'

/**
 * Edge definition for the OCC worker.
 */
export interface OccEdgeDef {
  type: 'line' | 'arc' | 'circle'
  points: number[][]
  radius?: number
  normal?: number[]
}

/**
 * Convert sketch 2D coords to 3D world coords using the sketch plane.
 */
function sketchTo3D(
  x: number,
  y: number,
  origin: [number, number, number],
  xDir: [number, number, number],
  yDir: [number, number, number]
): [number, number, number] {
  return [
    origin[0] + xDir[0] * x + yDir[0] * y,
    origin[1] + xDir[1] * x + yDir[1] * y,
    origin[2] + xDir[2] * x + yDir[2] * y,
  ]
}

/**
 * Extract OCC edge definitions from a sketch's entities.
 * Only processes lines, arcs, and circles (not standalone points).
 */
export function sketchToEdges(sketch: SketchState): OccEdgeDef[] {
  const { entities, plane } = sketch
  const edges: OccEdgeDef[] = []
  const points = new Map<string, SketchPoint>()

  // Collect all points
  for (const entity of entities.values()) {
    if (entity.type === 'point') {
      points.set(entity.id, entity)
    }
  }

  for (const entity of entities.values()) {
    if (entity.construction) continue // skip construction geometry

    switch (entity.type) {
      case 'line': {
        const line = entity as SketchLine
        const startPt = points.get(line.startPointId)
        const endPt = points.get(line.endPointId)
        if (!startPt || !endPt) continue

        const p1 = sketchTo3D(startPt.x, startPt.y, plane.origin, plane.xDir, plane.yDir)
        const p2 = sketchTo3D(endPt.x, endPt.y, plane.origin, plane.xDir, plane.yDir)
        edges.push({ type: 'line', points: [p1, p2] })
        break
      }

      case 'circle': {
        const circle = entity as SketchCircle
        const centerPt = points.get(circle.centerPointId)
        if (!centerPt) continue

        const center = sketchTo3D(centerPt.x, centerPt.y, plane.origin, plane.xDir, plane.yDir)
        edges.push({
          type: 'circle',
          points: [center],
          radius: circle.radius,
          normal: [...plane.normal],
        })
        break
      }

      case 'arc': {
        const arc = entity as SketchArc
        const centerPt = points.get(arc.centerPointId)
        const startPt = points.get(arc.startPointId)
        const endPt = points.get(arc.endPointId)
        if (!centerPt || !startPt || !endPt) continue

        // For OCC arc, we need start, mid, end points
        // Compute a midpoint on the arc
        let midAngle = (arc.startAngle + arc.endAngle) / 2
        if (arc.endAngle < arc.startAngle) {
          midAngle = (arc.startAngle + arc.endAngle + Math.PI * 2) / 2
        }
        const midX = centerPt.x + Math.cos(midAngle) * arc.radius
        const midY = centerPt.y + Math.sin(midAngle) * arc.radius

        const p1 = sketchTo3D(startPt.x, startPt.y, plane.origin, plane.xDir, plane.yDir)
        const pMid = sketchTo3D(midX, midY, plane.origin, plane.xDir, plane.yDir)
        const p3 = sketchTo3D(endPt.x, endPt.y, plane.origin, plane.xDir, plane.yDir)

        edges.push({ type: 'arc', points: [p1, pMid, p3] })
        break
      }
    }
  }

  return edges
}

/**
 * Extrude the current sketch profile by a given distance.
 * Returns the tessellated geometry or throws on error.
 */
export async function extrudeCurrentSketch(
  sketch: SketchState,
  distance: number,
  id: string
): Promise<THREE.BufferGeometry> {
  const edges = sketchToEdges(sketch)
  if (edges.length === 0) {
    throw new Error('No sketch edges to extrude')
  }

  const api = await getOccApi()
  const tessData = await api.extrudeSketch(
    id,
    edges,
    sketch.plane.normal as [number, number, number],
    distance
  )

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(tessData.vertices, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(tessData.normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(tessData.indices, 1))
  geometry.userData = { faceRanges: tessData.faceRanges }

  return geometry
}

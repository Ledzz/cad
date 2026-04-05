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

// ─── Edge Grouping ──────────────────────────────────────────

const EPSILON = 1e-6

/**
 * Get the start and end 3D points of an edge definition.
 * For circles (self-closed), returns null — they are always their own group.
 */
function getEdgeEndpoints(edge: OccEdgeDef): { start: number[]; end: number[] } | null {
  switch (edge.type) {
    case 'line':
      return { start: edge.points[0], end: edge.points[1] }
    case 'arc':
      // arc points: [start, mid, end]
      return { start: edge.points[0], end: edge.points[2] }
    case 'circle':
      // circles are self-closed, no shared endpoints
      return null
  }
}

/**
 * Check if two 3D points are the same within epsilon.
 */
function pointsEqual(a: number[], b: number[]): boolean {
  return (
    Math.abs(a[0] - b[0]) < EPSILON &&
    Math.abs(a[1] - b[1]) < EPSILON &&
    Math.abs(a[2] - b[2]) < EPSILON
  )
}

/**
 * Group a flat list of edges into connected loops.
 *
 * Two edges are connected if they share an endpoint (start or end).
 * Circles are always their own group (self-closed curves).
 * Uses union-find for efficient connected component detection.
 */
export function groupEdgesIntoLoops(edges: OccEdgeDef[]): OccEdgeDef[][] {
  if (edges.length === 0) return []
  if (edges.length === 1) return [edges]

  const n = edges.length
  // Union-find
  const parent = Array.from({ length: n }, (_, i) => i)
  const rank = new Array(n).fill(0)

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]] // path compression
      x = parent[x]
    }
    return x
  }

  function union(a: number, b: number): void {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    if (rank[ra] < rank[rb]) {
      parent[ra] = rb
    } else if (rank[ra] > rank[rb]) {
      parent[rb] = ra
    } else {
      parent[rb] = ra
      rank[ra]++
    }
  }

  // Collect endpoints for non-circle edges
  const endpoints: Array<{ start: number[]; end: number[] } | null> = edges.map(getEdgeEndpoints)

  // For each pair of non-circle edges, check if they share an endpoint
  for (let i = 0; i < n; i++) {
    const epI = endpoints[i]
    if (!epI) continue // circle — skip

    for (let j = i + 1; j < n; j++) {
      const epJ = endpoints[j]
      if (!epJ) continue // circle — skip

      if (
        pointsEqual(epI.start, epJ.start) ||
        pointsEqual(epI.start, epJ.end) ||
        pointsEqual(epI.end, epJ.start) ||
        pointsEqual(epI.end, epJ.end)
      ) {
        union(i, j)
      }
    }
  }

  // Group edges by their root
  const groups = new Map<number, OccEdgeDef[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (!groups.has(root)) {
      groups.set(root, [])
    }
    groups.get(root)!.push(edges[i])
  }

  return Array.from(groups.values())
}

// ─── Main Edge Extraction ───────────────────────────────────

/**
 * Extract OCC edge definitions from a sketch's entities, grouped into
 * separate connected loops. Each loop can be independently extruded.
 *
 * Only processes lines, arcs, and circles (not standalone points).
 * Circles are always their own loop (self-closed curves).
 */
export function sketchToEdgeGroups(sketch: SketchState): OccEdgeDef[][] {
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

  return groupEdgesIntoLoops(edges)
}

/**
 * @deprecated Use sketchToEdgeGroups instead. This returns a flat list
 * which fails when the sketch has multiple disconnected profiles.
 */
export function sketchToEdges(sketch: SketchState): OccEdgeDef[] {
  return sketchToEdgeGroups(sketch).flat()
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
  const edgeGroups = sketchToEdgeGroups(sketch)
  if (edgeGroups.length === 0) {
    throw new Error('No sketch edges to extrude')
  }

  const api = await getOccApi()
  const tessData = await api.extrudeSketch(
    id,
    edgeGroups,
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

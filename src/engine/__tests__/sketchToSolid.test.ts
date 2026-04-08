import { describe, it, expect } from 'vitest'
import { groupEdgesIntoLoops, sketchToEdgeGroups } from '../sketchToSolid'
import type { OccEdgeDef } from '../sketchToSolid'
import type { SketchState, SketchPoint, SketchLine, SketchCircle, SketchArc } from '../sketchTypes'
import { createEmptySketch, SKETCH_PLANES } from '../sketchTypes'

// ─── Helpers ────────────────────────────────────────────────

function lineEdge(start: number[], end: number[]): OccEdgeDef {
  return { type: 'line', points: [start, end] }
}

function arcEdge(start: number[], mid: number[], end: number[]): OccEdgeDef {
  return { type: 'arc', points: [start, mid, end] }
}

function circleEdge(center: number[], radius: number): OccEdgeDef {
  return { type: 'circle', points: [center], radius, normal: [0, 0, 1] }
}

function makeSketch(
  plane: typeof SKETCH_PLANES['XY'],
  entities: Array<SketchPoint | SketchLine | SketchCircle | SketchArc>
): SketchState {
  const sketch = createEmptySketch('test', plane)
  for (const e of entities) {
    sketch.entities.set(e.id, e)
  }
  return sketch
}

// ─── groupEdgesIntoLoops ────────────────────────────────────

describe('groupEdgesIntoLoops', () => {
  it('returns empty array for no edges', () => {
    expect(groupEdgesIntoLoops([])).toEqual([])
  })

  it('returns single group for one edge', () => {
    const edges = [lineEdge([0, 0, 0], [1, 0, 0])]
    const groups = groupEdgesIntoLoops(edges)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(1)
  })

  it('groups a closed triangle into one loop', () => {
    const edges = [
      lineEdge([0, 0, 0], [1, 0, 0]),
      lineEdge([1, 0, 0], [0.5, 1, 0]),
      lineEdge([0.5, 1, 0], [0, 0, 0]),
    ]
    const groups = groupEdgesIntoLoops(edges)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  it('groups a closed rectangle into one loop', () => {
    const edges = [
      lineEdge([0, 0, 0], [5, 0, 0]),
      lineEdge([5, 0, 0], [5, 3, 0]),
      lineEdge([5, 3, 0], [0, 3, 0]),
      lineEdge([0, 3, 0], [0, 0, 0]),
    ]
    const groups = groupEdgesIntoLoops(edges)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(4)
  })

  it('separates two disjoint triangles into two loops', () => {
    const edges = [
      // Triangle 1
      lineEdge([0, 0, 0], [1, 0, 0]),
      lineEdge([1, 0, 0], [0.5, 1, 0]),
      lineEdge([0.5, 1, 0], [0, 0, 0]),
      // Triangle 2 (far away)
      lineEdge([10, 10, 0], [11, 10, 0]),
      lineEdge([11, 10, 0], [10.5, 11, 0]),
      lineEdge([10.5, 11, 0], [10, 10, 0]),
    ]
    const groups = groupEdgesIntoLoops(edges)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(3)
    expect(groups[1]).toHaveLength(3)
  })

  it('keeps a circle as its own group', () => {
    const edges = [
      circleEdge([0, 0, 0], 5),
    ]
    const groups = groupEdgesIntoLoops(edges)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(1)
    expect(groups[0][0].type).toBe('circle')
  })

  it('separates a circle from a triangle', () => {
    const edges = [
      circleEdge([0, 0, 0], 5),
      lineEdge([10, 0, 0], [11, 0, 0]),
      lineEdge([11, 0, 0], [10.5, 1, 0]),
      lineEdge([10.5, 1, 0], [10, 0, 0]),
    ]
    const groups = groupEdgesIntoLoops(edges)
    expect(groups).toHaveLength(2)
  })

  it('groups mixed arcs and lines sharing endpoints', () => {
    // Arc from (0,0,0) to (2,0,0) with midpoint at (1,1,0)
    // Line from (2,0,0) back to (0,0,0)
    const edges = [
      arcEdge([0, 0, 0], [1, 1, 0], [2, 0, 0]),
      lineEdge([2, 0, 0], [0, 0, 0]),
    ]
    const groups = groupEdgesIntoLoops(edges)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  it('handles edges with near-coincident (within epsilon) endpoints', () => {
    const edges = [
      lineEdge([0, 0, 0], [1, 0, 0]),
      lineEdge([1.0000001, 0, 0], [0.5, 1, 0]),  // nearly coincident
    ]
    const groups = groupEdgesIntoLoops(edges)
    // Should be grouped together since within EPSILON
    expect(groups).toHaveLength(1)
  })
})

// ─── sketchToEdgeGroups ─────────────────────────────────────

describe('sketchToEdgeGroups', () => {
  it('returns empty array for empty sketch', () => {
    const sketch = createEmptySketch('test', SKETCH_PLANES.XY)
    const groups = sketchToEdgeGroups(sketch)
    expect(groups).toHaveLength(0)
  })

  it('returns empty array for sketch with only points', () => {
    const sketch = makeSketch(SKETCH_PLANES.XY, [
      { type: 'point', id: 'p1', x: 0, y: 0, construction: false },
      { type: 'point', id: 'p2', x: 5, y: 0, construction: false },
    ])
    const groups = sketchToEdgeGroups(sketch)
    expect(groups).toHaveLength(0)
  })

  it('converts a line on XY plane to 3D correctly', () => {
    const sketch = makeSketch(SKETCH_PLANES.XY, [
      { type: 'point', id: 'p1', x: 1, y: 2, construction: false },
      { type: 'point', id: 'p2', x: 4, y: 6, construction: false },
      { type: 'line', id: 'l1', startPointId: 'p1', endPointId: 'p2', construction: false },
    ])
    const groups = sketchToEdgeGroups(sketch)
    expect(groups).toHaveLength(1)
    const edge = groups[0][0]
    expect(edge.type).toBe('line')
    // XY plane: (x,y) -> (x, y, 0)
    expect(edge.points[0][0]).toBeCloseTo(1)
    expect(edge.points[0][1]).toBeCloseTo(2)
    expect(edge.points[0][2]).toBeCloseTo(0)
    expect(edge.points[1][0]).toBeCloseTo(4)
    expect(edge.points[1][1]).toBeCloseTo(6)
    expect(edge.points[1][2]).toBeCloseTo(0)
  })

  it('converts a line on XZ plane to 3D correctly', () => {
    const sketch = makeSketch(SKETCH_PLANES.XZ, [
      { type: 'point', id: 'p1', x: 1, y: 2, construction: false },
      { type: 'point', id: 'p2', x: 4, y: 6, construction: false },
      { type: 'line', id: 'l1', startPointId: 'p1', endPointId: 'p2', construction: false },
    ])
    const groups = sketchToEdgeGroups(sketch)
    expect(groups).toHaveLength(1)
    const edge = groups[0][0]
    // XZ plane: xDir=[1,0,0], yDir=[0,0,-1]
    // (x,y) -> (x*1 + y*0, x*0 + y*0, x*0 + y*(-1)) = (x, 0, -y)
    expect(edge.points[0][0]).toBeCloseTo(1)
    expect(edge.points[0][1]).toBeCloseTo(0)
    expect(edge.points[0][2]).toBeCloseTo(-2)
  })

  it('converts a line on YZ plane to 3D correctly', () => {
    const sketch = makeSketch(SKETCH_PLANES.YZ, [
      { type: 'point', id: 'p1', x: 1, y: 2, construction: false },
      { type: 'point', id: 'p2', x: 4, y: 6, construction: false },
      { type: 'line', id: 'l1', startPointId: 'p1', endPointId: 'p2', construction: false },
    ])
    const groups = sketchToEdgeGroups(sketch)
    expect(groups).toHaveLength(1)
    const edge = groups[0][0]
    // YZ plane: xDir=[0,1,0], yDir=[0,0,1]
    // (x,y) -> (0, x*1, y*1) = (0, x, y)
    expect(edge.points[0][0]).toBeCloseTo(0)
    expect(edge.points[0][1]).toBeCloseTo(1)
    expect(edge.points[0][2]).toBeCloseTo(2)
  })

  it('skips construction geometry', () => {
    const sketch = makeSketch(SKETCH_PLANES.XY, [
      { type: 'point', id: 'p1', x: 0, y: 0, construction: false },
      { type: 'point', id: 'p2', x: 5, y: 0, construction: false },
      { type: 'line', id: 'l1', startPointId: 'p1', endPointId: 'p2', construction: true },
    ])
    const groups = sketchToEdgeGroups(sketch)
    expect(groups).toHaveLength(0)
  })

  it('handles a circle entity', () => {
    const sketch = makeSketch(SKETCH_PLANES.XY, [
      { type: 'point', id: 'cc', x: 3, y: 4, construction: false },
      { type: 'circle', id: 'c1', centerPointId: 'cc', radius: 5, construction: false },
    ])
    const groups = sketchToEdgeGroups(sketch)
    expect(groups).toHaveLength(1)
    expect(groups[0][0].type).toBe('circle')
    expect(groups[0][0].radius).toBe(5)
    // Center should be at (3, 4, 0) on XY plane
    expect(groups[0][0].points[0][0]).toBeCloseTo(3)
    expect(groups[0][0].points[0][1]).toBeCloseTo(4)
    expect(groups[0][0].points[0][2]).toBeCloseTo(0)
  })
})

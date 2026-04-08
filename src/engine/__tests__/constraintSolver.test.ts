import { describe, it, expect } from 'vitest'
import {
  solveConstraints,
  getApplicableConstraints,
  createConstraintFromSelection,
  getConstraintReferencedIds,
} from '../constraintSolver'
import type { SketchEntity, SketchPoint, SketchLine, SketchCircle, SketchArc, SketchConstraint } from '../sketchTypes'

// ─── Test Helpers ───────────────────────────────────────────

function point(id: string, x: number, y: number): SketchPoint {
  return { type: 'point', id, x, y, construction: false }
}

function line(id: string, startPointId: string, endPointId: string): SketchLine {
  return { type: 'line', id, startPointId, endPointId, construction: false }
}

function circle(id: string, centerPointId: string, radius: number): SketchCircle {
  return { type: 'circle', id, centerPointId, radius, construction: false }
}

function arc(id: string, centerPointId: string, startPointId: string, endPointId: string, radius: number, startAngle: number, endAngle: number): SketchArc {
  return { type: 'arc', id, centerPointId, startPointId, endPointId, radius, startAngle, endAngle, construction: false }
}

function entities(...items: SketchEntity[]): Map<string, SketchEntity> {
  const map = new Map<string, SketchEntity>()
  for (const item of items) map.set(item.id, item)
  return map
}

const TOLERANCE = 1e-6

function expectNear(actual: number, expected: number, tol = TOLERANCE) {
  expect(Math.abs(actual - expected)).toBeLessThan(tol)
}

// ─── solveConstraints: Individual constraint types ──────────

describe('solveConstraints', () => {
  it('returns empty updates when no constraints exist', () => {
    const ents = entities(point('p1', 1, 2), point('p2', 5, 6))
    const result = solveConstraints(ents, [])
    expect(result.pointUpdates.size).toBe(0)
    expect(result.status.isSolved).toBe(true)
    expect(result.status.dof).toBe(4) // 2 points x 2 DOF each
  })

  describe('coincident', () => {
    it('makes two points converge to the same position', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 4, 3))
      const constraints: SketchConstraint[] = [
        { type: 'coincident', id: 'c1', pointId1: 'p1', pointId2: 'p2' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')!
      const p2 = result.pointUpdates.get('p2')!
      expectNear(p1.x, p2.x)
      expectNear(p1.y, p2.y)
    })
  })

  describe('horizontal', () => {
    it('makes a line horizontal (same Y for both endpoints)', () => {
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 5, 3),
        line('l1', 'p1', 'p2')
      )
      const constraints: SketchConstraint[] = [
        { type: 'horizontal', id: 'c1', entityId: 'l1' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')
      const p2 = result.pointUpdates.get('p2')
      // At least one point should have moved; their Y should match
      const y1 = p1?.y ?? 0
      const y2 = p2?.y ?? 3
      expectNear(y1, y2, 1e-4)
    })

    it('makes two points horizontal using pointId1/pointId2 form', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 5, 3))
      const constraints: SketchConstraint[] = [
        { type: 'horizontal', id: 'c1', pointId1: 'p1', pointId2: 'p2' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')
      const p2 = result.pointUpdates.get('p2')
      const y1 = p1?.y ?? 0
      const y2 = p2?.y ?? 3
      expectNear(y1, y2, 1e-4)
    })
  })

  describe('vertical', () => {
    it('makes a line vertical (same X for both endpoints)', () => {
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 3, 5),
        line('l1', 'p1', 'p2')
      )
      const constraints: SketchConstraint[] = [
        { type: 'vertical', id: 'c1', entityId: 'l1' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')
      const p2 = result.pointUpdates.get('p2')
      const x1 = p1?.x ?? 0
      const x2 = p2?.x ?? 3
      expectNear(x1, x2, 1e-4)
    })
  })

  describe('fixed', () => {
    it('fixes a point at a specific position', () => {
      const ents = entities(point('p1', 1, 2))
      const constraints: SketchConstraint[] = [
        { type: 'fixed', id: 'c1', pointId: 'p1', x: 5, y: 10 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')!
      expectNear(p1.x, 5)
      expectNear(p1.y, 10)
    })
  })

  describe('distance', () => {
    it('constrains distance between two points', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 1, 0))
      const constraints: SketchConstraint[] = [
        { type: 'distance', id: 'c1', pointId1: 'p1', pointId2: 'p2', value: 5 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')!
      const p2 = result.pointUpdates.get('p2')!
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      expectNear(dist, 5, 1e-4)
    })
  })

  describe('horizontalDistance', () => {
    it('constrains horizontal distance between two points', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 1, 5))
      const constraints: SketchConstraint[] = [
        { type: 'horizontalDistance', id: 'c1', pointId1: 'p1', pointId2: 'p2', value: 7 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')!
      const p2 = result.pointUpdates.get('p2')!
      expectNear(p2.x - p1.x, 7, 1e-4)
    })
  })

  describe('verticalDistance', () => {
    it('constrains vertical distance between two points', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 5, 1))
      const constraints: SketchConstraint[] = [
        { type: 'verticalDistance', id: 'c1', pointId1: 'p1', pointId2: 'p2', value: 10 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')!
      const p2 = result.pointUpdates.get('p2')!
      expectNear(p2.y - p1.y, 10, 1e-4)
    })
  })

  describe('angle', () => {
    it('constrains angle between two lines to 90 degrees', () => {
      // Two lines sharing a point at the origin, initially at ~45 degrees
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 5, 0),
        point('p3', 0, 0),
        point('p4', 3, 3),
        line('l1', 'p1', 'p2'),
        line('l2', 'p3', 'p4'),
      )
      const constraints: SketchConstraint[] = [
        { type: 'angle', id: 'c1', lineId1: 'l1', lineId2: 'l2', value: 90 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
    })
  })

  describe('perpendicular', () => {
    it('makes two lines perpendicular', () => {
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 5, 1),
        point('p3', 0, 0),
        point('p4', 1, 4),
        line('l1', 'p1', 'p2'),
        line('l2', 'p3', 'p4'),
      )
      const constraints: SketchConstraint[] = [
        { type: 'perpendicular', id: 'c1', lineId1: 'l1', lineId2: 'l2' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      // Check dot product is ~0
      const p1 = result.pointUpdates.get('p1') ?? { x: 0, y: 0 }
      const p2 = result.pointUpdates.get('p2') ?? { x: 5, y: 1 }
      const p3 = result.pointUpdates.get('p3') ?? { x: 0, y: 0 }
      const p4 = result.pointUpdates.get('p4') ?? { x: 1, y: 4 }
      const d1x = p2.x - p1.x, d1y = p2.y - p1.y
      const d2x = p4.x - p3.x, d2y = p4.y - p3.y
      const dot = d1x * d2x + d1y * d2y
      const len1 = Math.sqrt(d1x * d1x + d1y * d1y)
      const len2 = Math.sqrt(d2x * d2x + d2y * d2y)
      expectNear(dot / (len1 * len2), 0, 1e-4)
    })
  })

  describe('parallel', () => {
    it('makes two lines parallel', () => {
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 5, 1),
        point('p3', 0, 3),
        point('p4', 4, 6),
        line('l1', 'p1', 'p2'),
        line('l2', 'p3', 'p4'),
      )
      const constraints: SketchConstraint[] = [
        { type: 'parallel', id: 'c1', lineId1: 'l1', lineId2: 'l2' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      // Check cross product is ~0
      const p1 = result.pointUpdates.get('p1') ?? { x: 0, y: 0 }
      const p2 = result.pointUpdates.get('p2') ?? { x: 5, y: 1 }
      const p3 = result.pointUpdates.get('p3') ?? { x: 0, y: 3 }
      const p4 = result.pointUpdates.get('p4') ?? { x: 4, y: 6 }
      const d1x = p2.x - p1.x, d1y = p2.y - p1.y
      const d2x = p4.x - p3.x, d2y = p4.y - p3.y
      const cross = d1x * d2y - d1y * d2x
      const len1 = Math.sqrt(d1x * d1x + d1y * d1y)
      const len2 = Math.sqrt(d2x * d2x + d2y * d2y)
      expectNear(cross / (len1 * len2), 0, 1e-4)
    })
  })

  describe('equal', () => {
    it('makes two lines equal length', () => {
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 3, 0),
        point('p3', 0, 5),
        point('p4', 7, 5),
        line('l1', 'p1', 'p2'),
        line('l2', 'p3', 'p4'),
      )
      const constraints: SketchConstraint[] = [
        { type: 'equal', id: 'c1', entityId1: 'l1', entityId2: 'l2' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1') ?? { x: 0, y: 0 }
      const p2 = result.pointUpdates.get('p2') ?? { x: 3, y: 0 }
      const p3 = result.pointUpdates.get('p3') ?? { x: 0, y: 5 }
      const p4 = result.pointUpdates.get('p4') ?? { x: 7, y: 5 }
      const len1 = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
      const len2 = Math.sqrt((p4.x - p3.x) ** 2 + (p4.y - p3.y) ** 2)
      expectNear(len1, len2, 1e-3)
    })
  })

  describe('radius', () => {
    it('constrains arc radius', () => {
      const ents = entities(
        point('center', 0, 0),
        point('start', 3, 0),
        point('end', 0, 3),
        arc('a1', 'center', 'start', 'end', 3, 0, Math.PI / 2)
      )
      const constraints: SketchConstraint[] = [
        { type: 'radius', id: 'c1', entityId: 'a1', value: 5 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      // Start point should be at distance 5 from center
      const center = result.pointUpdates.get('center') ?? { x: 0, y: 0 }
      const start = result.pointUpdates.get('start') ?? { x: 3, y: 0 }
      const dist = Math.sqrt((start.x - center.x) ** 2 + (start.y - center.y) ** 2)
      expectNear(dist, 5, 1e-3)
    })
  })

  describe('tangent', () => {
    it('makes a line tangent to a circle', () => {
      const ents = entities(
        point('p1', 0, -2),
        point('p2', 10, -2),
        point('cc', 5, 0),
        line('l1', 'p1', 'p2'),
        circle('c1', 'cc', 2),
      )
      const constraints: SketchConstraint[] = [
        { type: 'tangent', id: 'c1', entityId1: 'l1', entityId2: 'c1' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
    })
  })

  describe('midpoint', () => {
    it('constrains a point to be at the midpoint of a line', () => {
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 10, 0),
        point('pm', 3, 4),
        line('l1', 'p1', 'p2'),
      )
      const constraints: SketchConstraint[] = [
        { type: 'midpoint', id: 'c1', pointId: 'pm', lineId: 'l1' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1') ?? { x: 0, y: 0 }
      const p2 = result.pointUpdates.get('p2') ?? { x: 10, y: 0 }
      const pm = result.pointUpdates.get('pm')!
      expectNear(pm.x, (p1.x + p2.x) / 2, 1e-4)
      expectNear(pm.y, (p1.y + p2.y) / 2, 1e-4)
    })
  })

  describe('pointOnEntity', () => {
    it('constrains a point to lie on a line', () => {
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 10, 0),
        point('pq', 5, 3),
        line('l1', 'p1', 'p2'),
      )
      const constraints: SketchConstraint[] = [
        { type: 'pointOnEntity', id: 'c1', pointId: 'pq', entityId: 'l1' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      // Check point is on the line: cross product should be ~0
      const p1 = result.pointUpdates.get('p1') ?? { x: 0, y: 0 }
      const p2 = result.pointUpdates.get('p2') ?? { x: 10, y: 0 }
      const pq = result.pointUpdates.get('pq')!
      const dx = p2.x - p1.x, dy = p2.y - p1.y
      const len = Math.sqrt(dx * dx + dy * dy)
      const cross = Math.abs(dx * (pq.y - p1.y) - dy * (pq.x - p1.x))
      expectNear(cross / len, 0, 1e-3)
    })

    it('constrains a point to lie on a circle', () => {
      const ents = entities(
        point('cc', 0, 0),
        point('pq', 4, 0),
        circle('c1', 'cc', 3),
      )
      const constraints: SketchConstraint[] = [
        { type: 'pointOnEntity', id: 'c1', pointId: 'pq', entityId: 'c1' },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      const cc = result.pointUpdates.get('cc') ?? { x: 0, y: 0 }
      const pq = result.pointUpdates.get('pq')!
      const dist = Math.sqrt((pq.x - cc.x) ** 2 + (pq.y - cc.y) ** 2)
      expectNear(dist, 3, 1e-3)
    })
  })

  // ─── Combined constraints ─────────────────────────────────

  describe('combined constraints', () => {
    it('fully constrains a rectangle (fixed corner + horizontal + vertical + distance)', () => {
      // 4 points forming a rough rectangle
      const ents = entities(
        point('p1', 0, 0),
        point('p2', 4.5, 0.2),
        point('p3', 4.3, 2.8),
        point('p4', 0.1, 3.1),
        line('l1', 'p1', 'p2'),
        line('l2', 'p2', 'p3'),
        line('l3', 'p3', 'p4'),
        line('l4', 'p4', 'p1'),
      )
      const constraints: SketchConstraint[] = [
        { type: 'fixed', id: 'f1', pointId: 'p1', x: 0, y: 0 },
        { type: 'horizontal', id: 'h1', entityId: 'l1' },
        { type: 'horizontal', id: 'h2', entityId: 'l3' },
        { type: 'vertical', id: 'v1', entityId: 'l2' },
        { type: 'vertical', id: 'v2', entityId: 'l4' },
        { type: 'distance', id: 'd1', pointId1: 'p1', pointId2: 'p2', value: 5 },
        { type: 'distance', id: 'd2', pointId1: 'p2', pointId2: 'p3', value: 3 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.isSolved).toBe(true)
      expect(result.status.dof).toBe(0) // fully constrained

      const p1 = result.pointUpdates.get('p1')!
      const p2 = result.pointUpdates.get('p2')!
      const p3 = result.pointUpdates.get('p3')!
      const p4 = result.pointUpdates.get('p4')!

      expectNear(p1.x, 0, 1e-3)
      expectNear(p1.y, 0, 1e-3)
      expectNear(p2.x, 5, 1e-3)
      expectNear(p2.y, 0, 1e-3)
      expectNear(p3.x, 5, 1e-3)
      expectNear(p3.y, 3, 1e-3)
      expectNear(p4.x, 0, 1e-3)
      expectNear(p4.y, 3, 1e-3)
    })
  })

  // ─── DOF reporting ────────────────────────────────────────

  describe('DOF reporting', () => {
    it('reports correct DOF for under-constrained sketch', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 5, 0))
      const constraints: SketchConstraint[] = [
        { type: 'horizontal', id: 'c1', pointId1: 'p1', pointId2: 'p2' },
      ]
      const result = solveConstraints(ents, constraints)
      // 4 vars - 1 constraint = 3 DOF
      expect(result.status.dof).toBe(3)
    })

    it('reports DOF 0 for fully constrained sketch', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 5, 0))
      const constraints: SketchConstraint[] = [
        { type: 'fixed', id: 'f1', pointId: 'p1', x: 0, y: 0 },
        { type: 'fixed', id: 'f2', pointId: 'p2', x: 5, y: 0 },
      ]
      const result = solveConstraints(ents, constraints)
      expect(result.status.dof).toBe(0)
    })
  })

  // ─── Dragging ─────────────────────────────────────────────

  describe('dragging', () => {
    it('keeps dragged point at the drag position', () => {
      const ents = entities(point('p1', 0, 0), point('p2', 5, 0))
      const constraints: SketchConstraint[] = [
        { type: 'distance', id: 'd1', pointId1: 'p1', pointId2: 'p2', value: 5 },
      ]
      const result = solveConstraints(ents, constraints, 'p1', { x: 3, y: 4 })
      expect(result.status.isSolved).toBe(true)
      const p1 = result.pointUpdates.get('p1')!
      expectNear(p1.x, 3)
      expectNear(p1.y, 4)
      // p2 should be at distance 5 from the dragged position
      const p2 = result.pointUpdates.get('p2')!
      const dist = Math.sqrt((p2.x - 3) ** 2 + (p2.y - 4) ** 2)
      expectNear(dist, 5, 1e-3)
    })
  })
})

// ─── getApplicableConstraints ───────────────────────────────

describe('getApplicableConstraints', () => {
  it('returns correct constraints for 2 points', () => {
    const ents = entities(point('p1', 0, 0), point('p2', 5, 3))
    const result = getApplicableConstraints(['p1', 'p2'], ents)
    expect(result).toContain('coincident')
    expect(result).toContain('horizontal')
    expect(result).toContain('vertical')
    expect(result).toContain('distance')
    expect(result).toContain('horizontalDistance')
    expect(result).toContain('verticalDistance')
  })

  it('returns fixed for 1 point', () => {
    const ents = entities(point('p1', 0, 0))
    const result = getApplicableConstraints(['p1'], ents)
    expect(result).toContain('fixed')
  })

  it('returns correct constraints for 1 line', () => {
    const ents = entities(
      point('p1', 0, 0), point('p2', 5, 0),
      line('l1', 'p1', 'p2')
    )
    const result = getApplicableConstraints(['l1'], ents)
    expect(result).toContain('horizontal')
    expect(result).toContain('vertical')
    expect(result).toContain('distance')
  })

  it('returns correct constraints for 2 lines', () => {
    const ents = entities(
      point('p1', 0, 0), point('p2', 5, 0),
      point('p3', 0, 0), point('p4', 0, 5),
      line('l1', 'p1', 'p2'), line('l2', 'p3', 'p4')
    )
    const result = getApplicableConstraints(['l1', 'l2'], ents)
    expect(result).toContain('parallel')
    expect(result).toContain('perpendicular')
    expect(result).toContain('equal')
    expect(result).toContain('angle')
  })

  it('returns radius for 1 circle', () => {
    const ents = entities(point('cc', 0, 0), circle('c1', 'cc', 5))
    const result = getApplicableConstraints(['c1'], ents)
    expect(result).toContain('radius')
  })

  it('returns midpoint and pointOnEntity for point + line', () => {
    const ents = entities(
      point('p1', 0, 0), point('p2', 10, 0), point('pm', 5, 5),
      line('l1', 'p1', 'p2')
    )
    const result = getApplicableConstraints(['pm', 'l1'], ents)
    expect(result).toContain('midpoint')
    expect(result).toContain('pointOnEntity')
  })

  it('returns tangent for line + circle', () => {
    const ents = entities(
      point('p1', 0, 0), point('p2', 10, 0), point('cc', 5, 5),
      line('l1', 'p1', 'p2'), circle('c1', 'cc', 3)
    )
    const result = getApplicableConstraints(['l1', 'c1'], ents)
    expect(result).toContain('tangent')
  })
})

// ─── createConstraintFromSelection ──────────────────────────

describe('createConstraintFromSelection', () => {
  it('creates a coincident constraint from 2 points', () => {
    const ents = entities(point('p1', 0, 0), point('p2', 5, 3))
    const c = createConstraintFromSelection('coincident', 'c1', ['p1', 'p2'], ents)
    expect(c).not.toBeNull()
    expect(c!.type).toBe('coincident')
    if (c!.type === 'coincident') {
      expect(c!.pointId1).toBe('p1')
      expect(c!.pointId2).toBe('p2')
    }
  })

  it('creates a horizontal constraint from 1 line', () => {
    const ents = entities(
      point('p1', 0, 0), point('p2', 5, 3), line('l1', 'p1', 'p2')
    )
    const c = createConstraintFromSelection('horizontal', 'c1', ['l1'], ents)
    expect(c).not.toBeNull()
    expect(c!.type).toBe('horizontal')
  })

  it('creates a distance constraint from 2 points with measured value', () => {
    const ents = entities(point('p1', 0, 0), point('p2', 3, 4))
    const c = createConstraintFromSelection('distance', 'c1', ['p1', 'p2'], ents)
    expect(c).not.toBeNull()
    if (c!.type === 'distance') {
      expectNear(c!.value, 5) // sqrt(9 + 16)
    }
  })

  it('creates a distance constraint with explicit value', () => {
    const ents = entities(point('p1', 0, 0), point('p2', 3, 4))
    const c = createConstraintFromSelection('distance', 'c1', ['p1', 'p2'], ents, 10)
    expect(c).not.toBeNull()
    if (c!.type === 'distance') {
      expect(c!.value).toBe(10)
    }
  })

  it('returns null for invalid selection', () => {
    const ents = entities(point('p1', 0, 0))
    const c = createConstraintFromSelection('coincident', 'c1', ['p1'], ents)
    expect(c).toBeNull()
  })

  it('creates a midpoint constraint from point + line', () => {
    const ents = entities(
      point('p1', 0, 0), point('p2', 10, 0), point('pm', 5, 5),
      line('l1', 'p1', 'p2')
    )
    const c = createConstraintFromSelection('midpoint', 'c1', ['pm', 'l1'], ents)
    expect(c).not.toBeNull()
    if (c!.type === 'midpoint') {
      expect(c!.pointId).toBe('pm')
      expect(c!.lineId).toBe('l1')
    }
  })
})

// ─── getConstraintReferencedIds ─────────────────────────────

describe('getConstraintReferencedIds', () => {
  const emptyEntities = new Map<string, SketchEntity>()

  it('returns both point IDs for coincident', () => {
    const ids = getConstraintReferencedIds(
      { type: 'coincident', id: 'c1', pointId1: 'p1', pointId2: 'p2' },
      emptyEntities
    )
    expect(ids).toContain('p1')
    expect(ids).toContain('p2')
  })

  it('returns entity ID for horizontal with entity', () => {
    const ids = getConstraintReferencedIds(
      { type: 'horizontal', id: 'c1', entityId: 'l1' },
      emptyEntities
    )
    expect(ids).toContain('l1')
  })

  it('returns both line IDs for perpendicular', () => {
    const ids = getConstraintReferencedIds(
      { type: 'perpendicular', id: 'c1', lineId1: 'l1', lineId2: 'l2' },
      emptyEntities
    )
    expect(ids).toContain('l1')
    expect(ids).toContain('l2')
  })

  it('returns point and line for midpoint', () => {
    const ids = getConstraintReferencedIds(
      { type: 'midpoint', id: 'c1', pointId: 'pm', lineId: 'l1' },
      emptyEntities
    )
    expect(ids).toContain('pm')
    expect(ids).toContain('l1')
  })

  it('returns point and entity for pointOnEntity', () => {
    const ids = getConstraintReferencedIds(
      { type: 'pointOnEntity', id: 'c1', pointId: 'pq', entityId: 'c1' },
      emptyEntities
    )
    expect(ids).toContain('pq')
    expect(ids).toContain('c1')
  })
})

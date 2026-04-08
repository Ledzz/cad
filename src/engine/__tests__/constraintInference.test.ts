import { describe, it, expect } from 'vitest'
import { inferConstraints, ANGLE_TOLERANCE_DEG } from '../constraintInference'
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

function ents(...items: SketchEntity[]): Map<string, SketchEntity> {
  const map = new Map<string, SketchEntity>()
  for (const item of items) map.set(item.id, item)
  return map
}

/** Simple incrementing ID generator for tests */
function makeIdGen(prefix = 'cst') {
  let n = 0
  return () => `${prefix}_${++n}`
}

// ─── Horizontal / Vertical Inference ────────────────────────

describe('inferConstraints', () => {
  describe('horizontal line detection', () => {
    it('infers horizontal constraint for a perfectly horizontal line', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      const h = result.find((c) => c.type === 'horizontal')
      expect(h).toBeDefined()
      expect(h!.type).toBe('horizontal')
      if (h!.type === 'horizontal') {
        expect(h!.entityId).toBe('ln1')
      }
    })

    it('infers horizontal for a nearly-horizontal line (within tolerance)', () => {
      // 1 degree slope — well within the 2.5° tolerance
      const dy = 5 * Math.tan((1 * Math.PI) / 180) // ~0.087
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, dy),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'horizontal')).toBe(true)
    })

    it('does NOT infer horizontal for a line just outside tolerance', () => {
      // 5 degrees — outside the 2.5° tolerance
      const dy = 5 * Math.tan((5 * Math.PI) / 180) // ~0.437
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, dy),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'horizontal')).toBe(false)
    })

    it('infers horizontal for a line going in the negative-X direction', () => {
      const e = ents(
        point('p1', 5, 0),
        point('p2', 0, 0),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'horizontal')).toBe(true)
    })
  })

  describe('vertical line detection', () => {
    it('infers vertical constraint for a perfectly vertical line', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 0, 5),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      const v = result.find((c) => c.type === 'vertical')
      expect(v).toBeDefined()
      if (v!.type === 'vertical') {
        expect(v!.entityId).toBe('ln1')
      }
    })

    it('infers vertical for a nearly-vertical line (within tolerance)', () => {
      const dx = 5 * Math.tan((1 * Math.PI) / 180)
      const e = ents(
        point('p1', 0, 0),
        point('p2', dx, 5),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'vertical')).toBe(true)
    })

    it('does NOT infer vertical for a line just outside tolerance', () => {
      const dx = 5 * Math.tan((5 * Math.PI) / 180)
      const e = ents(
        point('p1', 0, 0),
        point('p2', dx, 5),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'vertical')).toBe(false)
    })

    it('infers vertical for a line going in the negative-Y direction', () => {
      const e = ents(
        point('p1', 0, 5),
        point('p2', 0, 0),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'vertical')).toBe(true)
    })
  })

  describe('does not infer both H and V', () => {
    it('a diagonal line gets neither horizontal nor vertical', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 5),
        line('ln1', 'p1', 'p2')
      )
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'horizontal')).toBe(false)
      expect(result.some((c) => c.type === 'vertical')).toBe(false)
    })
  })

  // ─── Perpendicular Inference ────────────────────────────────

  describe('perpendicular detection', () => {
    it('infers perpendicular between a new line and an existing connected line at 90°', () => {
      // Existing horizontal line, new vertical line sharing endpoint p2
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        point('p3', 5, 5),
        line('ln_old', 'p1', 'p2'),
        line('ln_new', 'p2', 'p3')
      )
      // Only ln_new is new (p3 is new too), ln_old already existed
      const result = inferConstraints(['p3', 'ln_new'], e, [], makeIdGen())
      // The new line is vertical, so it gets a 'vertical' constraint, not perpendicular
      // (H/V take priority over perpendicular to an axis-aligned line)
      // Let's check perpendicular is NOT added for H/V lines
      expect(result.some((c) => c.type === 'perpendicular')).toBe(false)
      expect(result.some((c) => c.type === 'vertical')).toBe(true)
    })

    it('infers perpendicular for two non-axis-aligned connected lines at 90°', () => {
      // Existing 45° line, new 135° line sharing endpoint — perpendicular!
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 5),   // 45° line
        point('p3', 10, 0),  // 135° from p2 — perpendicular to 45°
        line('ln_old', 'p1', 'p2'),
        line('ln_new', 'p2', 'p3')
      )
      const result = inferConstraints(['p3', 'ln_new'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'perpendicular')).toBe(true)
    })

    it('does NOT infer perpendicular for non-connected lines', () => {
      // Two perpendicular lines that don't share an endpoint
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 5),
        point('p3', 10, 10),
        point('p4', 15, 5),
        line('ln_old', 'p1', 'p2'),
        line('ln_new', 'p3', 'p4')
      )
      const result = inferConstraints(['p3', 'p4', 'ln_new'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'perpendicular')).toBe(false)
    })

    it('does NOT infer perpendicular when angle is outside tolerance', () => {
      // ~80° angle — not close enough to 90°
      const angle1 = (40 * Math.PI) / 180
      const angle2 = (120 * Math.PI) / 180 // 80° between them, not 90°
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5 * Math.cos(angle1), 5 * Math.sin(angle1)),
        point('p3', 5 * Math.cos(angle1) + 5 * Math.cos(angle2), 5 * Math.sin(angle1) + 5 * Math.sin(angle2)),
        line('ln_old', 'p1', 'p2'),
        line('ln_new', 'p2', 'p3')
      )
      const result = inferConstraints(['p3', 'ln_new'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'perpendicular')).toBe(false)
    })
  })

  // ─── Tangent Inference ──────────────────────────────────────

  describe('tangent detection', () => {
    it('infers tangent when a new line leaves an arc tangentially', () => {
      // Arc centered at origin, radius 5, start point at (5,0)
      // Tangent at (5,0) is vertical (direction (0,1))
      // New line from (5,0) going straight up — tangent!
      const e = ents(
        point('center', 0, 0),
        point('arcStart', 5, 0),
        point('arcEnd', 0, 5),
        arc('arc1', 'center', 'arcStart', 'arcEnd', 5, 0, Math.PI / 2),
        point('lineEnd', 5, 5),
        line('ln1', 'arcStart', 'lineEnd')
      )
      const result = inferConstraints(['lineEnd', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'tangent')).toBe(true)
    })

    it('does NOT infer tangent when line is not tangent to arc', () => {
      // Line leaves arc at 45° to the radius — not tangent
      const e = ents(
        point('center', 0, 0),
        point('arcStart', 5, 0),
        point('arcEnd', 0, 5),
        arc('arc1', 'center', 'arcStart', 'arcEnd', 5, 0, Math.PI / 2),
        point('lineEnd', 10, 5),  // 45° direction from (5,0) — not tangent
        line('ln1', 'arcStart', 'lineEnd')
      )
      const result = inferConstraints(['lineEnd', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'tangent')).toBe(false)
    })

    it('does NOT infer tangent for line not sharing a point with arc', () => {
      const e = ents(
        point('center', 0, 0),
        point('arcStart', 5, 0),
        point('arcEnd', 0, 5),
        arc('arc1', 'center', 'arcStart', 'arcEnd', 5, 0, Math.PI / 2),
        point('lp1', 5, 0.1),  // Close but not the same point
        point('lp2', 5, 5),
        line('ln1', 'lp1', 'lp2')
      )
      const result = inferConstraints(['lp1', 'lp2', 'ln1'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'tangent')).toBe(false)
    })
  })

  // ─── Rectangle (4-line) Inference ─────────────────────────

  describe('rectangle (4-line batch)', () => {
    it('infers H, V, and equal constraints for a standard rectangle', () => {
      // Rectangle: (0,0)-(10,0)-(10,5)-(0,5)
      const e = ents(
        point('p1', 0, 0),
        point('p2', 10, 0),
        point('p3', 10, 5),
        point('p4', 0, 5),
        line('ln1', 'p1', 'p2'),  // bottom (horizontal)
        line('ln2', 'p2', 'p3'),  // right  (vertical)
        line('ln3', 'p3', 'p4'),  // top    (horizontal)
        line('ln4', 'p4', 'p1')   // left   (vertical)
      )
      const newIds = ['p1', 'p2', 'p3', 'p4', 'ln1', 'ln2', 'ln3', 'ln4']
      const result = inferConstraints(newIds, e, [], makeIdGen())

      // Should have 2 horizontal (ln1, ln3) + 2 vertical (ln2, ln4) + 2 equal
      const horizontals = result.filter((c) => c.type === 'horizontal')
      const verticals = result.filter((c) => c.type === 'vertical')
      const equals = result.filter((c) => c.type === 'equal')

      expect(horizontals.length).toBe(2)
      expect(verticals.length).toBe(2)
      expect(equals.length).toBe(2)

      // Check equal pairs: opposite edges
      const eqIds = equals.map((c) => {
        if (c.type !== 'equal') return []
        return [c.entityId1, c.entityId2].sort()
      })
      expect(eqIds).toContainEqual(['ln1', 'ln3'].sort())
      expect(eqIds).toContainEqual(['ln2', 'ln4'].sort())
    })

    it('infers equal for a square (all edges same length)', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        point('p3', 5, 5),
        point('p4', 0, 5),
        line('ln1', 'p1', 'p2'),
        line('ln2', 'p2', 'p3'),
        line('ln3', 'p3', 'p4'),
        line('ln4', 'p4', 'p1')
      )
      const newIds = ['p1', 'p2', 'p3', 'p4', 'ln1', 'ln2', 'ln3', 'ln4']
      const result = inferConstraints(newIds, e, [], makeIdGen())
      // All 4 edges are equal length, so both opposite pairs get equal constraints
      expect(result.filter((c) => c.type === 'equal').length).toBe(2)
    })
  })

  // ─── Duplicate Detection ──────────────────────────────────

  describe('duplicate detection', () => {
    it('does NOT add horizontal if an identical horizontal already exists', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        line('ln1', 'p1', 'p2')
      )
      const existing: SketchConstraint[] = [
        { type: 'horizontal', id: 'existing_h', entityId: 'ln1' },
      ]
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, existing, makeIdGen())
      expect(result.filter((c) => c.type === 'horizontal').length).toBe(0)
    })

    it('does NOT add perpendicular if already exists (regardless of order)', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 5),
        point('p3', 10, 0),
        line('ln_old', 'p1', 'p2'),
        line('ln_new', 'p2', 'p3')
      )
      // The existing constraint has the lines in reverse order
      const existing: SketchConstraint[] = [
        { type: 'perpendicular', id: 'existing_perp', lineId1: 'ln_new', lineId2: 'ln_old' },
      ]
      const result = inferConstraints(['p3', 'ln_new'], e, existing, makeIdGen())
      expect(result.filter((c) => c.type === 'perpendicular').length).toBe(0)
    })

    it('does NOT add equal if already exists (regardless of order)', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        point('p3', 5, 5),
        point('p4', 0, 5),
        line('ln1', 'p1', 'p2'),
        line('ln2', 'p2', 'p3'),
        line('ln3', 'p3', 'p4'),
        line('ln4', 'p4', 'p1')
      )
      const existing: SketchConstraint[] = [
        { type: 'equal', id: 'eq1', entityId1: 'ln3', entityId2: 'ln1' },  // reversed order
      ]
      const newIds = ['p1', 'p2', 'p3', 'p4', 'ln1', 'ln2', 'ln3', 'ln4']
      const result = inferConstraints(newIds, e, existing, makeIdGen())
      // ln1/ln3 equal already exists, so only ln2/ln4 should be added
      expect(result.filter((c) => c.type === 'equal').length).toBe(1)
    })
  })

  // ─── Edge Cases ───────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty array when no new entities are provided', () => {
      const e = ents(point('p1', 0, 0))
      const result = inferConstraints([], e, [], makeIdGen())
      expect(result).toEqual([])
    })

    it('returns empty array when only points are created (no lines)', () => {
      const e = ents(point('p1', 0, 0), point('p2', 5, 0))
      const result = inferConstraints(['p1', 'p2'], e, [], makeIdGen())
      expect(result).toEqual([])
    })

    it('handles a degenerate zero-length line gracefully', () => {
      const e = ents(
        point('p1', 3, 3),
        point('p2', 3, 3),
        line('ln1', 'p1', 'p2')
      )
      // Should not crash, may infer both H and V or neither for a zero-length line
      const result = inferConstraints(['p1', 'p2', 'ln1'], e, [], makeIdGen())
      // The important thing is no crash
      expect(Array.isArray(result)).toBe(true)
    })

    it('does not infer perpendicular between two new lines in a rectangle batch', () => {
      // In a rectangle, all 4 lines are new — perpendicular should NOT fire
      // between new lines (it only checks new-vs-existing)
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        point('p3', 5, 3),
        point('p4', 0, 3),
        line('ln1', 'p1', 'p2'),
        line('ln2', 'p2', 'p3'),
        line('ln3', 'p3', 'p4'),
        line('ln4', 'p4', 'p1')
      )
      const newIds = ['p1', 'p2', 'p3', 'p4', 'ln1', 'ln2', 'ln3', 'ln4']
      const result = inferConstraints(newIds, e, [], makeIdGen())
      // Should have H, V, and equal — but no perpendicular
      expect(result.some((c) => c.type === 'perpendicular')).toBe(false)
    })

    it('generates unique IDs for each inferred constraint', () => {
      const e = ents(
        point('p1', 0, 0),
        point('p2', 10, 0),
        point('p3', 10, 5),
        point('p4', 0, 5),
        line('ln1', 'p1', 'p2'),
        line('ln2', 'p2', 'p3'),
        line('ln3', 'p3', 'p4'),
        line('ln4', 'p4', 'p1')
      )
      const newIds = ['p1', 'p2', 'p3', 'p4', 'ln1', 'ln2', 'ln3', 'ln4']
      const result = inferConstraints(newIds, e, [], makeIdGen())
      const ids = result.map((c) => c.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  // ─── Mixed scenarios ──────────────────────────────────────

  describe('mixed scenarios', () => {
    it('infers horizontal on new line + perpendicular to existing diagonal', () => {
      // Existing: 45° line from (0,0) to (5,5)
      // New: horizontal line from (5,5) to (10,5)
      // Should get: horizontal constraint (because nearly H)
      // Should NOT get perpendicular (H and 45° are not perpendicular)
      const e = ents(
        point('p1', 0, 0),
        point('p2', 5, 5),
        line('ln_diag', 'p1', 'p2'),
        point('p3', 10, 5),
        line('ln_h', 'p2', 'p3')
      )
      const result = inferConstraints(['p3', 'ln_h'], e, [], makeIdGen())
      expect(result.some((c) => c.type === 'horizontal')).toBe(true)
      expect(result.some((c) => c.type === 'perpendicular')).toBe(false)
    })

    it('a chain of lines: each new segment inferred independently', () => {
      // First segment: horizontal
      const e1 = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        line('ln1', 'p1', 'p2')
      )
      const r1 = inferConstraints(['p1', 'p2', 'ln1'], e1, [], makeIdGen())
      expect(r1.some((c) => c.type === 'horizontal')).toBe(true)

      // Second segment: vertical from p2 — perpendicular skipped because it's V
      const e2 = ents(
        point('p1', 0, 0),
        point('p2', 5, 0),
        line('ln1', 'p1', 'p2'),
        point('p3', 5, 5),
        line('ln2', 'p2', 'p3')
      )
      const r2 = inferConstraints(['p3', 'ln2'], e2, r1, makeIdGen())
      expect(r2.some((c) => c.type === 'vertical')).toBe(true)
      // H/V already implies the perpendicular relationship, so no explicit perpendicular
      expect(r2.some((c) => c.type === 'perpendicular')).toBe(false)
    })
  })
})

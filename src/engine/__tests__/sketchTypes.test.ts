import { describe, it, expect } from 'vitest'
import { createEmptySketch, generateEntityId, getPoint, SKETCH_PLANES } from '../sketchTypes'

// ─── createEmptySketch ──────────────────────────────────────

describe('createEmptySketch', () => {
  it('creates a valid empty sketch state', () => {
    const sketch = createEmptySketch('sk1', SKETCH_PLANES.XY)
    expect(sketch.id).toBe('sk1')
    expect(sketch.plane).toBe(SKETCH_PLANES.XY)
    expect(sketch.entities.size).toBe(0)
    expect(sketch.constraints).toHaveLength(0)
    expect(sketch.constraintStatus.dof).toBe(0)
    expect(sketch.constraintStatus.isSolved).toBe(true)
    expect(sketch.constraintStatus.isOverConstrained).toBe(false)
    expect(sketch.selectedEntityIds).toHaveLength(0)
    expect(sketch.hoveredEntityId).toBeNull()
    expect(sketch.activeTool).toBeNull()
    expect(sketch.activeConstraintTool).toBeNull()
    expect(sketch.drawingState.tool).toBeNull()
    expect(sketch.drawingState.placedPointIds).toHaveLength(0)
    expect(sketch.drawingState.previewPosition).toBeNull()
    expect(sketch.selectionRect).toBeNull()
    expect(sketch.nextEntityId).toBe(1)
  })

  it('stores the correct plane', () => {
    const sketch = createEmptySketch('sk2', SKETCH_PLANES.XZ)
    expect(sketch.plane.name).toBe('XZ')
    expect(sketch.plane.normal).toEqual([0, 1, 0])
  })
})

// ─── generateEntityId ───────────────────────────────────────

describe('generateEntityId', () => {
  it('generates an ID with the given prefix and the next entity counter', () => {
    const sketch = createEmptySketch('sk1', SKETCH_PLANES.XY)
    const id = generateEntityId(sketch, 'pt')
    expect(id).toBe('pt_1')
  })

  it('uses the current nextEntityId value', () => {
    const sketch = createEmptySketch('sk1', SKETCH_PLANES.XY)
    sketch.nextEntityId = 42
    const id = generateEntityId(sketch, 'line')
    expect(id).toBe('line_42')
  })
})

// ─── getPoint ───────────────────────────────────────────────

describe('getPoint', () => {
  it('returns the point entity when it exists', () => {
    const sketch = createEmptySketch('sk1', SKETCH_PLANES.XY)
    sketch.entities.set('p1', { type: 'point', id: 'p1', x: 3, y: 7, construction: false })
    const pt = getPoint(sketch, 'p1')
    expect(pt).not.toBeNull()
    expect(pt!.x).toBe(3)
    expect(pt!.y).toBe(7)
  })

  it('returns null for non-existent ID', () => {
    const sketch = createEmptySketch('sk1', SKETCH_PLANES.XY)
    expect(getPoint(sketch, 'nonexistent')).toBeNull()
  })

  it('returns null for non-point entity', () => {
    const sketch = createEmptySketch('sk1', SKETCH_PLANES.XY)
    sketch.entities.set('p1', { type: 'point', id: 'p1', x: 0, y: 0, construction: false })
    sketch.entities.set('p2', { type: 'point', id: 'p2', x: 5, y: 0, construction: false })
    sketch.entities.set('l1', { type: 'line', id: 'l1', startPointId: 'p1', endPointId: 'p2', construction: false })
    expect(getPoint(sketch, 'l1')).toBeNull()
  })
})

// ─── SKETCH_PLANES ──────────────────────────────────────────

describe('SKETCH_PLANES', () => {
  it('has XY, XZ, YZ planes defined', () => {
    expect(SKETCH_PLANES.XY).toBeDefined()
    expect(SKETCH_PLANES.XZ).toBeDefined()
    expect(SKETCH_PLANES.YZ).toBeDefined()
  })

  it('XY plane has correct axes', () => {
    const p = SKETCH_PLANES.XY
    expect(p.normal).toEqual([0, 0, 1])
    expect(p.xDir).toEqual([1, 0, 0])
    expect(p.yDir).toEqual([0, 1, 0])
  })

  it('XZ plane has correct axes', () => {
    const p = SKETCH_PLANES.XZ
    expect(p.normal).toEqual([0, 1, 0])
    expect(p.xDir).toEqual([1, 0, 0])
    expect(p.yDir).toEqual([0, 0, -1])
  })

  it('YZ plane has correct axes', () => {
    const p = SKETCH_PLANES.YZ
    expect(p.normal).toEqual([1, 0, 0])
    expect(p.xDir).toEqual([0, 1, 0])
    expect(p.yDir).toEqual([0, 0, 1])
  })
})

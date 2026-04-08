import { describe, it, expect, beforeEach } from 'vitest'
import {
  snapshotSketch,
  restoreSketchEntities,
  generateFeatureId,
  resetFeatureCounter,
  featureTypeLabel,
  featureDisplayLabel,
  getEditableParams,
  getFullEditableParams,
  createDefaultFeature,
} from '../featureTypes'
import type { SketchEntity, SketchConstraint } from '../sketchTypes'
import { SKETCH_PLANES } from '../sketchTypes'

// ─── Helpers ────────────────────────────────────────────────

function makeEntities(): Map<string, SketchEntity> {
  const map = new Map<string, SketchEntity>()
  map.set('p1', { type: 'point', id: 'p1', x: 0, y: 0, construction: false })
  map.set('p2', { type: 'point', id: 'p2', x: 5, y: 0, construction: false })
  map.set('p3', { type: 'point', id: 'p3', x: 5, y: 3, construction: false })
  map.set('l1', { type: 'line', id: 'l1', startPointId: 'p1', endPointId: 'p2', construction: false })
  map.set('c1', { type: 'circle', id: 'c1', centerPointId: 'p1', radius: 2, construction: false })
  map.set('a1', {
    type: 'arc', id: 'a1',
    centerPointId: 'p1', startPointId: 'p2', endPointId: 'p3',
    radius: 5, startAngle: 0, endAngle: Math.PI / 2,
    construction: true,
  })
  return map
}

function makeConstraints(): SketchConstraint[] {
  return [
    { type: 'coincident', id: 'con1', pointId1: 'p1', pointId2: 'p2' },
    { type: 'horizontal', id: 'con2', entityId: 'l1' },
    { type: 'distance', id: 'con3', pointId1: 'p1', pointId2: 'p2', value: 5 },
    { type: 'radius', id: 'con4', entityId: 'c1', value: 2 },
  ]
}

// ─── snapshotSketch / restoreSketchEntities round-trip ──────

describe('snapshotSketch / restoreSketchEntities', () => {
  it('round-trips entities preserving all entity types', () => {
    const ents = makeEntities()
    const snapshot = snapshotSketch(SKETCH_PLANES.XY, ents)
    const restored = restoreSketchEntities(snapshot)

    expect(restored.entities.size).toBe(ents.size)

    // Check each entity
    for (const [id, original] of ents) {
      const restoredEntity = restored.entities.get(id)
      expect(restoredEntity).toBeDefined()
      expect(restoredEntity).toEqual(original)
    }
  })

  it('round-trips constraints', () => {
    const ents = makeEntities()
    const constraints = makeConstraints()
    const snapshot = snapshotSketch(SKETCH_PLANES.XY, ents, constraints)
    const restored = restoreSketchEntities(snapshot)

    expect(restored.constraints).toHaveLength(constraints.length)
    for (let i = 0; i < constraints.length; i++) {
      expect(restored.constraints[i]).toEqual(constraints[i])
    }
  })

  it('creates independent copies (no shared references)', () => {
    const ents = makeEntities()
    const constraints = makeConstraints()
    const snapshot = snapshotSketch(SKETCH_PLANES.XY, ents, constraints)
    const restored = restoreSketchEntities(snapshot)

    // Mutating the restored should not affect the snapshot
    restored.entities.delete('p1')
    restored.constraints.pop()

    const restored2 = restoreSketchEntities(snapshot)
    expect(restored2.entities.has('p1')).toBe(true)
    expect(restored2.constraints).toHaveLength(constraints.length)
  })

  it('preserves the plane in the snapshot', () => {
    const snapshot = snapshotSketch(SKETCH_PLANES.XZ, new Map())
    expect(snapshot.plane).toEqual(SKETCH_PLANES.XZ)
  })

  it('handles empty entities and constraints', () => {
    const snapshot = snapshotSketch(SKETCH_PLANES.XY, new Map(), [])
    const restored = restoreSketchEntities(snapshot)
    expect(restored.entities.size).toBe(0)
    expect(restored.constraints).toHaveLength(0)
  })
})

// ─── generateFeatureId / resetFeatureCounter ────────────────

describe('generateFeatureId / resetFeatureCounter', () => {
  beforeEach(() => {
    resetFeatureCounter()
  })

  it('generates incrementing IDs', () => {
    const id1 = generateFeatureId('sketch')
    const id2 = generateFeatureId('sketch')
    const id3 = generateFeatureId('extrude')
    expect(id1).toBe('sketch-1')
    expect(id2).toBe('sketch-2')
    expect(id3).toBe('extrude-3')
  })

  it('resets counter properly', () => {
    generateFeatureId('test')
    generateFeatureId('test')
    resetFeatureCounter()
    const id = generateFeatureId('test')
    expect(id).toBe('test-1')
  })
})

// ─── featureTypeLabel ───────────────────────────────────────

describe('featureTypeLabel', () => {
  it('returns correct labels for all types', () => {
    expect(featureTypeLabel('sketch')).toBe('Sketch')
    expect(featureTypeLabel('extrude')).toBe('Extrude')
    expect(featureTypeLabel('revolve')).toBe('Revolve')
    expect(featureTypeLabel('fillet')).toBe('Fillet')
    expect(featureTypeLabel('chamfer')).toBe('Chamfer')
  })
})

// ─── featureDisplayLabel ────────────────────────────────────

describe('featureDisplayLabel', () => {
  it('returns "Cut Extrude" for cut operation', () => {
    const result = featureDisplayLabel({
      id: 'e1', name: 'Extrude', type: 'extrude', suppressed: false,
      sketchId: 's1', distance: 5, direction: 'normal', operation: 'cut', mode: 'blind',
    })
    expect(result).toBe('Cut Extrude')
  })

  it('returns "Extrude" for boss operation', () => {
    const result = featureDisplayLabel({
      id: 'e1', name: 'Extrude', type: 'extrude', suppressed: false,
      sketchId: 's1', distance: 5, direction: 'normal', operation: 'boss', mode: 'blind',
    })
    expect(result).toBe('Extrude')
  })

  it('returns type label for non-extrude features', () => {
    expect(featureDisplayLabel({
      id: 'f1', name: 'Fillet', type: 'fillet', suppressed: false, radius: 1,
    })).toBe('Fillet')
  })
})

// ─── getEditableParams ──────────────────────────────────────

describe('getEditableParams', () => {
  it('returns distance for extrude', () => {
    const params = getEditableParams({
      id: 'e1', name: 'Extrude', type: 'extrude', suppressed: false,
      sketchId: 's1', distance: 10, direction: 'normal', operation: 'boss', mode: 'blind',
    })
    expect(params.distance).toBeDefined()
    expect(params.distance.value).toBe(10)
    expect(params.distance.min).toBe(0.01)
  })

  it('returns angle for revolve', () => {
    const params = getEditableParams({
      id: 'r1', name: 'Revolve', type: 'revolve', suppressed: false,
      sketchId: 's1', axis: 'Y', angle: 180,
    })
    expect(params.angle).toBeDefined()
    expect(params.angle.value).toBe(180)
    expect(params.angle.min).toBe(1)
    expect(params.angle.max).toBe(360)
  })

  it('returns radius for fillet', () => {
    const params = getEditableParams({
      id: 'f1', name: 'Fillet', type: 'fillet', suppressed: false, radius: 0.5,
    })
    expect(params.radius).toBeDefined()
    expect(params.radius.value).toBe(0.5)
  })

  it('returns distance for chamfer', () => {
    const params = getEditableParams({
      id: 'ch1', name: 'Chamfer', type: 'chamfer', suppressed: false, distance: 1,
    })
    expect(params.distance).toBeDefined()
    expect(params.distance.value).toBe(1)
  })

  it('returns empty object for sketch', () => {
    const params = getEditableParams({
      id: 's1', name: 'Sketch', type: 'sketch', suppressed: false,
      sketch: { plane: SKETCH_PLANES.XY, entities: [], constraints: [] },
    })
    expect(Object.keys(params)).toHaveLength(0)
  })
})

// ─── getFullEditableParams ──────────────────────────────────

describe('getFullEditableParams', () => {
  it('returns number and select params for extrude', () => {
    const params = getFullEditableParams({
      id: 'e1', name: 'Extrude', type: 'extrude', suppressed: false,
      sketchId: 's1', distance: 5, direction: 'normal', operation: 'boss', mode: 'blind',
    })
    expect(params.length).toBe(4)
    const distance = params.find(p => p.key === 'distance')
    expect(distance).toBeDefined()
    expect(distance!.type).toBe('number')

    const direction = params.find(p => p.key === 'direction')
    expect(direction).toBeDefined()
    expect(direction!.type).toBe('select')
    if (direction!.type === 'select') {
      expect(direction!.options).toHaveLength(3)
    }
  })

  it('returns axis and angle params for revolve', () => {
    const params = getFullEditableParams({
      id: 'r1', name: 'Revolve', type: 'revolve', suppressed: false,
      sketchId: 's1', axis: 'Y', angle: 360,
    })
    expect(params.length).toBe(2)
    expect(params.find(p => p.key === 'axis')).toBeDefined()
    expect(params.find(p => p.key === 'angle')).toBeDefined()
  })
})

// ─── createDefaultFeature ───────────────────────────────────

describe('createDefaultFeature', () => {
  it('creates default extrude', () => {
    const f = createDefaultFeature('extrude', 'e1', { sketchId: 'sk1' })
    expect(f.type).toBe('extrude')
    if (f.type === 'extrude') {
      expect(f.sketchId).toBe('sk1')
      expect(f.distance).toBe(5)
      expect(f.direction).toBe('normal')
      expect(f.operation).toBe('boss')
      expect(f.suppressed).toBe(false)
    }
  })

  it('creates default extrude with cut operation', () => {
    const f = createDefaultFeature('extrude', 'e1', { sketchId: 'sk1', operation: 'cut' })
    if (f.type === 'extrude') {
      expect(f.operation).toBe('cut')
    }
  })

  it('creates default revolve', () => {
    const f = createDefaultFeature('revolve', 'r1', { sketchId: 'sk1' })
    expect(f.type).toBe('revolve')
    if (f.type === 'revolve') {
      expect(f.axis).toBe('Y')
      expect(f.angle).toBe(360)
    }
  })

  it('creates default fillet', () => {
    const f = createDefaultFeature('fillet', 'f1')
    expect(f.type).toBe('fillet')
    if (f.type === 'fillet') {
      expect(f.radius).toBe(0.5)
    }
  })

  it('creates default fillet with edge indices', () => {
    const f = createDefaultFeature('fillet', 'f1', { edgeIndices: [0, 2, 5] })
    if (f.type === 'fillet') {
      expect(f.edgeIndices).toEqual([0, 2, 5])
    }
  })

  it('creates default chamfer', () => {
    const f = createDefaultFeature('chamfer', 'ch1')
    expect(f.type).toBe('chamfer')
    if (f.type === 'chamfer') {
      expect(f.distance).toBe(0.5)
    }
  })
})

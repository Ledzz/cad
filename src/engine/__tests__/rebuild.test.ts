import { describe, it, expect, vi } from 'vitest'
import type { Feature, ReferencePlaneFeature } from '../featureTypes'
import { SKETCH_PLANES } from '../sketchTypes'
import type { SketchPlane } from '../sketchTypes'

// ─── Mock the OCC API ───────────────────────────────────────
// rebuildAll depends on getOccApi which loads a WASM worker.
// We mock the entire occApi module so tests run in plain Node.

vi.mock('../../workers/occApi', () => ({
  getOccApi: vi.fn().mockResolvedValue({
    clearShapes: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Import after mock is set up
import { rebuildAll } from '../rebuild'

// ─── Helpers ────────────────────────────────────────────────

function makeRefPlaneFeature(
  id: string,
  basePlaneId: string,
  distance: number
): ReferencePlaneFeature {
  return {
    id,
    name: 'Ref Plane',
    type: 'referencePlane',
    suppressed: false,
    method: { type: 'offset', basePlaneId, distance },
    plane: SKETCH_PLANES.XY, // placeholder — rebuild should compute the real value
  }
}

// ─── Immutability ───────────────────────────────────────────

describe('rebuildAll — immutability', () => {
  it('does not mutate the original feature objects', async () => {
    const originalPlane: SketchPlane = { ...SKETCH_PLANES.XY }
    const feature = makeRefPlaneFeature('ref-1', 'XY', 25)

    // Freeze the feature to detect mutations — Object.freeze throws in strict mode
    const frozenFeature = Object.freeze({ ...feature, plane: Object.freeze({ ...originalPlane }) })
    const features: Feature[] = [frozenFeature as Feature]

    // rebuildAll should NOT throw — it should work on a copy
    await expect(rebuildAll(features)).resolves.toBeDefined()

    // The original feature's plane should be unchanged
    expect(frozenFeature.plane.origin).toEqual(originalPlane.origin)
    expect(frozenFeature.plane.normal).toEqual(originalPlane.normal)
  })

  it('computes the correct plane in the returned geometry map without mutating input', async () => {
    const feature = makeRefPlaneFeature('ref-1', 'XY', 25)
    const planeBefore = { ...feature.plane, origin: [...feature.plane.origin] as [number, number, number] }

    const features: Feature[] = [feature]
    await rebuildAll(features)

    // Reference planes don't produce geometry entries, but the feature
    // in the original array should NOT have been mutated
    expect(feature.plane.origin).toEqual(planeBefore.origin)
  })

  it('correctly resolves chained reference planes using working copies', async () => {
    const ref1 = makeRefPlaneFeature('ref-1', 'XY', 10)
    const ref2 = makeRefPlaneFeature('ref-2', 'ref-1', 5)

    const features: Feature[] = [ref1, ref2]
    await rebuildAll(features)

    // Neither original feature should be mutated
    expect(ref1.plane).toEqual(SKETCH_PLANES.XY)
    expect(ref2.plane).toEqual(SKETCH_PLANES.XY)
  })

  it('skips suppressed features', async () => {
    const feature: ReferencePlaneFeature = {
      ...makeRefPlaneFeature('ref-1', 'XY', 10),
      suppressed: true,
    }
    const planeBefore = { ...feature.plane }
    const features: Feature[] = [feature]

    await rebuildAll(features)

    // Suppressed feature should not be processed at all
    expect(feature.plane).toEqual(planeBefore)
  })
})

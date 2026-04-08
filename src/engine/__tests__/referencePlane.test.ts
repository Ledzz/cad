import { describe, it, expect } from 'vitest'
import { computeReferencePlane } from '../referencePlane'
import { SKETCH_PLANES } from '../sketchTypes'
import type { SketchPlane } from '../sketchTypes'
import type { ReferencePlaneFeature, ReferencePlaneMethod } from '../featureTypes'

// ─── Helpers ────────────────────────────────────────────────

/** Assert two 3-tuples are approximately equal */
function expectVec3Close(
  actual: [number, number, number],
  expected: [number, number, number],
  precision = 6
) {
  expect(actual[0]).toBeCloseTo(expected[0], precision)
  expect(actual[1]).toBeCloseTo(expected[1], precision)
  expect(actual[2]).toBeCloseTo(expected[2], precision)
}

function makeRefPlaneFeature(
  id: string,
  method: ReferencePlaneMethod,
  plane: SketchPlane = SKETCH_PLANES.XY
): ReferencePlaneFeature {
  return {
    id,
    name: 'Ref Plane',
    type: 'referencePlane',
    suppressed: false,
    method,
    plane,
  }
}

// ─── Offset planes ──────────────────────────────────────────

describe('computeReferencePlane — offset', () => {
  it('offsets from XY plane along +Z', () => {
    const method: ReferencePlaneMethod = { type: 'offset', basePlaneId: 'XY', distance: 25 }
    const result = computeReferencePlane(method, [])

    expectVec3Close(result.origin, [0, 0, 25])
    expectVec3Close(result.normal, [0, 0, 1])
    expectVec3Close(result.xDir, [1, 0, 0])
    expectVec3Close(result.yDir, [0, 1, 0])
  })

  it('offsets from XZ plane along +Y', () => {
    const method: ReferencePlaneMethod = { type: 'offset', basePlaneId: 'XZ', distance: 10 }
    const result = computeReferencePlane(method, [])

    expectVec3Close(result.origin, [0, 10, 0])
    expectVec3Close(result.normal, [0, 1, 0])
  })

  it('offsets from YZ plane along +X', () => {
    const method: ReferencePlaneMethod = { type: 'offset', basePlaneId: 'YZ', distance: 5 }
    const result = computeReferencePlane(method, [])

    expectVec3Close(result.origin, [5, 0, 0])
    expectVec3Close(result.normal, [1, 0, 0])
  })

  it('handles negative offset distance', () => {
    const method: ReferencePlaneMethod = { type: 'offset', basePlaneId: 'XY', distance: -15 }
    const result = computeReferencePlane(method, [])

    expectVec3Close(result.origin, [0, 0, -15])
  })

  it('zero offset returns a plane at the same origin', () => {
    const method: ReferencePlaneMethod = { type: 'offset', basePlaneId: 'XY', distance: 0 }
    const result = computeReferencePlane(method, [])

    expectVec3Close(result.origin, [0, 0, 0])
    expectVec3Close(result.normal, [0, 0, 1])
  })
})

// ─── Angled planes ──────────────────────────────────────────

describe('computeReferencePlane — angle', () => {
  it('rotates XY around xDir (axisIndex=0) by 90° → normal tilts from Z to -Y', () => {
    const method: ReferencePlaneMethod = {
      type: 'angle',
      basePlaneId: 'XY',
      angle: 90,
      axisIndex: 0,
    }
    const result = computeReferencePlane(method, [])

    // Rotating normal [0,0,1] around xDir [1,0,0] by 90° → [0,-1,0]
    // (Rodrigues: cos90=0, sin90=1, cross([1,0,0],[0,0,1])=[0,-1,0])
    // Actually: v_rot = v*cos + (k×v)*sin + k*(k·v)*(1-cos)
    // k=[1,0,0], v=[0,0,1]: k×v=[0*1-0*0, 0*0-1*1, 1*0-0*0]=[0,-1,0]
    // v_rot = [0,0,1]*0 + [0,-1,0]*1 + [1,0,0]*0*1 = [0,-1,0]
    expectVec3Close(result.normal, [0, -1, 0])
    // xDir should stay the same (rotating around it)
    expectVec3Close(result.xDir, [1, 0, 0])
  })

  it('rotates XY around yDir (axisIndex=1) by 90° → normal tilts from Z to X', () => {
    const method: ReferencePlaneMethod = {
      type: 'angle',
      basePlaneId: 'XY',
      angle: 90,
      axisIndex: 1,
    }
    const result = computeReferencePlane(method, [])

    // k=[0,1,0], v=[0,0,1]: k×v=[1*1-0*0, 0*0-0*1, 0*0-1*0]=[1,0,0]
    // v_rot = [0,0,1]*0 + [1,0,0]*1 + [0,1,0]*0*1 = [1,0,0]
    expectVec3Close(result.normal, [1, 0, 0])
    // yDir should stay the same (rotating around it)
    expectVec3Close(result.yDir, [0, 1, 0])
  })

  it('45° rotation produces expected intermediate values', () => {
    const method: ReferencePlaneMethod = {
      type: 'angle',
      basePlaneId: 'XY',
      angle: 45,
      axisIndex: 0,
    }
    const result = computeReferencePlane(method, [])

    const cos45 = Math.SQRT1_2
    const sin45 = Math.SQRT1_2
    // normal [0,0,1] rotated around [1,0,0] by 45°:
    // cross([1,0,0],[0,0,1]) = [0,-1,0]
    // v_rot = [0,0,1]*cos45 + [0,-1,0]*sin45 = [0, -sin45, cos45]
    expectVec3Close(result.normal, [0, -sin45, cos45])
  })

  it('0° angle returns the same plane orientation', () => {
    const method: ReferencePlaneMethod = {
      type: 'angle',
      basePlaneId: 'XY',
      angle: 0,
      axisIndex: 0,
    }
    const result = computeReferencePlane(method, [])

    expectVec3Close(result.normal, [0, 0, 1])
    expectVec3Close(result.xDir, [1, 0, 0])
    expectVec3Close(result.yDir, [0, 1, 0])
  })
})

// ─── Chained reference planes ───────────────────────────────

describe('computeReferencePlane — chained reference', () => {
  it('offsets from another reference plane feature', () => {
    // First plane: offset XY by 10 along Z
    const plane1: SketchPlane = {
      name: 'Ref Plane',
      origin: [0, 0, 10],
      normal: [0, 0, 1],
      xDir: [1, 0, 0],
      yDir: [0, 1, 0],
    }
    const refFeature1 = makeRefPlaneFeature(
      'ref-1',
      { type: 'offset', basePlaneId: 'XY', distance: 10 },
      plane1
    )

    // Second plane: offset from ref-1 by 5 along its normal
    const method: ReferencePlaneMethod = {
      type: 'offset',
      basePlaneId: 'ref-1',
      distance: 5,
    }
    const result = computeReferencePlane(method, [refFeature1])

    expectVec3Close(result.origin, [0, 0, 15])
    expectVec3Close(result.normal, [0, 0, 1])
  })

  it('falls back to XY when referenced feature is missing', () => {
    const method: ReferencePlaneMethod = {
      type: 'offset',
      basePlaneId: 'nonexistent-42',
      distance: 7,
    }
    const result = computeReferencePlane(method, [])

    // Should fall back to XY plane, then offset by 7 along Z
    expectVec3Close(result.origin, [0, 0, 7])
    expectVec3Close(result.normal, [0, 0, 1])
  })
})

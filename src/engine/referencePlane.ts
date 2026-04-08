/**
 * Reference plane computation utilities.
 *
 * Computes SketchPlane objects from ReferencePlaneMethod definitions,
 * supporting offset and angle-based planes relative to base planes.
 */

import type { SketchPlane } from './sketchTypes'
import { SKETCH_PLANES } from './sketchTypes'
import type { Feature, ReferencePlaneMethod } from './featureTypes'

/**
 * Resolve a base plane ID to a SketchPlane.
 * Supports predefined planes ('XY', 'XZ', 'YZ') and reference plane feature IDs.
 */
function resolveBasePlane(basePlaneId: string, features: Feature[]): SketchPlane {
  // Check predefined planes first
  if (SKETCH_PLANES[basePlaneId]) {
    return SKETCH_PLANES[basePlaneId]
  }

  // Look for a reference plane feature with this ID
  const refFeature = features.find(
    (f) => f.id === basePlaneId && f.type === 'referencePlane'
  )
  if (refFeature && refFeature.type === 'referencePlane') {
    return refFeature.plane
  }

  // Fallback to XY
  return SKETCH_PLANES.XY
}

/**
 * Compute a SketchPlane from a ReferencePlaneMethod definition.
 */
export function computeReferencePlane(
  method: ReferencePlaneMethod,
  features: Feature[]
): SketchPlane {
  const base = resolveBasePlane(method.basePlaneId, features)

  if (method.type === 'offset') {
    return computeOffsetPlane(base, method.distance)
  } else {
    return computeAngledPlane(base, method.angle, method.axisIndex)
  }
}

/**
 * Create a plane offset from a base plane along its normal.
 */
function computeOffsetPlane(base: SketchPlane, distance: number): SketchPlane {
  const origin: [number, number, number] = [
    base.origin[0] + base.normal[0] * distance,
    base.origin[1] + base.normal[1] * distance,
    base.origin[2] + base.normal[2] * distance,
  ]

  return {
    name: 'Ref Plane',
    origin,
    normal: [...base.normal] as [number, number, number],
    xDir: [...base.xDir] as [number, number, number],
    yDir: [...base.yDir] as [number, number, number],
  }
}

/**
 * Create a plane rotated from a base plane around one of its local axes.
 * axisIndex 0 = rotate around the base plane's xDir (tilts normal toward yDir)
 * axisIndex 1 = rotate around the base plane's yDir (tilts normal toward xDir)
 */
function computeAngledPlane(
  base: SketchPlane,
  angleDeg: number,
  axisIndex: 0 | 1
): SketchPlane {
  const angleRad = (angleDeg * Math.PI) / 180

  // The rotation axis is either xDir or yDir of the base plane
  const axis = axisIndex === 0 ? base.xDir : base.yDir

  // Use Rodrigues' rotation formula to rotate the normal and the other axis
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)

  const rotateVec = (v: [number, number, number]): [number, number, number] => {
    // v_rot = v * cos(a) + (axis x v) * sin(a) + axis * (axis . v) * (1 - cos(a))
    const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]
    const cross: [number, number, number] = [
      axis[1] * v[2] - axis[2] * v[1],
      axis[2] * v[0] - axis[0] * v[2],
      axis[0] * v[1] - axis[1] * v[0],
    ]
    return [
      v[0] * cosA + cross[0] * sinA + axis[0] * dot * (1 - cosA),
      v[1] * cosA + cross[1] * sinA + axis[1] * dot * (1 - cosA),
      v[2] * cosA + cross[2] * sinA + axis[2] * dot * (1 - cosA),
    ]
  }

  const newNormal = rotateVec(base.normal)
  const newXDir = axisIndex === 0
    ? [...base.xDir] as [number, number, number]   // Rotating around xDir — xDir stays the same
    : rotateVec(base.xDir)                          // Rotating around yDir — xDir rotates
  const newYDir = axisIndex === 0
    ? rotateVec(base.yDir)                          // Rotating around xDir — yDir rotates
    : [...base.yDir] as [number, number, number]   // Rotating around yDir — yDir stays the same

  return {
    name: 'Ref Plane',
    origin: [...base.origin] as [number, number, number],
    normal: newNormal,
    xDir: newXDir,
    yDir: newYDir,
  }
}

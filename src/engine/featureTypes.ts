/**
 * Parametric feature types for the feature tree / history system.
 *
 * Every shape in the scene is backed by a Feature that stores its creation
 * parameters. Modifying a feature triggers a rebuild cascade that
 * regenerates all downstream geometry.
 */

import type { SketchPlane, SketchEntity, SketchConstraint } from './sketchTypes'

// ─── Base ───────────────────────────────────────────────────

export interface BaseFeature {
  /** Unique identifier (e.g. "sketch-1", "extrude-3") */
  id: string
  /** Human-readable name shown in the feature tree */
  name: string
  /** Discriminant for the union type */
  type: string
  /** If true, this feature is skipped during rebuild */
  suppressed: boolean
}

// ─── Sketch Feature ─────────────────────────────────────────

/**
 * Serializable snapshot of a sketch.
 * Uses arrays instead of Maps for JSON compatibility.
 */
export interface SketchSnapshot {
  plane: SketchPlane
  entities: SerializedSketchEntity[]
  constraints: SketchConstraint[]
}

/** A sketch entity stored as a plain object (no Map) for serialization. */
export type SerializedSketchEntity = SketchEntity

export interface SketchFeature extends BaseFeature {
  type: 'sketch'
  sketch: SketchSnapshot
}

// ─── Extrude Feature ────────────────────────────────────────

export type ExtrudeDirection = 'normal' | 'reverse' | 'symmetric'

/** 'boss' = add material; 'cut' = remove material from the previous solid */
export type ExtrudeOperation = 'boss' | 'cut'

/** Extrude depth mode: blind (fixed distance), throughAll, or upToFace */
export type ExtrudeMode = 'blind' | 'throughAll' | 'upToFace'

/** Reference to a specific face on a shape (for up-to-face extrude) */
export interface FaceRef {
  shapeId: string
  faceIndex: number
}

export interface ExtrudeFeature extends BaseFeature {
  type: 'extrude'
  /** ID of the SketchFeature this extrude is based on */
  sketchId: string
  /** Extrude distance (always positive; direction is separate). Used for 'blind' mode. */
  distance: number
  /** Which direction to extrude relative to the sketch plane normal */
  direction: ExtrudeDirection
  /** Whether to add or subtract material. Defaults to 'boss'. */
  operation: ExtrudeOperation
  /** Depth mode. Defaults to 'blind' for backward compatibility. */
  mode: ExtrudeMode
  /** Target face for 'upToFace' mode */
  targetFaceRef?: FaceRef
}

// ─── Revolve Feature ────────────────────────────────────────

/** World axis to revolve around */
export type RevolveAxis = 'X' | 'Y' | 'Z'

export interface RevolveFeature extends BaseFeature {
  type: 'revolve'
  /** ID of the SketchFeature this revolve is based on */
  sketchId: string
  /** World axis to revolve around (passes through origin) */
  axis: RevolveAxis
  /** Revolution angle in degrees (1–360). 360 = full solid of revolution. */
  angle: number
}

// ─── Fillet Feature ─────────────────────────────────────────

export interface FilletFeature extends BaseFeature {
  type: 'fillet'
  /** Fillet radius in model units */
  radius: number
  /** If set, apply fillet only to these edge indices. If empty/undefined, apply to all edges. */
  edgeIndices?: number[]
}

// ─── Chamfer Feature ────────────────────────────────────────

export interface ChamferFeature extends BaseFeature {
  type: 'chamfer'
  /** Chamfer distance in model units */
  distance: number
  /** If set, apply chamfer only to these edge indices. If empty/undefined, apply to all edges. */
  edgeIndices?: number[]
}

// ─── Reference Plane Feature ────────────────────────────────

/** How a reference plane is constructed */
export type ReferencePlaneMethod =
  | { type: 'offset'; basePlaneId: string; distance: number }
  | { type: 'angle'; basePlaneId: string; angle: number; axisIndex: 0 | 1 }

export interface ReferencePlaneFeature extends BaseFeature {
  type: 'referencePlane'
  /** Construction method and parameters */
  method: ReferencePlaneMethod
  /** The computed sketch plane (derived from method during rebuild) */
  plane: SketchPlane
}

// ─── Union ──────────────────────────────────────────────────

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | ReferencePlaneFeature

// ─── Helpers ────────────────────────────────────────────────

let featureCounter = 0

/** Generate a unique feature ID with the given prefix. */
export function generateFeatureId(prefix: string): string {
  featureCounter++
  return `${prefix}-${featureCounter}`
}

/** Reset the feature counter (useful for testing). */
export function resetFeatureCounter(): void {
  featureCounter = 0
}

/**
 * Synchronise the feature counter with an existing set of features so that
 * subsequent calls to `generateFeatureId` never collide with IDs already
 * present.  Call this after loading a project file or restoring history.
 */
export function syncFeatureCounter(features: Feature[]): void {
  let max = featureCounter
  for (const f of features) {
    const match = f.id.match(/-(\d+)$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  }
  featureCounter = max
}

/**
 * Create a SketchSnapshot from a live sketch's entity Map.
 */
export function snapshotSketch(
  plane: SketchPlane,
  entities: Map<string, SketchEntity>,
  constraints: SketchConstraint[] = []
): SketchSnapshot {
  return {
    plane,
    entities: Array.from(entities.values()),
    constraints: [...constraints],
  }
}

/**
 * Restore a Map<string, SketchEntity> from a SketchSnapshot.
 */
export function restoreSketchEntities(
  snapshot: SketchSnapshot
): { entities: Map<string, SketchEntity>; constraints: SketchConstraint[] } {
  const map = new Map<string, SketchEntity>()
  for (const entity of snapshot.entities) {
    map.set(entity.id, entity)
  }
  return {
    entities: map,
    constraints: snapshot.constraints ? [...snapshot.constraints] : [],
  }
}

/**
 * Get the display label for a feature type.
 */
export function featureTypeLabel(type: Feature['type']): string {
  switch (type) {
    case 'sketch': return 'Sketch'
    case 'extrude': return 'Extrude'
    case 'revolve': return 'Revolve'
    case 'fillet': return 'Fillet'
    case 'chamfer': return 'Chamfer'
    case 'referencePlane': return 'Ref Plane'
    default: return 'Feature'
  }
}

/** Returns a label that includes the operation for extrude features. */
export function featureDisplayLabel(feature: Feature): string {
  if (feature.type === 'extrude') {
    return feature.operation === 'cut' ? 'Cut Extrude' : 'Extrude'
  }
  return featureTypeLabel(feature.type)
}

/**
 * Get the editable parameter names for a feature type (numeric only).
 * Used by the properties panel to display values.
 */
export function getEditableParams(feature: Feature): Record<string, { label: string; value: number; min?: number; max?: number; step?: number }> {
  switch (feature.type) {
    case 'extrude': {
      const mode = feature.mode ?? 'blind'
      if (mode === 'blind') {
        return {
          distance: { label: 'Distance', value: feature.distance, min: 0.01, step: 0.5 },
        }
      }
      return {}
    }
    case 'revolve':
      return {
        angle: { label: 'Angle (°)', value: feature.angle, min: 1, max: 360, step: 1 },
      }
    case 'fillet':
      return {
        radius: { label: 'Radius', value: feature.radius, min: 0.01, step: 0.1 },
      }
    case 'chamfer':
      return {
        distance: { label: 'Distance', value: feature.distance, min: 0.01, step: 0.1 },
      }
    case 'referencePlane': {
      if (feature.method.type === 'offset') {
        return { distance: { label: 'Offset', value: feature.method.distance, step: 0.5 } }
      }
      return { angle: { label: 'Angle (°)', value: feature.method.angle, min: -360, max: 360, step: 1 } }
    }
    case 'sketch':
      return {}
    default:
      return {}
  }
}

// ─── Typed Parameter Definitions ────────────────────────────

export interface NumberParamDef {
  type: 'number'
  label: string
  key: string
  value: number
  min?: number
  max?: number
}

export interface SelectParamDef {
  type: 'select'
  label: string
  key: string
  value: string
  options: { value: string; label: string }[]
}

export interface ButtonParamDef {
  type: 'button'
  label: string
  key: string
  /** Button text label */
  buttonLabel: string
  /** Status text shown next to the button (e.g. "Face selected" or "No face") */
  statusText?: string
}

export type ParamDef = NumberParamDef | SelectParamDef | ButtonParamDef

/**
 * Get ALL editable parameters for a feature, including selects.
 * Used by the unified FeaturePanel for both creation and editing.
 * @param feature The feature to get params for
 * @param allFeatures Optional full features list (used to populate reference plane options)
 */
export function getFullEditableParams(feature: Feature, allFeatures?: Feature[]): ParamDef[] {
  switch (feature.type) {
    case 'extrude': {
      const mode = feature.mode ?? 'blind'
      const params: ParamDef[] = [
        { type: 'select', key: 'mode', label: 'Mode', value: mode, options: [
          { value: 'blind', label: 'Blind (Distance)' },
          { value: 'throughAll', label: 'Through All' },
          { value: 'upToFace', label: 'Up to Face' },
        ]},
      ]
      if (mode === 'blind') {
        params.push(
          { type: 'number', key: 'distance', label: 'Distance', value: feature.distance, min: 0.01 },
        )
      }
      if (mode === 'upToFace') {
        params.push({
          type: 'button',
          key: 'selectFace',
          label: 'Target Face',
          buttonLabel: feature.targetFaceRef ? 'Change Face' : 'Select Face',
          statusText: feature.targetFaceRef
            ? `Face ${feature.targetFaceRef.faceIndex} on ${feature.targetFaceRef.shapeId}`
            : 'No face selected',
        })
      }
      params.push(
        { type: 'select', key: 'direction', label: 'Direction', value: feature.direction, options: [
          { value: 'normal', label: 'Normal' },
          { value: 'reverse', label: 'Reverse' },
          ...(mode === 'blind' ? [{ value: 'symmetric', label: 'Symmetric' }] : []),
        ]},
        { type: 'select', key: 'operation', label: 'Operation', value: feature.operation, options: [
          { value: 'boss', label: 'Boss (Add)' },
          { value: 'cut', label: 'Cut (Remove)' },
        ]},
      )
      return params
    }
    case 'revolve':
      return [
        { type: 'select', key: 'axis', label: 'Axis', value: feature.axis, options: [
          { value: 'X', label: 'X axis' },
          { value: 'Y', label: 'Y axis' },
          { value: 'Z', label: 'Z axis' },
        ]},
        { type: 'number', key: 'angle', label: 'Angle (°)', value: feature.angle, min: 1, max: 360 },
      ]
    case 'fillet':
      return [
        { type: 'number', key: 'radius', label: 'Radius', value: feature.radius, min: 0.01 },
      ]
    case 'chamfer':
      return [
        { type: 'number', key: 'distance', label: 'Distance', value: feature.distance, min: 0.01 },
      ]
    case 'referencePlane': {
      // Build base plane options: standard planes + existing reference planes
      const basePlaneOptions: { value: string; label: string }[] = [
        { value: 'XY', label: 'XY Plane' },
        { value: 'XZ', label: 'XZ Plane' },
        { value: 'YZ', label: 'YZ Plane' },
      ]
      if (allFeatures) {
        for (const f of allFeatures) {
          if (f.type === 'referencePlane' && !f.suppressed && f.id !== feature.id) {
            basePlaneOptions.push({ value: f.id, label: f.name })
          }
        }
      }

      const params: ParamDef[] = [
        { type: 'select', key: 'methodType', label: 'Method', value: feature.method.type, options: [
          { value: 'offset', label: 'Offset from Plane' },
          { value: 'angle', label: 'Angle from Plane' },
        ]},
        { type: 'select', key: 'basePlaneId', label: 'Base Plane', value: feature.method.basePlaneId, options: basePlaneOptions },
      ]
      if (feature.method.type === 'offset') {
        params.push({ type: 'number', key: 'distance', label: 'Offset Distance', value: feature.method.distance })
      } else {
        params.push(
          { type: 'number', key: 'angle', label: 'Angle (°)', value: feature.method.angle, min: -360, max: 360 },
          { type: 'select', key: 'axisIndex', label: 'Rotation Axis', value: String(feature.method.axisIndex), options: [
            { value: '0', label: 'Around X axis' },
            { value: '1', label: 'Around Y axis' },
          ]},
        )
      }
      return params
    }
    case 'sketch':
      return []
    default:
      return []
  }
}

// ─── Feature type (excluding sketch) for creation ───────────

export type CreatableFeatureType = 'extrude' | 'revolve' | 'fillet' | 'chamfer' | 'referencePlane'

/**
 * Create a feature with default values.
 * Used when opening the feature panel in creation mode.
 */
export function createDefaultFeature(
  type: CreatableFeatureType,
  id: string,
  options?: { sketchId?: string; operation?: ExtrudeOperation; edgeIndices?: number[] }
): Feature {
  switch (type) {
    case 'extrude':
      return {
        id,
        name: 'Extrude',
        type: 'extrude',
        suppressed: false,
        sketchId: options?.sketchId ?? '',
        distance: 5,
        direction: 'normal',
        operation: options?.operation ?? 'boss',
        mode: 'blind',
      }
    case 'revolve':
      return {
        id,
        name: 'Revolve',
        type: 'revolve',
        suppressed: false,
        sketchId: options?.sketchId ?? '',
        axis: 'Y',
        angle: 360,
      }
    case 'fillet':
      return {
        id,
        name: 'Fillet',
        type: 'fillet',
        suppressed: false,
        radius: 0.5,
        edgeIndices: options?.edgeIndices,
      }
    case 'chamfer':
      return {
        id,
        name: 'Chamfer',
        type: 'chamfer',
        suppressed: false,
        distance: 0.5,
        edgeIndices: options?.edgeIndices,
      }
    case 'referencePlane':
      return {
        id,
        name: 'Ref Plane',
        type: 'referencePlane',
        suppressed: false,
        method: { type: 'offset', basePlaneId: 'XY', distance: 10 },
        plane: {
          name: 'Ref Plane',
          origin: [0, 0, 10],
          normal: [0, 0, 1],
          xDir: [1, 0, 0],
          yDir: [0, 1, 0],
        },
      }
  }
}

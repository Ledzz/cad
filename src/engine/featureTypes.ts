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

export interface ExtrudeFeature extends BaseFeature {
  type: 'extrude'
  /** ID of the SketchFeature this extrude is based on */
  sketchId: string
  /** Extrude distance (always positive; direction is separate) */
  distance: number
  /** Which direction to extrude relative to the sketch plane normal */
  direction: ExtrudeDirection
  /** Whether to add or subtract material. Defaults to 'boss'. */
  operation: ExtrudeOperation
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

// ─── Union ──────────────────────────────────────────────────

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature

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
    case 'extrude':
      return {
        distance: { label: 'Distance', value: feature.distance, min: 0.01, step: 0.5 },
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

export type ParamDef = NumberParamDef | SelectParamDef

/**
 * Get ALL editable parameters for a feature, including selects.
 * Used by the unified FeaturePanel for both creation and editing.
 */
export function getFullEditableParams(feature: Feature): ParamDef[] {
  switch (feature.type) {
    case 'extrude':
      return [
        { type: 'number', key: 'distance', label: 'Distance', value: feature.distance, min: 0.01 },
        { type: 'select', key: 'direction', label: 'Direction', value: feature.direction, options: [
          { value: 'normal', label: 'Normal' },
          { value: 'reverse', label: 'Reverse' },
          { value: 'symmetric', label: 'Symmetric' },
        ]},
        { type: 'select', key: 'operation', label: 'Operation', value: feature.operation, options: [
          { value: 'boss', label: 'Boss (Add)' },
          { value: 'cut', label: 'Cut (Remove)' },
        ]},
      ]
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
    case 'sketch':
      return []
    default:
      return []
  }
}

// ─── Feature type (excluding sketch) for creation ───────────

export type CreatableFeatureType = 'extrude' | 'revolve' | 'fillet' | 'chamfer'

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
  }
}

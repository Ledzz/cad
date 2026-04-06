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
  /** Unique identifier (e.g. "box-1", "extrude-3") */
  id: string
  /** Human-readable name shown in the feature tree */
  name: string
  /** Discriminant for the union type */
  type: string
  /** If true, this feature is skipped during rebuild */
  suppressed: boolean
}

// ─── Primitive Features ─────────────────────────────────────

export interface BoxFeature extends BaseFeature {
  type: 'box'
  /** Width along X */
  dx: number
  /** Height along Y */
  dy: number
  /** Depth along Z */
  dz: number
}

export interface CylinderFeature extends BaseFeature {
  type: 'cylinder'
  radius: number
  height: number
}

export interface SphereFeature extends BaseFeature {
  type: 'sphere'
  radius: number
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

export interface ExtrudeFeature extends BaseFeature {
  type: 'extrude'
  /** ID of the SketchFeature this extrude is based on */
  sketchId: string
  /** Extrude distance (always positive; direction is separate) */
  distance: number
  /** Which direction to extrude relative to the sketch plane normal */
  direction: ExtrudeDirection
}

// ─── Union ──────────────────────────────────────────────────

export type Feature =
  | BoxFeature
  | CylinderFeature
  | SphereFeature
  | SketchFeature
  | ExtrudeFeature

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
    case 'box': return 'Box'
    case 'cylinder': return 'Cylinder'
    case 'sphere': return 'Sphere'
    case 'sketch': return 'Sketch'
    case 'extrude': return 'Extrude'
    default: return 'Feature'
  }
}

/**
 * Get the editable parameter names for a feature type.
 * Used by the edit dialog to know which fields to show.
 */
export function getEditableParams(feature: Feature): Record<string, { label: string; value: number; min?: number; step?: number }> {
  switch (feature.type) {
    case 'box':
      return {
        dx: { label: 'Width (X)', value: feature.dx, min: 0.01, step: 0.5 },
        dy: { label: 'Height (Y)', value: feature.dy, min: 0.01, step: 0.5 },
        dz: { label: 'Depth (Z)', value: feature.dz, min: 0.01, step: 0.5 },
      }
    case 'cylinder':
      return {
        radius: { label: 'Radius', value: feature.radius, min: 0.01, step: 0.5 },
        height: { label: 'Height', value: feature.height, min: 0.01, step: 0.5 },
      }
    case 'sphere':
      return {
        radius: { label: 'Radius', value: feature.radius, min: 0.01, step: 0.5 },
      }
    case 'extrude':
      return {
        distance: { label: 'Distance', value: feature.distance, min: 0.01, step: 0.5 },
      }
    case 'sketch':
      return {} // sketches are edited by re-entering sketch mode
    default:
      return {}
  }
}

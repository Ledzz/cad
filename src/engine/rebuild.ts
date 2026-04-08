/**
 * Rebuild engine — replays the feature list in order to regenerate geometry.
 *
 * Each feature type has a corresponding builder function that calls
 * the OCCT worker. The result is a Map<featureId, BufferGeometry> for
 * all features that produce visible geometry.
 */

import * as THREE from 'three'
import type { Feature, SketchFeature, ExtrudeFeature, RevolveFeature, FilletFeature, ChamferFeature } from './featureTypes'
import type { TessellationData } from './tessellation'
import { sketchToEdgeGroups, type OccEdgeDef } from './sketchToSolid'
import type { SketchState } from './sketchTypes'
import { getOccApi } from '../workers/occApi'

// ─── Helpers ────────────────────────────────────────────────

function tessToGeometry(tess: TessellationData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(tess.vertices, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(tess.normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(tess.indices, 1))
  geometry.userData = { faceRanges: tess.faceRanges }
  return geometry
}

/**
 * Convert tessellation data to a BufferGeometry (public for STEP import).
 */
export function importStepAsGeometry(tess: TessellationData): THREE.BufferGeometry {
  return tessToGeometry(tess)
}

/**
 * Reconstruct a minimal SketchState from a SketchFeature's snapshot,
 * just enough for `sketchToEdges()` to work.
 */
function snapshotToSketchState(sketch: SketchFeature): SketchState {
  const entities = new Map(
    sketch.sketch.entities.map((e) => [e.id, e])
  )
  return {
    id: sketch.id,
    plane: sketch.sketch.plane,
    entities,
    constraints: sketch.sketch.constraints ?? [],
    constraintStatus: {
      dof: 0,
      isOverConstrained: false,
      isSolved: true,
      conflictingConstraintIds: [],
    },
    selectedEntityIds: [],
    hoveredEntityId: null,
    activeTool: null,
    activeConstraintTool: null,
    drawingState: { tool: null, placedPointIds: [], previewPosition: null },
    selectionRect: null,
    nextEntityId: 0,
  }
}

// ─── Feature Builders ───────────────────────────────────────

async function buildExtrude(
  feature: ExtrudeFeature,
  features: Feature[],
  activeSolidId?: string
): Promise<THREE.BufferGeometry> {
  // Find the referenced sketch feature
  const sketchFeature = features.find(
    (f) => f.id === feature.sketchId && f.type === 'sketch'
  ) as SketchFeature | undefined

  if (!sketchFeature) {
    throw new Error(
      `Extrude "${feature.id}" references sketch "${feature.sketchId}" which was not found`
    )
  }

  // Convert sketch snapshot to edge definitions (grouped by connected loops)
  const sketchState = snapshotToSketchState(sketchFeature)
  const edgeGroups: OccEdgeDef[][] = sketchToEdgeGroups(sketchState)
  if (edgeGroups.length === 0 || edgeGroups.every((g) => g.length === 0)) {
    throw new Error(`Sketch "${feature.sketchId}" has no edges to extrude`)
  }

  // Determine extrude direction from sketch normal + direction setting
  const normal = sketchFeature.sketch.plane.normal as [number, number, number]
  let direction: [number, number, number]
  let distance = feature.distance

  switch (feature.direction) {
    case 'normal':
      direction = normal
      break
    case 'reverse':
      direction = [
        -normal[0],
        -normal[1],
        -normal[2],
      ]
      break
    case 'symmetric':
      // Symmetric: extrude half in normal, half in reverse — handled by worker
      direction = normal
      distance = feature.distance / 2
      break
    default:
      direction = normal
  }

  const operation = feature.operation ?? 'boss'
  if (operation === 'cut' && !activeSolidId) {
    throw new Error(`Cut extrude "${feature.id}" has no solid to cut from`)
  }

  const api = await getOccApi()

  if (feature.direction === 'symmetric') {
    // Symmetric extrude: extrude half in each direction and fuse
    const tess = await api.extrudeSketchSymmetric(feature.id, edgeGroups, direction, distance)
    return tessToGeometry(tess)
  }

  const tess = await api.extrudeSketch(feature.id, edgeGroups, direction, distance, operation, activeSolidId)
  return tessToGeometry(tess)
}

async function buildRevolve(
  feature: RevolveFeature,
  features: Feature[]
): Promise<THREE.BufferGeometry> {
  const sketchFeature = features.find(
    (f) => f.id === feature.sketchId && f.type === 'sketch'
  ) as SketchFeature | undefined

  if (!sketchFeature) {
    throw new Error(`Revolve "${feature.id}" references sketch "${feature.sketchId}" which was not found`)
  }

  const sketchState = snapshotToSketchState(sketchFeature)
  const edgeGroups: OccEdgeDef[][] = sketchToEdgeGroups(sketchState)
  if (edgeGroups.length === 0 || edgeGroups.every((g) => g.length === 0)) {
    throw new Error(`Sketch "${feature.sketchId}" has no edges to revolve`)
  }

  const axisMap: Record<string, [number, number, number]> = {
    X: [1, 0, 0],
    Y: [0, 1, 0],
    Z: [0, 0, 1],
  }
  const axisDirection = axisMap[feature.axis] ?? [0, 1, 0]

  const api = await getOccApi()
  const tess = await api.revolveSketch(feature.id, edgeGroups, axisDirection, feature.angle)
  return tessToGeometry(tess)
}

async function buildFillet(feature: FilletFeature, activeSolidId: string | undefined): Promise<THREE.BufferGeometry> {
  if (!activeSolidId) throw new Error(`Fillet "${feature.id}" has no solid to fillet`)
  const api = await getOccApi()
  const tess = await api.filletShape(feature.id, activeSolidId, feature.radius, feature.edgeIndices)
  return tessToGeometry(tess)
}

async function buildChamfer(feature: ChamferFeature, activeSolidId: string | undefined): Promise<THREE.BufferGeometry> {
  if (!activeSolidId) throw new Error(`Chamfer "${feature.id}" has no solid to chamfer`)
  const api = await getOccApi()
  const tess = await api.chamferShape(feature.id, activeSolidId, feature.distance, feature.edgeIndices)
  return tessToGeometry(tess)
}

// ─── Main Rebuild ───────────────────────────────────────────

/**
 * Rebuild all features in order. Returns a Map from feature ID to
 * BufferGeometry for features that produce visible geometry.
 *
 * Sketch features don't produce visible geometry in modeling mode
 * (they're only visible while editing), so they're skipped.
 *
 * Suppressed features are skipped entirely.
 */
export async function rebuildAll(
  features: Feature[]
): Promise<Map<string, THREE.BufferGeometry>> {
  const api = await getOccApi()

  // Clear all stored shapes in the worker before rebuilding
  await api.clearShapes()

  const results = new Map<string, THREE.BufferGeometry>()

  // Track the ID of the most recently built solid so cut features know what to subtract from.
  // This is a simplified single-body model; multi-body would need a more sophisticated approach.
  let activeSolidId: string | undefined

  for (const feature of features) {
    if (feature.suppressed) continue

    try {
      let geometry: THREE.BufferGeometry | null = null

      switch (feature.type) {
        case 'sketch':
          // Sketches don't produce visible geometry in modeling mode.
          break
        case 'extrude': {
          const operation = feature.operation ?? 'boss'
          geometry = await buildExtrude(feature, features, operation === 'cut' ? activeSolidId : undefined)

          if (operation === 'cut' && activeSolidId) {
            // The cut result replaces the base solid — hide the base feature's geometry
            results.delete(activeSolidId)
          }

          activeSolidId = feature.id
          break
        }
        case 'revolve':
          geometry = await buildRevolve(feature, features)
          activeSolidId = feature.id
          break
        case 'fillet':
          geometry = await buildFillet(feature, activeSolidId)
          if (activeSolidId) results.delete(activeSolidId)
          activeSolidId = feature.id
          break
        case 'chamfer':
          geometry = await buildChamfer(feature, activeSolidId)
          if (activeSolidId) results.delete(activeSolidId)
          activeSolidId = feature.id
          break
      }

      if (geometry) {
        results.set(feature.id, geometry)
      }
    } catch (err) {
      console.error(`[Rebuild] Failed to build feature "${feature.id}":`, err)
      // Continue with remaining features — don't let one failure
      // break the whole chain. The failed feature just won't render.
    }
  }

  return results
}

/**
 * Rebuild a single feature (for quick parameter edits when we know
 * only one feature changed and it has no dependents after it).
 *
 * Falls back to rebuildAll if the feature has downstream dependencies.
 */
export async function rebuildSingle(
  featureId: string,
  features: Feature[]
): Promise<Map<string, THREE.BufferGeometry> | null> {
  const featureIndex = features.findIndex((f) => f.id === featureId)
  if (featureIndex === -1) return null

  const feature = features[featureIndex]

  // Cut features and features that have cuts downstream always need a full rebuild
  // because they affect which geometry is shown for earlier features.
  const isCut = feature.type === 'extrude' && (feature as ExtrudeFeature).operation === 'cut'
  const hasCutDependents = features.slice(featureIndex + 1).some(
    (f) => f.type === 'extrude' && (f as ExtrudeFeature).operation === 'cut'
  )

  // Check if any later feature depends on this one
  const hasDependents = features.slice(featureIndex + 1).some((f) => {
    if (f.type === 'extrude' && (f as ExtrudeFeature).sketchId === featureId) return true
    if (f.type === 'revolve' && (f as RevolveFeature).sketchId === featureId) return true
    return false
  })

  if (hasDependents || isCut || hasCutDependents) {
    return rebuildAll(features)
  }

  // Otherwise, just rebuild the single feature
  try {
    let geometry: THREE.BufferGeometry | null = null

    switch (feature.type) {
      case 'extrude':
        geometry = await buildExtrude(feature as ExtrudeFeature, features)
        break
      case 'revolve':
        geometry = await buildRevolve(feature as RevolveFeature, features)
        break
      case 'fillet':
        // Fillet modifies the active solid — always fall back to full rebuild
        return rebuildAll(features)
      case 'chamfer':
        return rebuildAll(features)
      case 'sketch':
        break
    }

    if (geometry) {
      return new Map([[feature.id, geometry]])
    }
  } catch (err) {
    console.error(`[Rebuild] Failed to rebuild feature "${featureId}":`, err)
  }

  return null
}

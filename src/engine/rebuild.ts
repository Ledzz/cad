/**
 * Rebuild engine — replays the feature list in order to regenerate geometry.
 *
 * Each feature type has a corresponding builder function that calls
 * the OCCT worker. The result is a Map<featureId, BufferGeometry> for
 * all features that produce visible geometry.
 */

import * as THREE from 'three'
import type { Feature, SketchFeature, ExtrudeFeature } from './featureTypes'
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
    selectedEntityIds: [],
    hoveredEntityId: null,
    activeTool: null,
    drawingState: { tool: null, placedPointIds: [], previewPosition: null },
    nextEntityId: 0,
  }
}

// ─── Feature Builders ───────────────────────────────────────

async function buildBox(
  feature: Feature & { type: 'box' }
): Promise<THREE.BufferGeometry> {
  const api = await getOccApi()
  const tess = await api.makeBox(feature.id, feature.dx, feature.dy, feature.dz)
  return tessToGeometry(tess)
}

async function buildCylinder(
  feature: Feature & { type: 'cylinder' }
): Promise<THREE.BufferGeometry> {
  const api = await getOccApi()
  const tess = await api.makeCylinder(feature.id, feature.radius, feature.height)
  return tessToGeometry(tess)
}

async function buildSphere(
  feature: Feature & { type: 'sphere' }
): Promise<THREE.BufferGeometry> {
  const api = await getOccApi()
  const tess = await api.makeSphere(feature.id, feature.radius)
  return tessToGeometry(tess)
}

async function buildExtrude(
  feature: ExtrudeFeature,
  features: Feature[]
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
      // For symmetric, extrude half distance in each direction
      // For now, just do full distance in normal direction
      // (proper symmetric would need two prisms fused)
      direction = normal
      break
    default:
      direction = normal
  }

  const api = await getOccApi()
  const tess = await api.extrudeSketch(feature.id, edgeGroups, direction, distance)
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

  for (const feature of features) {
    if (feature.suppressed) continue

    try {
      let geometry: THREE.BufferGeometry | null = null

      switch (feature.type) {
        case 'box':
          geometry = await buildBox(feature)
          break
        case 'cylinder':
          geometry = await buildCylinder(feature)
          break
        case 'sphere':
          geometry = await buildSphere(feature)
          break
        case 'sketch':
          // Sketches don't produce visible geometry in modeling mode.
          // They serve as input for extrude/revolve/etc.
          break
        case 'extrude':
          geometry = await buildExtrude(feature, features)
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

  // Check if any later feature depends on this one
  const hasDependents = features.slice(featureIndex + 1).some((f) => {
    if (f.type === 'extrude' && (f as ExtrudeFeature).sketchId === featureId) return true
    return false
  })

  if (hasDependents) {
    // If there are dependents, we need a full rebuild from this point
    return rebuildAll(features)
  }

  // Otherwise, just rebuild the single feature
  try {
    let geometry: THREE.BufferGeometry | null = null

    switch (feature.type) {
      case 'box':
        geometry = await buildBox(feature)
        break
      case 'cylinder':
        geometry = await buildCylinder(feature)
        break
      case 'sphere':
        geometry = await buildSphere(feature)
        break
      case 'extrude':
        geometry = await buildExtrude(feature as ExtrudeFeature, features)
        break
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

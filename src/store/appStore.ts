import { create } from 'zustand'
import type * as THREE from 'three'
import {
  type SketchState,
  type SketchPlane,
  type SketchEntity,
  type SketchTool,
  createEmptySketch,
  generateEntityId,
} from '../engine/sketchTypes'
import type { Feature, SketchFeature } from '../engine/featureTypes'
import { generateFeatureId, restoreSketchEntities, snapshotSketch } from '../engine/featureTypes'
import { rebuildAll } from '../engine/rebuild'

// ─── Selection ──────────────────────────────────────────────

export interface SelectionState {
  selectedIds: string[]
  hoveredId: string | null
}

// ─── App Mode ───────────────────────────────────────────────

export type AppMode = 'modeling' | 'sketching'

// ─── Feature editing state ──────────────────────────────────

export interface EditingFeature {
  featureId: string
}

// ─── History ────────────────────────────────────────────────

const MAX_HISTORY_SIZE = 50

// ─── App State ──────────────────────────────────────────────

export interface AppState {
  // Mode
  mode: AppMode

  // Selection (3D objects)
  selection: SelectionState
  setSelection: (ids: string[]) => void
  setHovered: (id: string | null) => void

  // ─── Undo / Redo ────────────────────────────────────────
  history: Feature[][]
  future: Feature[][]
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: () => boolean
  canRedo: () => boolean

  // ─── Features (parametric source of truth) ──────────────
  features: Feature[]
  /** Add a feature to the end of the list and rebuild. */
  addFeature: (feature: Feature) => Promise<void>
  /** Add multiple features and rebuild once. */
  addFeatures: (features: Feature[]) => Promise<void>
  /** Update a feature's parameters and rebuild. */
  updateFeature: (id: string, updates: Partial<Feature>) => Promise<void>
  /** Remove a feature and rebuild. */
  removeFeature: (id: string) => Promise<void>
  /** Reorder a feature to a new index and rebuild. */
  reorderFeature: (id: string, newIndex: number) => Promise<void>
  /** Toggle a feature's suppressed state and rebuild. */
  toggleSuppression: (id: string) => Promise<void>
  /** Rename a feature (no rebuild needed). */
  renameFeature: (id: string, name: string) => void
  /** Full rebuild from features list. */
  rebuild: () => Promise<void>
  /** Whether a rebuild is currently in progress. */
  isRebuilding: boolean

  // ─── Feature editing ────────────────────────────────────
  editingFeature: EditingFeature | null
  setEditingFeature: (editing: EditingFeature | null) => void

  // Scene objects (tessellated meshes — derived from features via rebuild)
  sceneObjects: Map<string, THREE.BufferGeometry>
  addSceneObject: (id: string, geometry: THREE.BufferGeometry) => void
  removeSceneObject: (id: string) => void
  clearSceneObjects: () => void

  // Sketch
  activeSketch: SketchState | null
  /** The feature ID of the sketch being edited, or null if creating a new sketch */
  editingSketchFeatureId: string | null
  enterSketchMode: (plane: SketchPlane) => void
  /** Enter sketch mode to edit an existing SketchFeature */
  editSketch: (featureId: string) => void
  exitSketchMode: () => void
  /** Finish editing: save new sketch as feature or update existing */
  confirmSketchEdit: () => Promise<void>
  setActiveSketchTool: (tool: SketchTool) => void
  addSketchEntity: (entity: SketchEntity) => SketchEntity
  addSketchEntities: (entities: SketchEntity[]) => SketchEntity[]
  removeSketchEntities: (ids: string[]) => void
  updateSketchEntity: (id: string, updates: Partial<SketchEntity>) => void
  setSketchSelection: (ids: string[]) => void
  setSketchHovered: (id: string | null) => void
  setSketchPreviewPosition: (pos: { x: number; y: number } | null) => void
  addDrawingPoint: (pointId: string) => void
  resetDrawingState: () => void
  /** Generate a unique entity ID and increment the counter */
  generateId: (prefix: string) => string
}

// ─── Sketch ID counter ─────────────────────────────────────

let sketchCounter = 0

// ─── Rebuild helper ─────────────────────────────────────────

async function performRebuild(
  features: Feature[],
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
) {
  set({ isRebuilding: true })
  try {
    const geometries = await rebuildAll(features)
    set({ sceneObjects: geometries, isRebuilding: false })
  } catch (err) {
    console.error('[Store] Rebuild failed:', err)
    set({ isRebuilding: false })
  }
}

// ─── History helper ─────────────────────────────────────────

/**
 * Push the current features onto the history stack and clear the future.
 * Call this before every mutation that changes `features`.
 */
function pushHistory(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void
) {
  const { features, history } = get()
  const newHistory = [...history, features]
  // Cap history size
  if (newHistory.length > MAX_HISTORY_SIZE) {
    newHistory.shift()
  }
  set({ history: newHistory, future: [] })
}

/**
 * Compute the next entity ID from existing sketch entities.
 * Parses numeric suffixes like "point_3" → 3, returns max + 1.
 */
function computeNextEntityId(entities: Map<string, SketchEntity>): number {
  let max = 0
  for (const id of entities.keys()) {
    const match = id.match(/_(\d+)$/)
    if (match) {
      max = Math.max(max, parseInt(match[1], 10))
    }
  }
  return max + 1
}

// ─── Store ──────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  // Mode
  mode: 'modeling' as AppMode,

  // Selection
  selection: {
    selectedIds: [],
    hoveredId: null,
  },
  setSelection: (ids) =>
    set((state) => ({ selection: { ...state.selection, selectedIds: ids } })),
  setHovered: (id) =>
    set((state) => ({ selection: { ...state.selection, hoveredId: id } })),

  // ─── Undo / Redo ───────────────────────────────────────

  history: [],
  future: [],

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  undo: async () => {
    const { history, features } = get()
    if (history.length === 0) return

    const newHistory = [...history]
    const previous = newHistory.pop()!
    set({
      history: newHistory,
      future: [...get().future, features],
      features: previous,
    })
    await performRebuild(previous, set)
  },

  redo: async () => {
    const { future, features } = get()
    if (future.length === 0) return

    const newFuture = [...future]
    const next = newFuture.pop()!
    set({
      future: newFuture,
      history: [...get().history, features],
      features: next,
    })
    await performRebuild(next, set)
  },

  // ─── Features ───────────────────────────────────────────

  features: [],
  isRebuilding: false,

  addFeature: async (feature) => {
    pushHistory(get, set)
    const features = [...get().features, feature]
    set({ features })
    await performRebuild(features, set)
  },

  addFeatures: async (newFeatures) => {
    pushHistory(get, set)
    const features = [...get().features, ...newFeatures]
    set({ features })
    await performRebuild(features, set)
  },

  updateFeature: async (id, updates) => {
    pushHistory(get, set)
    const features = get().features.map((f) =>
      f.id === id ? { ...f, ...updates } as Feature : f
    )
    set({ features })
    await performRebuild(features, set)
  },

  removeFeature: async (id) => {
    pushHistory(get, set)
    const features = get().features.filter((f) => f.id !== id)
    set({ features, selection: { selectedIds: [], hoveredId: null } })
    await performRebuild(features, set)
  },

  reorderFeature: async (id, newIndex) => {
    const features = [...get().features]
    const oldIndex = features.findIndex((f) => f.id === id)
    if (oldIndex === -1 || oldIndex === newIndex) return

    pushHistory(get, set)
    const [feature] = features.splice(oldIndex, 1)
    features.splice(newIndex, 0, feature)
    set({ features })
    await performRebuild(features, set)
  },

  toggleSuppression: async (id) => {
    pushHistory(get, set)
    const features = get().features.map((f) =>
      f.id === id ? { ...f, suppressed: !f.suppressed } : f
    )
    set({ features })
    await performRebuild(features, set)
  },

  renameFeature: (id, name) => {
    pushHistory(get, set)
    const features = get().features.map((f) =>
      f.id === id ? { ...f, name } : f
    )
    set({ features })
  },

  rebuild: async () => {
    await performRebuild(get().features, set)
  },

  // ─── Feature editing ───────────────────────────────────

  editingFeature: null,
  setEditingFeature: (editing) => set({ editingFeature: editing }),

  // Scene objects (still used for rendering — populated by rebuild)
  sceneObjects: new Map(),
  addSceneObject: (id, geometry) =>
    set((state) => {
      const next = new Map(state.sceneObjects)
      next.set(id, geometry)
      return { sceneObjects: next }
    }),
  removeSceneObject: (id) =>
    set((state) => {
      const next = new Map(state.sceneObjects)
      next.delete(id)
      return { sceneObjects: next }
    }),
  clearSceneObjects: () => set({ sceneObjects: new Map() }),

  // ─── Sketch ─────────────────────────────────────────────

  activeSketch: null,
  editingSketchFeatureId: null,

  enterSketchMode: (plane) => {
    sketchCounter++
    const sketch = createEmptySketch(`sketch-${sketchCounter}`, plane)
    set({
      mode: 'sketching',
      activeSketch: sketch,
      editingSketchFeatureId: null,
      selection: { selectedIds: [], hoveredId: null },
    })
  },

  editSketch: (featureId) => {
    const feature = get().features.find((f) => f.id === featureId)
    if (!feature || feature.type !== 'sketch') return

    const sketchFeature = feature as SketchFeature
    const entities = restoreSketchEntities(sketchFeature.sketch)
    const nextEntityId = computeNextEntityId(entities)

    const sketch: SketchState = {
      id: sketchFeature.id,
      plane: sketchFeature.sketch.plane,
      entities,
      selectedEntityIds: [],
      hoveredEntityId: null,
      activeTool: null,
      drawingState: {
        tool: null,
        placedPointIds: [],
        previewPosition: null,
      },
      nextEntityId,
    }

    set({
      mode: 'sketching',
      activeSketch: sketch,
      editingSketchFeatureId: featureId,
      selection: { selectedIds: [], hoveredId: null },
    })
  },

  exitSketchMode: () => {
    set({
      mode: 'modeling',
      activeSketch: null,
      editingSketchFeatureId: null,
    })
  },

  confirmSketchEdit: async () => {
    const { activeSketch, editingSketchFeatureId } = get()
    if (!activeSketch) return

    if (editingSketchFeatureId) {
      // Updating an existing sketch feature
      const snapshot = snapshotSketch(activeSketch.plane, activeSketch.entities)
      // Use updateFeature which pushes history and rebuilds
      set({
        mode: 'modeling',
        activeSketch: null,
        editingSketchFeatureId: null,
      })
      await get().updateFeature(editingSketchFeatureId, { sketch: snapshot } as Partial<Feature>)
    } else {
      // Saving a new sketch as a feature (no extrude)
      const sketchId = generateFeatureId('sketch')
      const sketchFeature: SketchFeature = {
        id: sketchId,
        name: `Sketch (${activeSketch.plane.name})`,
        type: 'sketch',
        suppressed: false,
        sketch: snapshotSketch(activeSketch.plane, activeSketch.entities),
      }
      set({
        mode: 'modeling',
        activeSketch: null,
        editingSketchFeatureId: null,
      })
      await get().addFeature(sketchFeature)
    }
  },

  setActiveSketchTool: (tool) => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        activeTool: tool,
        drawingState: {
          tool,
          placedPointIds: [],
          previewPosition: null,
        },
        // Deselect when switching tools
        selectedEntityIds: [],
      },
    })
  },

  addSketchEntity: (entity) => {
    const sketch = get().activeSketch
    if (!sketch) return entity
    const newEntities = new Map(sketch.entities)
    newEntities.set(entity.id, entity)
    set({
      activeSketch: {
        ...sketch,
        entities: newEntities,
        nextEntityId: sketch.nextEntityId + 1,
      },
    })
    return entity
  },

  addSketchEntities: (entities) => {
    const sketch = get().activeSketch
    if (!sketch) return entities
    const newEntities = new Map(sketch.entities)
    for (const entity of entities) {
      newEntities.set(entity.id, entity)
    }
    set({
      activeSketch: {
        ...sketch,
        entities: newEntities,
        nextEntityId: sketch.nextEntityId + entities.length,
      },
    })
    return entities
  },

  removeSketchEntities: (ids) => {
    const sketch = get().activeSketch
    if (!sketch) return
    const idsSet = new Set(ids)
    const newEntities = new Map(sketch.entities)

    // Also remove any lines/arcs/circles that reference removed points
    const pointIds = new Set(
      ids.filter((id) => sketch.entities.get(id)?.type === 'point')
    )

    for (const [entityId, entity] of newEntities) {
      if (idsSet.has(entityId)) {
        newEntities.delete(entityId)
        continue
      }
      // Remove dependent entities that reference deleted points
      if (pointIds.size > 0) {
        if (entity.type === 'line' && (pointIds.has(entity.startPointId) || pointIds.has(entity.endPointId))) {
          newEntities.delete(entityId)
        } else if (entity.type === 'circle' && pointIds.has(entity.centerPointId)) {
          newEntities.delete(entityId)
        } else if (entity.type === 'arc' && (pointIds.has(entity.centerPointId) || pointIds.has(entity.startPointId) || pointIds.has(entity.endPointId))) {
          newEntities.delete(entityId)
        }
      }
    }

    set({
      activeSketch: {
        ...sketch,
        entities: newEntities,
        selectedEntityIds: sketch.selectedEntityIds.filter((id) => !idsSet.has(id)),
      },
    })
  },

  updateSketchEntity: (id, updates) => {
    const sketch = get().activeSketch
    if (!sketch) return
    const entity = sketch.entities.get(id)
    if (!entity) return
    const newEntities = new Map(sketch.entities)
    newEntities.set(id, { ...entity, ...updates } as SketchEntity)
    set({
      activeSketch: {
        ...sketch,
        entities: newEntities,
      },
    })
  },

  setSketchSelection: (ids) => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        selectedEntityIds: ids,
      },
    })
  },

  setSketchHovered: (id) => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        hoveredEntityId: id,
      },
    })
  },

  setSketchPreviewPosition: (pos) => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        drawingState: {
          ...sketch.drawingState,
          previewPosition: pos,
        },
      },
    })
  },

  addDrawingPoint: (pointId) => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        drawingState: {
          ...sketch.drawingState,
          placedPointIds: [...sketch.drawingState.placedPointIds, pointId],
        },
      },
    })
  },

  resetDrawingState: () => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        drawingState: {
          tool: sketch.activeTool,
          placedPointIds: [],
          previewPosition: null,
        },
      },
    })
  },

  generateId: (prefix) => {
    const sketch = get().activeSketch
    if (!sketch) return `${prefix}_0`
    const id = generateEntityId(sketch, prefix)
    // Increment counter
    set({
      activeSketch: {
        ...sketch,
        nextEntityId: sketch.nextEntityId + 1,
      },
    })
    return id
  },
}))

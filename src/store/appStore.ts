import { create } from 'zustand'
import type * as THREE from 'three'
import {
  type SketchState,
  type SketchPlane,
  type SketchEntity,
  type SketchTool,
  type SketchConstraint,
  type ConstraintTool,
  type SelectionRect,
  createEmptySketch,
  generateEntityId,
} from '../engine/sketchTypes'
import type { Feature, SketchFeature } from '../engine/featureTypes'
import { generateFeatureId, restoreSketchEntities, snapshotSketch, type CreatableFeatureType, createDefaultFeature } from '../engine/featureTypes'
import { rebuildAll } from '../engine/rebuild'
import { solveConstraints, getConstraintReferencedIds } from '../engine/constraintSolver'

// ─── Selection ──────────────────────────────────────────────

export interface SelectionState {
  selectedIds: string[]
  hoveredId: string | null
}

// ─── App Mode ───────────────────────────────────────────────

export type AppMode = 'modeling' | 'sketching'

// ─── Face Selection ─────────────────────────────────────────

export interface HoveredFace {
  featureId: string
  faceIndex: number
}

// ─── Edge Selection ─────────────────────────────────────────

export interface EdgeSelectionState {
  /** Whether edge selection mode is active */
  active: boolean
  /** The operation type being configured */
  operation: 'fillet' | 'chamfer'
  /** The shape ID edges are from */
  shapeId: string
  /** Extracted edge polylines from the shape */
  edges: number[][]
  /** Indices of selected edges */
  selectedEdgeIndices: number[]
  /** Currently hovered edge index */
  hoveredEdgeIndex: number | null
}

// ─── Feature panel state (unified create + edit) ────────────

export interface FeaturePanelState {
  /** Whether we're creating a new feature or editing an existing one */
  mode: 'create' | 'edit'
  /** The feature being created/edited (live-updated for preview) */
  feature: Feature
  /** Snapshot of the features list before the panel opened (for cancel/revert) */
  snapshotFeatures: Feature[]
  /** If creating extrude/revolve, the sketch feature ID that was also created (removed on cancel) */
  createdSketchId?: string
}

// ─── Input dialog state (for constraint value input) ────────

export interface NumberInputDialogState {
  type: 'number'
  label: string
  defaultValue: number
  resolve: (value: number | null) => void
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

  // Face selection mode (for "sketch on face")
  selectingSketchFace: boolean
  hoveredFace: HoveredFace | null
  startFaceSelection: () => void
  cancelFaceSelection: () => void
  setHoveredFace: (face: HoveredFace | null) => void
  /** Called when user clicks a face during face selection mode */
  selectFaceForSketch: (featureId: string, faceIndex: number) => Promise<void>

  // ─── Edge Selection Mode ────────────────────────────────
  edgeSelection: EdgeSelectionState | null
  startEdgeSelection: (operation: 'fillet' | 'chamfer') => Promise<void>
  cancelEdgeSelection: () => void
  toggleEdgeSelection: (edgeIndex: number) => void
  setHoveredEdge: (edgeIndex: number | null) => void
  confirmEdgeSelection: (value: number) => Promise<void>

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
  /** Replace all features with the given list and rebuild (used for load). */
  loadProject: (features: Feature[]) => Promise<void>
  /** Set the features list directly without pushing history or rebuilding. */
  _setFeaturesRaw: (features: Feature[]) => void

  // ─── Feature panel (unified create + edit) ──────────────
  featurePanel: FeaturePanelState | null
  /** Open the panel in create mode — adds feature to list immediately for live preview */
  openFeaturePanelCreate: (feature: Feature, createdSketchId?: string) => Promise<void>
  /** Open the panel in edit mode — snapshots current state for cancel/revert */
  openFeaturePanelEdit: (featureId: string) => void
  /** Update a param on the panel's feature and trigger a live rebuild */
  updateFeaturePanelParam: (key: string, value: string | number) => Promise<void>
  /** Commit (accept) the panel: push undo history and close */
  commitFeaturePanel: () => void
  /** Cancel the panel: revert to snapshot and close */
  cancelFeaturePanel: () => Promise<void>

  // ─── Constraint value input (small dialog) ─────────────
  inputDialog: NumberInputDialogState | null
  openNumberInput: (label: string, defaultValue: number) => Promise<number | null>
  closeInputDialog: () => void

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
  /** Set or clear the drag-to-select rectangle */
  setSelectionRect: (rect: SelectionRect | null) => void
  /** Generate a unique entity ID and increment the counter */
  generateId: (prefix: string) => string

  // ─── Constraints ────────────────────────────────────────
  addConstraint: (constraint: SketchConstraint) => void
  removeConstraints: (ids: string[]) => void
  updateConstraintValue: (id: string, value: number) => void
  setActiveConstraintTool: (tool: ConstraintTool) => void
  /** Run the constraint solver and update point positions */
  runSolver: (draggedPointId?: string, dragPosition?: { x: number; y: number }) => void
  /** Drag a sketch point (used during interactive drag) */
  dragSketchPoint: (pointId: string, position: { x: number; y: number }) => void
}

// ─── Sketch ID counter ─────────────────────────────────────

let sketchCounter = 0

// ─── Rebuild helper ─────────────────────────────────────────

/** Generate an auto-name for a feature based on its params */
function generateFeatureName(feature: Feature): string {
  switch (feature.type) {
    case 'extrude': {
      const label = feature.operation === 'cut' ? 'Cut' : 'Extrude'
      return `${label} (${feature.distance}mm)`
    }
    case 'revolve':
      return `Revolve ${feature.angle}° (${feature.axis})`
    case 'fillet':
      return `Fillet (r${feature.radius})`
    case 'chamfer':
      return `Chamfer (d${feature.distance})`
    default:
      return feature.name
  }
}
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

  // ─── Face Selection Mode ───────────────────────────────

  selectingSketchFace: false,
  hoveredFace: null,

  startFaceSelection: () => {
    set({
      selectingSketchFace: true,
      hoveredFace: null,
      selection: { selectedIds: [], hoveredId: null },
    })
  },

  cancelFaceSelection: () => {
    set({
      selectingSketchFace: false,
      hoveredFace: null,
    })
  },

  setHoveredFace: (face) => {
    set({ hoveredFace: face })
  },

  selectFaceForSketch: async (featureId, faceIndex) => {
    const { getOccApi } = await import('../workers/occApi')
    try {
      const api = await getOccApi()

      // Look up the actual shape ID in the registry.
      // For multi-loop extrudes, sub-shapes are stored as "<id>__loop_N".
      // We need to find the right shape that contains this face.
      // Try the featureId directly first, then look for sub-shapes.
      let shapeId = featureId
      const result = await api.getFacePlane(shapeId, faceIndex)

      if (!result) {
        console.warn('[Store] Selected face is not planar — only planar faces can be used as sketch planes')
        set({ selectingSketchFace: false, hoveredFace: null })
        return
      }

      // Exit face selection mode and enter sketch mode with the face plane
      set({ selectingSketchFace: false, hoveredFace: null })
      get().enterSketchMode({
        name: 'Face',
        origin: result.origin,
        normal: result.normal,
        xDir: result.xDir,
        yDir: result.yDir,
      })
    } catch (err) {
      console.error('[Store] Failed to get face plane:', err)
      set({ selectingSketchFace: false, hoveredFace: null })
    }
  },

  // ─── Edge Selection Mode ────────────────────────────────

  edgeSelection: null,

  startEdgeSelection: async (operation) => {
    // Find the last feature that produced a solid
    const { features, sceneObjects } = get()
    const solidFeatures = features.filter(
      (f) => !f.suppressed && f.type !== 'sketch'
    )
    const lastSolid = solidFeatures[solidFeatures.length - 1]
    if (!lastSolid) return

    const shapeId = lastSolid.id
    if (!sceneObjects.has(shapeId)) return

    try {
      const { getOccApi } = await import('../workers/occApi')
      const api = await getOccApi()
      const { edges } = await api.getShapeEdges(shapeId)

      set({
        edgeSelection: {
          active: true,
          operation,
          shapeId,
          edges,
          selectedEdgeIndices: [],
          hoveredEdgeIndex: null,
        },
        selection: { selectedIds: [], hoveredId: null },
      })
    } catch (err) {
      console.error('[Store] Failed to get shape edges:', err)
    }
  },

  cancelEdgeSelection: () => {
    set({ edgeSelection: null })
  },

  toggleEdgeSelection: (edgeIndex) => {
    const es = get().edgeSelection
    if (!es) return
    const selected = es.selectedEdgeIndices.includes(edgeIndex)
      ? es.selectedEdgeIndices.filter((i) => i !== edgeIndex)
      : [...es.selectedEdgeIndices, edgeIndex]
    set({
      edgeSelection: { ...es, selectedEdgeIndices: selected },
    })
  },

  setHoveredEdge: (edgeIndex) => {
    const es = get().edgeSelection
    if (!es) return
    set({
      edgeSelection: { ...es, hoveredEdgeIndex: edgeIndex },
    })
  },

  confirmEdgeSelection: async (value) => {
    const es = get().edgeSelection
    if (!es || es.selectedEdgeIndices.length === 0) return

    const id = generateFeatureId(es.operation)
    const edgeIndices = [...es.selectedEdgeIndices]

    set({ edgeSelection: null })

    if (es.operation === 'fillet') {
      const feature: Feature = {
        id,
        name: `Fillet (r${value})`,
        type: 'fillet',
        suppressed: false,
        radius: value,
        edgeIndices,
      }
      await get().addFeature(feature)
    } else {
      const feature: Feature = {
        id,
        name: `Chamfer (d${value})`,
        type: 'chamfer',
        suppressed: false,
        distance: value,
        edgeIndices,
      }
      await get().addFeature(feature)
    }
  },

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

  loadProject: async (features) => {
    // Exit sketch mode if active, clear history, replace features
    set({
      mode: 'modeling',
      activeSketch: null,
      editingSketchFeatureId: null,
      history: [],
      future: [],
      features,
      selection: { selectedIds: [], hoveredId: null },
    })
    await performRebuild(features, set)
  },

  _setFeaturesRaw: (features) => {
    set({ features })
  },

  // ─── Feature panel (unified create + edit) ──────────────

  featurePanel: null,

  openFeaturePanelCreate: async (feature, createdSketchId) => {
    const snapshotFeatures = [...get().features]
    // Add the new feature to the list immediately for live preview
    const features = [...snapshotFeatures, feature]
    set({
      featurePanel: { mode: 'create', feature, snapshotFeatures, createdSketchId },
      features,
    })
    await performRebuild(features, set)
  },

  openFeaturePanelEdit: (featureId) => {
    const feature = get().features.find((f) => f.id === featureId)
    if (!feature || feature.type === 'sketch') return
    set({
      featurePanel: {
        mode: 'edit',
        feature: { ...feature },
        snapshotFeatures: [...get().features],
      },
    })
  },

  updateFeaturePanelParam: async (key, value) => {
    const panel = get().featurePanel
    if (!panel) return

    const updatedFeature = { ...panel.feature, [key]: value } as Feature
    // Update the feature in the features list and rebuild
    const features = get().features.map((f) =>
      f.id === updatedFeature.id ? updatedFeature : f
    )
    set({
      featurePanel: { ...panel, feature: updatedFeature },
      features,
    })
    await performRebuild(features, set)
  },

  commitFeaturePanel: () => {
    const panel = get().featurePanel
    if (!panel) return
    // Push the snapshot as undo history (so undo reverts to before the panel opened)
    const { history } = get()
    const newHistory = [...history, panel.snapshotFeatures]
    if (newHistory.length > MAX_HISTORY_SIZE) newHistory.shift()
    // Update the feature name to reflect current param values
    const features = get().features.map((f) => {
      if (f.id !== panel.feature.id) return f
      return { ...panel.feature, name: generateFeatureName(panel.feature) }
    })
    set({
      featurePanel: null,
      features,
      history: newHistory,
      future: [],
    })
  },

  cancelFeaturePanel: async () => {
    const panel = get().featurePanel
    if (!panel) return
    // Revert to the snapshot
    set({
      featurePanel: null,
      features: panel.snapshotFeatures,
    })
    await performRebuild(panel.snapshotFeatures, set)
  },

  // ─── Constraint value input ────────────────────────────
  inputDialog: null,
  openNumberInput: (label, defaultValue) => {
    return new Promise<number | null>((resolve) => {
      set({
        inputDialog: {
          type: 'number',
          label,
          defaultValue,
          resolve,
        },
      })
    })
  },
  closeInputDialog: () => set({ inputDialog: null }),

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
    const { entities, constraints } = restoreSketchEntities(sketchFeature.sketch)
    const nextEntityId = computeNextEntityId(entities)

    const sketch: SketchState = {
      id: sketchFeature.id,
      plane: sketchFeature.sketch.plane,
      entities,
      constraints,
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
      drawingState: {
        tool: null,
        placedPointIds: [],
        previewPosition: null,
      },
      selectionRect: null,
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
      const snapshot = snapshotSketch(activeSketch.plane, activeSketch.entities, activeSketch.constraints)
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
        sketch: snapshotSketch(activeSketch.plane, activeSketch.entities, activeSketch.constraints),
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
        activeConstraintTool: null,
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

    // Also remove constraints that reference deleted entities
    const deletedEntityIds = new Set<string>()
    for (const id of idsSet) deletedEntityIds.add(id)
    // Add cascade-deleted entity IDs
    for (const id of sketch.entities.keys()) {
      if (!newEntities.has(id)) deletedEntityIds.add(id)
    }

    const newConstraints = sketch.constraints.filter((c) => {
      const refs = getConstraintReferencedIds(c, newEntities)
      return refs.every((refId) => !deletedEntityIds.has(refId))
    })

    set({
      activeSketch: {
        ...sketch,
        entities: newEntities,
        constraints: newConstraints,
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

  setSelectionRect: (rect) => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        selectionRect: rect,
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

  // ─── Constraints ─────────────────────────────────────────

  addConstraint: (constraint) => {
    const sketch = get().activeSketch
    if (!sketch) return
    const newConstraints = [...sketch.constraints, constraint]
    set({
      activeSketch: {
        ...sketch,
        constraints: newConstraints,
      },
    })
    // Run solver after adding constraint
    get().runSolver()
  },

  removeConstraints: (ids) => {
    const sketch = get().activeSketch
    if (!sketch) return
    const idsSet = new Set(ids)
    const newConstraints = sketch.constraints.filter((c) => !idsSet.has(c.id))
    set({
      activeSketch: {
        ...sketch,
        constraints: newConstraints,
      },
    })
    // Run solver after removing constraint
    get().runSolver()
  },

  updateConstraintValue: (id, value) => {
    const sketch = get().activeSketch
    if (!sketch) return
    const newConstraints = sketch.constraints.map((c) =>
      c.id === id ? { ...c, value } as SketchConstraint : c
    )
    set({
      activeSketch: {
        ...sketch,
        constraints: newConstraints,
      },
    })
    // Run solver after updating value
    get().runSolver()
  },

  setActiveConstraintTool: (tool) => {
    const sketch = get().activeSketch
    if (!sketch) return
    set({
      activeSketch: {
        ...sketch,
        activeConstraintTool: tool,
        // Clear drawing tool when switching to constraint mode
        activeTool: tool ? null : sketch.activeTool,
        drawingState: tool ? {
          tool: null,
          placedPointIds: [],
          previewPosition: null,
        } : sketch.drawingState,
      },
    })
  },

  runSolver: (draggedPointId, dragPosition) => {
    const sketch = get().activeSketch
    if (!sketch || sketch.constraints.length === 0) return

    const result = solveConstraints(
      sketch.entities,
      sketch.constraints,
      draggedPointId,
      dragPosition
    )

    // Apply point updates
    if (result.pointUpdates.size > 0) {
      const newEntities = new Map(sketch.entities)
      for (const [pointId, pos] of result.pointUpdates) {
        const pt = newEntities.get(pointId)
        if (pt && pt.type === 'point') {
          newEntities.set(pointId, { ...pt, x: pos.x, y: pos.y })
        }
      }
      set({
        activeSketch: {
          ...get().activeSketch!,
          entities: newEntities,
          constraintStatus: result.status,
        },
      })
    } else {
      set({
        activeSketch: {
          ...get().activeSketch!,
          constraintStatus: result.status,
        },
      })
    }
  },

  dragSketchPoint: (pointId, position) => {
    const sketch = get().activeSketch
    if (!sketch) return

    // Update the point position
    const newEntities = new Map(sketch.entities)
    const pt = newEntities.get(pointId)
    if (!pt || pt.type !== 'point') return
    newEntities.set(pointId, { ...pt, x: position.x, y: position.y })

    set({
      activeSketch: {
        ...sketch,
        entities: newEntities,
      },
    })

    // Run solver with this point as the dragged/fixed point
    if (sketch.constraints.length > 0) {
      get().runSolver(pointId, position)
    }
  },
}))

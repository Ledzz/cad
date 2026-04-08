import { useState, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { SKETCH_PLANES } from '../engine/sketchTypes'
import type { SketchConstraint } from '../engine/sketchTypes'
import {
  generateFeatureId,
  snapshotSketch,
  createDefaultFeature,
  type SketchFeature,
} from '../engine/featureTypes'
import {
  getApplicableConstraints,
  createConstraintFromSelection,
} from '../engine/constraintSolver'
import { saveProject, loadProjectFile } from '../engine/projectFile'
import { getOccApi } from '../workers/occApi'

const buttonBase =
  'px-2 py-1 text-xs rounded transition-colors cursor-pointer select-none'
const buttonIdle =
  `${buttonBase} text-gray-400 hover:text-gray-200 hover:bg-[#2a2a4a]`
const buttonActive =
  `${buttonBase} text-white bg-blue-600 hover:bg-blue-500`
const buttonDisabled =
  `${buttonBase} text-gray-600 cursor-not-allowed`

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function Toolbar() {
  const mode = useAppStore((s) => s.mode)
  const activeSketch = useAppStore((s) => s.activeSketch)
  const editingSketchFeatureId = useAppStore((s) => s.editingSketchFeatureId)
  const enterSketchMode = useAppStore((s) => s.enterSketchMode)
  const exitSketchMode = useAppStore((s) => s.exitSketchMode)
  const confirmSketchEdit = useAppStore((s) => s.confirmSketchEdit)
  const setActiveSketchTool = useAppStore((s) => s.setActiveSketchTool)
  const addConstraint = useAppStore((s) => s.addConstraint)
  const isRebuilding = useAppStore((s) => s.isRebuilding)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const canUndo = useAppStore((s) => s.canUndo)
  const canRedo = useAppStore((s) => s.canRedo)
  const generateId = useAppStore((s) => s.generateId)
  const selectingSketchFace = useAppStore((s) => s.selectingSketchFace)
  const startFaceSelection = useAppStore((s) => s.startFaceSelection)
  const cancelFaceSelection = useAppStore((s) => s.cancelFaceSelection)
  const sceneObjects = useAppStore((s) => s.sceneObjects)
  const features = useAppStore((s) => s.features)
  const loadProject = useAppStore((s) => s.loadProject)
  const edgeSelection = useAppStore((s) => s.edgeSelection)
  const startEdgeSelection = useAppStore((s) => s.startEdgeSelection)
  const cancelEdgeSelection = useAppStore((s) => s.cancelEdgeSelection)
  const openNumberInput = useAppStore((s) => s.openNumberInput)
  const openFeaturePanelCreate = useAppStore((s) => s.openFeaturePanelCreate)
  const featurePanel = useAppStore((s) => s.featurePanel)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stepInputRef = useRef<HTMLInputElement>(null)

  const activeTool = activeSketch?.activeTool ?? null
  const isEditingExisting = editingSketchFeatureId !== null
  const selectedIds = activeSketch?.selectedEntityIds ?? []
  const entities = activeSketch?.entities ?? new Map()

  // Determine which constraints can be applied to the current selection
  const applicable = selectedIds.length > 0
    ? getApplicableConstraints(selectedIds, entities)
    : []

  const handleApplyConstraint = async (constraintType: SketchConstraint['type']) => {
    if (!activeSketch) return

    // For dimensional constraints, ask for value via input dialog
    const needsValue = ['distance', 'horizontalDistance', 'verticalDistance', 'angle', 'radius'].includes(constraintType)
    let value: number | undefined

    if (needsValue) {
      // Create with measured value first, then let user edit
      const constraint = createConstraintFromSelection(
        constraintType,
        generateId('cst'),
        selectedIds,
        entities
      )
      if (constraint && 'value' in constraint) {
        const label = constraintType === 'angle' ? 'Angle (degrees)' : 'Value'
        const defaultVal = Math.round((constraint as any).value * 1000) / 1000
        const result = await openNumberInput(label, defaultVal)
        if (result === null) return
        value = result
      }
    }

    const constraint = createConstraintFromSelection(
      constraintType,
      generateId('cst'),
      selectedIds,
      entities,
      value
    )

    if (constraint) {
      addConstraint(constraint)
    }
  }

  /** Save the current sketch and open the feature panel to create an extrude or revolve */
  const handleFinishAndCreateFeature = async (featureType: 'extrude' | 'revolve', operation?: 'boss' | 'cut') => {
    if (!activeSketch) return

    // Count non-point, non-construction entities
    const hasProfile = Array.from(activeSketch.entities.values()).some(
      (e) => e.type !== 'point' && !e.construction
    )

    if (!hasProfile) {
      exitSketchMode()
      return
    }

    if (isEditingExisting) {
      // Updating existing sketch — just save edits and open panel for any downstream feature
      const snapshot = snapshotSketch(activeSketch.plane, activeSketch.entities, activeSketch.constraints)
      const { updateFeature } = useAppStore.getState()
      await updateFeature(editingSketchFeatureId, { sketch: snapshot } as Partial<SketchFeature>)
      exitSketchMode()
      return
    }

    // Create a SketchFeature (snapshot of current sketch)
    const sketchId = generateFeatureId('sketch')
    const sketchFeature: SketchFeature = {
      id: sketchId,
      name: `Sketch (${activeSketch.plane.name})`,
      type: 'sketch',
      suppressed: false,
      sketch: snapshotSketch(activeSketch.plane, activeSketch.entities, activeSketch.constraints),
    }

    // Create a default feature with the sketch reference
    const featureId = generateFeatureId(featureType)
    const feature = createDefaultFeature(featureType, featureId, { sketchId, operation })

    // First add the sketch feature to the store directly (not through the panel)
    const store = useAppStore.getState()
    const featuresWithSketch = [...store.features, sketchFeature]
    store._setFeaturesRaw(featuresWithSketch)

    // Exit sketch mode, then open the feature panel in create mode
    exitSketchMode()
    await openFeaturePanelCreate(feature, sketchId)
  }

  const handleFinishSketch = async () => {
    if (isEditingExisting) {
      // Update the existing sketch feature
      await confirmSketchEdit()
    } else {
      // Save as a new sketch feature
      if (!activeSketch) return
      const hasEntities = activeSketch.entities.size > 0
      if (hasEntities) {
        await confirmSketchEdit()
      } else {
        exitSketchMode()
      }
    }
  }

  const handleFillet = async () => {
    if (sceneObjects.size === 0) { alert('No solid to fillet.'); return }
    if (edgeSelection?.active) { cancelEdgeSelection(); return }
    await startEdgeSelection('fillet')
  }

  const handleChamfer = async () => {
    if (sceneObjects.size === 0) { alert('No solid to chamfer.'); return }
    if (edgeSelection?.active) { cancelEdgeSelection(); return }
    await startEdgeSelection('chamfer')
  }

  const handleConfirmEdges = async () => {
    if (!edgeSelection) return
    const edgeIndices = [...edgeSelection.selectedEdgeIndices]
    const operation = edgeSelection.operation
    cancelEdgeSelection()
    const id = generateFeatureId(operation)
    const feature = createDefaultFeature(operation, id, { edgeIndices })
    await openFeaturePanelCreate(feature)
  }

  const handleApplyAllEdges = async (operation: 'fillet' | 'chamfer') => {
    cancelEdgeSelection()
    const id = generateFeatureId(operation)
    const feature = createDefaultFeature(operation, id)
    await openFeaturePanelCreate(feature)
  }

  const handleSave = () => {
    if (features.length === 0) {
      alert('No features to save.')
      return
    }
    saveProject(features)
  }

  const handleLoadClick = () => {
    fileInputRef.current?.click()
  }

  const handleLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-loaded
    e.target.value = ''
    setLoading(true)
    try {
      const loaded = await loadProjectFile(file)
      await loadProject(loaded)
    } catch (err) {
      alert(`Failed to load project: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const handleExportSTL = async () => {
    setExporting(true)
    try {
      const api = await getOccApi()
      const data = await api.exportSTL(false) // binary STL
      downloadBlob(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }), 'export.stl')
    } catch (err) {
      alert(`STL export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportSTEP = async () => {
    setExporting(true)
    try {
      const api = await getOccApi()
      const data = await api.exportSTEP()
      downloadBlob(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }), 'export.step')
    } catch (err) {
      alert(`STEP export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setExporting(false)
    }
  }

  const handleImportSTEP = () => {
    stepInputRef.current?.click()
  }

  const handleImportSTEPFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setLoading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const api = await getOccApi()
      const id = generateFeatureId('import')
      const tess = await api.importSTEP(id, new Uint8Array(arrayBuffer))
      // Create geometry from tessellation and add to scene
      const { importStepAsGeometry } = await import('../engine/rebuild')
      const geometry = importStepAsGeometry(tess)
      // Replace scene with imported geometry
      const store = useAppStore.getState()
      store.clearSceneObjects()
      store.addSceneObject(id, geometry)
    } catch (err) {
      alert(`STEP import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  const isBusy = isRebuilding || loading || exporting || featurePanel !== null

  return (
    <div className="h-10 bg-[#16162a] border-b border-[#2a2a4a] flex items-center px-3 gap-2 shrink-0">
      <span className="text-sm font-semibold text-gray-300 tracking-wide">CAD</span>
      <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

      {/* Hidden file input for project load */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.cad.json"
        className="hidden"
        onChange={handleLoadFile}
      />
      {/* Hidden file input for STEP import */}
      <input
        ref={stepInputRef}
        type="file"
        accept=".step,.stp"
        className="hidden"
        onChange={handleImportSTEPFile}
      />

      {mode === 'modeling' ? (
        <>
          {/* Undo / Redo */}
          <button
            className={canUndo() ? buttonIdle : buttonDisabled}
            onClick={() => undo()}
            disabled={!canUndo() || isBusy}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            className={canRedo() ? buttonIdle : buttonDisabled}
            onClick={() => redo()}
            disabled={!canRedo() || isBusy}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>

          <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

          {/* Save / Load */}
          <button
            className={buttonIdle}
            onClick={handleSave}
            disabled={isBusy || features.length === 0}
            title="Save project to .cad.json"
          >
            Save
          </button>
          <button
            className={buttonIdle}
            onClick={handleLoadClick}
            disabled={isBusy}
            title="Load project from .cad.json"
          >
            {loading ? 'Loading...' : 'Load'}
          </button>

          <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

          {/* Export / Import */}
          <button
            className={buttonIdle}
            onClick={handleExportSTL}
            disabled={isBusy || sceneObjects.size === 0}
            title="Export as binary STL"
          >
            {exporting ? 'Exporting...' : 'STL'}
          </button>
          <button
            className={buttonIdle}
            onClick={handleExportSTEP}
            disabled={isBusy || sceneObjects.size === 0}
            title="Export as STEP"
          >
            STEP
          </button>
          <button
            className={buttonIdle}
            onClick={handleImportSTEP}
            disabled={isBusy}
            title="Import a STEP file"
          >
            Import
          </button>

          <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

          {/* Sketch plane selection */}
          <span className="text-xs text-gray-500 mr-1">Sketch on:</span>
          {Object.entries(SKETCH_PLANES).map(([name, plane]) => (
            <button
              key={name}
              className={buttonIdle}
              onClick={() => enterSketchMode(plane)}
              disabled={isBusy || selectingSketchFace}
            >
              {name}
            </button>
          ))}
          <button
            className={selectingSketchFace ? buttonActive : buttonIdle}
            onClick={() => {
              if (selectingSketchFace) {
                cancelFaceSelection()
              } else {
                startFaceSelection()
              }
            }}
            disabled={isBusy || sceneObjects.size === 0}
            title="Sketch on a planar face of an existing body"
          >
            Face
          </button>

          <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

          {/* Fillet / Chamfer */}
          <button
            className={edgeSelection?.operation === 'fillet' ? buttonActive : buttonIdle}
            onClick={handleFillet}
            disabled={isBusy || sceneObjects.size === 0}
            title="Select edges to fillet"
          >
            Fillet
          </button>
          <button
            className={edgeSelection?.operation === 'chamfer' ? buttonActive : buttonIdle}
            onClick={handleChamfer}
            disabled={isBusy || sceneObjects.size === 0}
            title="Select edges to chamfer"
          >
            Chamfer
          </button>

          {/* Edge selection controls */}
          {edgeSelection?.active && (
            <>
              <span className="text-xs text-cyan-400 ml-1">
                {edgeSelection.selectedEdgeIndices.length} edge{edgeSelection.selectedEdgeIndices.length !== 1 ? 's' : ''}
              </span>
              <button
                className={`${buttonBase} text-green-400 hover:text-green-300 hover:bg-green-900/30`}
                onClick={handleConfirmEdges}
                disabled={edgeSelection.selectedEdgeIndices.length === 0}
              >
                Apply
              </button>
              <button
                className={`${buttonBase} text-gray-400 hover:text-gray-200 hover:bg-[#2a2a4a]`}
                onClick={() => handleApplyAllEdges(edgeSelection.operation)}
                title="Apply to all edges instead"
              >
                All
              </button>
              <button
                className={`${buttonBase} text-red-400 hover:text-red-300 hover:bg-red-900/30`}
                onClick={cancelEdgeSelection}
              >
                Cancel
              </button>
            </>
          )}

          {selectingSketchFace && (
            <span className="text-xs text-cyan-400 ml-2 animate-pulse">
              Click a planar face...
            </span>
          )}
          {isRebuilding && (
            <span className="text-xs text-yellow-400 ml-2 animate-pulse">
              Rebuilding...
            </span>
          )}
        </>
      ) : (
        <>
          {/* Sketch tools */}
          <span className="text-xs text-gray-500 mr-1">
            {isEditingExisting ? 'Editing' : 'Sketch'} ({activeSketch?.plane.name})
          </span>
          <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

          <button
            className={activeTool === 'line' ? buttonActive : buttonIdle}
            onClick={() => setActiveSketchTool(activeTool === 'line' ? null : 'line')}
          >
            Line
          </button>
          <button
            className={activeTool === 'rectangle' ? buttonActive : buttonIdle}
            onClick={() => setActiveSketchTool(activeTool === 'rectangle' ? null : 'rectangle')}
          >
            Rect
          </button>
          <button
            className={activeTool === 'circle' ? buttonActive : buttonIdle}
            onClick={() => setActiveSketchTool(activeTool === 'circle' ? null : 'circle')}
          >
            Circle
          </button>
          <button
            className={activeTool === 'arc' ? buttonActive : buttonIdle}
            onClick={() => setActiveSketchTool(activeTool === 'arc' ? null : 'arc')}
          >
            Arc
          </button>
          <button
            className={activeTool === 'point' ? buttonActive : buttonIdle}
            onClick={() => setActiveSketchTool(activeTool === 'point' ? null : 'point')}
          >
            Point
          </button>

          <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

          {/* Constraint tools — only show when entities are selected */}
          <ConstraintButtons
            applicable={applicable}
            onApply={handleApplyConstraint}
          />

          {applicable.length > 0 && <div className="w-px h-5 bg-[#2a2a4a] mx-1" />}

          {/* DOF indicator */}
          {activeSketch && activeSketch.constraints.length > 0 && (
            <span className={`text-xs ${
              activeSketch.constraintStatus.isOverConstrained
                ? 'text-red-400'
                : activeSketch.constraintStatus.dof === 0
                  ? 'text-green-400'
                  : 'text-blue-400'
            }`}>
              {activeSketch.constraintStatus.isOverConstrained
                ? 'Over-constrained'
                : activeSketch.constraintStatus.dof === 0
                  ? 'Fully constrained'
                  : `DOF: ${activeSketch.constraintStatus.dof}`}
            </span>
          )}

          <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

          <button
            className={`${buttonBase} text-purple-400 hover:text-purple-300 hover:bg-purple-900/30`}
            onClick={() => handleFinishAndCreateFeature('extrude', 'boss')}
            disabled={isBusy}
          >
            Extrude
          </button>
          <button
            className={`${buttonBase} text-orange-400 hover:text-orange-300 hover:bg-orange-900/30`}
            onClick={() => handleFinishAndCreateFeature('extrude', 'cut')}
            disabled={isBusy}
            title="Cut Extrude — subtract material from existing solid"
          >
            Cut
          </button>
          <button
            className={`${buttonBase} text-teal-400 hover:text-teal-300 hover:bg-teal-900/30`}
            onClick={() => handleFinishAndCreateFeature('revolve')}
            disabled={isBusy}
            title="Revolve — rotate profile around a world axis"
          >
            Revolve
          </button>
          <button
            className={`${buttonBase} text-green-400 hover:text-green-300 hover:bg-green-900/30`}
            onClick={handleFinishSketch}
            disabled={isBusy}
          >
            {isEditingExisting ? 'Update Sketch' : 'Finish Sketch'}
          </button>
          <button
            className={`${buttonBase} text-red-400 hover:text-red-300 hover:bg-red-900/30`}
            onClick={() => exitSketchMode()}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  )
}

// ─── Constraint Button Labels ───────────────────────────────

const CONSTRAINT_LABELS: Record<SketchConstraint['type'], { label: string; title: string }> = {
  coincident: { label: 'Co', title: 'Coincident — merge two points' },
  horizontal: { label: 'H', title: 'Horizontal — make line/points horizontal' },
  vertical: { label: 'V', title: 'Vertical — make line/points vertical' },
  fixed: { label: 'Fix', title: 'Fixed — lock point position' },
  distance: { label: 'D', title: 'Distance — set distance/length' },
  horizontalDistance: { label: 'DH', title: 'Horizontal Distance' },
  verticalDistance: { label: 'DV', title: 'Vertical Distance' },
  angle: { label: 'Ang', title: 'Angle between two lines' },
  perpendicular: { label: '⊥', title: 'Perpendicular — make lines 90°' },
  parallel: { label: '∥', title: 'Parallel — make lines parallel' },
  equal: { label: '=', title: 'Equal — make lengths/radii equal' },
  radius: { label: 'R', title: 'Radius — set circle/arc radius' },
  tangent: { label: 'T', title: 'Tangent' },
  midpoint: { label: 'Mid', title: 'Midpoint — place point at line center' },
  pointOnEntity: { label: 'On', title: 'Point on Entity — constrain point to line/circle' },
}

const constraintButton =
  `${buttonBase} text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/30`
const constraintButtonDisabled =
  `${buttonBase} text-gray-600 cursor-not-allowed`

function ConstraintButtons({
  applicable,
  onApply,
}: {
  applicable: SketchConstraint['type'][]
  onApply: (type: SketchConstraint['type']) => void
}) {
  // Show a curated set of constraint buttons; enable only the applicable ones
  const allConstraints: SketchConstraint['type'][] = [
    'coincident', 'horizontal', 'vertical', 'fixed',
    'distance', 'perpendicular', 'parallel', 'equal',
    'radius', 'tangent', 'midpoint',
  ]

  const applicableSet = new Set(applicable)

  return (
    <>
      {allConstraints.map((type) => {
        const info = CONSTRAINT_LABELS[type]
        const enabled = applicableSet.has(type)
        return (
          <button
            key={type}
            className={enabled ? constraintButton : constraintButtonDisabled}
            onClick={() => enabled && onApply(type)}
            disabled={!enabled}
            title={info.title}
          >
            {info.label}
          </button>
        )
      })}
    </>
  )
}

import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { SKETCH_PLANES } from '../engine/sketchTypes'
import type { SketchConstraint } from '../engine/sketchTypes'
import {
  generateFeatureId,
  snapshotSketch,
  type SketchFeature,
  type ExtrudeFeature,
} from '../engine/featureTypes'
import {
  getApplicableConstraints,
  createConstraintFromSelection,
} from '../engine/constraintSolver'

const buttonBase =
  'px-2 py-1 text-xs rounded transition-colors cursor-pointer select-none'
const buttonIdle =
  `${buttonBase} text-gray-400 hover:text-gray-200 hover:bg-[#2a2a4a]`
const buttonActive =
  `${buttonBase} text-white bg-blue-600 hover:bg-blue-500`
const buttonDisabled =
  `${buttonBase} text-gray-600 cursor-not-allowed`

export function Toolbar() {
  const mode = useAppStore((s) => s.mode)
  const activeSketch = useAppStore((s) => s.activeSketch)
  const editingSketchFeatureId = useAppStore((s) => s.editingSketchFeatureId)
  const enterSketchMode = useAppStore((s) => s.enterSketchMode)
  const exitSketchMode = useAppStore((s) => s.exitSketchMode)
  const confirmSketchEdit = useAppStore((s) => s.confirmSketchEdit)
  const setActiveSketchTool = useAppStore((s) => s.setActiveSketchTool)
  const addFeatures = useAppStore((s) => s.addFeatures)
  const addConstraint = useAppStore((s) => s.addConstraint)
  const isRebuilding = useAppStore((s) => s.isRebuilding)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const canUndo = useAppStore((s) => s.canUndo)
  const canRedo = useAppStore((s) => s.canRedo)
  const generateId = useAppStore((s) => s.generateId)
  const [extruding, setExtruding] = useState(false)

  const activeTool = activeSketch?.activeTool ?? null
  const isEditingExisting = editingSketchFeatureId !== null
  const selectedIds = activeSketch?.selectedEntityIds ?? []
  const entities = activeSketch?.entities ?? new Map()

  // Determine which constraints can be applied to the current selection
  const applicable = selectedIds.length > 0
    ? getApplicableConstraints(selectedIds, entities)
    : []

  const handleApplyConstraint = (constraintType: SketchConstraint['type']) => {
    if (!activeSketch) return

    // For dimensional constraints, prompt for value
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
        const input = prompt(`${label}:`, String(defaultVal))
        if (input === null) return
        value = parseFloat(input)
        if (isNaN(value)) return
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

  const handleFinishAndExtrude = async () => {
    if (!activeSketch) return

    // Count non-point, non-construction entities
    const hasProfile = Array.from(activeSketch.entities.values()).some(
      (e) => e.type !== 'point' && !e.construction
    )

    if (!hasProfile) {
      // No edges to extrude — just exit sketch mode
      exitSketchMode()
      return
    }

    const distStr = prompt('Extrude distance:', '5')
    if (!distStr) return
    const distance = parseFloat(distStr)
    if (isNaN(distance) || distance === 0) return

    setExtruding(true)
    try {
      if (isEditingExisting) {
        // Updating existing sketch + keeping/creating extrude
        // First save the sketch edits
        const snapshot = snapshotSketch(activeSketch.plane, activeSketch.entities, activeSketch.constraints)
        const { updateFeature } = useAppStore.getState()
        await updateFeature(editingSketchFeatureId, { sketch: snapshot } as Partial<SketchFeature>)

        exitSketchMode()
      } else {
        // Create a SketchFeature (snapshot of current sketch)
        const sketchId = generateFeatureId('sketch')
        const sketchFeature: SketchFeature = {
          id: sketchId,
          name: `Sketch (${activeSketch.plane.name})`,
          type: 'sketch',
          suppressed: false,
          sketch: snapshotSketch(activeSketch.plane, activeSketch.entities, activeSketch.constraints),
        }

        // Create an ExtrudeFeature referencing the sketch
        const extrudeId = generateFeatureId('extrude')
        const extrudeFeature: ExtrudeFeature = {
          id: extrudeId,
          name: `Extrude (${Math.abs(distance)}mm)`,
          type: 'extrude',
          suppressed: false,
          sketchId,
          distance: Math.abs(distance),
          direction: distance > 0 ? 'normal' : 'reverse',
        }

        // Add both features and rebuild
        await addFeatures([sketchFeature, extrudeFeature])
        exitSketchMode()
      }
    } catch (err) {
      console.error('[Toolbar] Extrude failed:', err)
      alert(`Extrude failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setExtruding(false)
    }
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

  const isBusy = extruding || isRebuilding

  return (
    <div className="h-10 bg-[#16162a] border-b border-[#2a2a4a] flex items-center px-3 gap-2 shrink-0">
      <span className="text-sm font-semibold text-gray-300 tracking-wide">CAD</span>
      <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

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

          {/* Sketch plane selection */}
          <span className="text-xs text-gray-500 mr-1">Sketch on:</span>
          {Object.entries(SKETCH_PLANES).map(([name, plane]) => (
            <button
              key={name}
              className={buttonIdle}
              onClick={() => enterSketchMode(plane)}
              disabled={isBusy}
            >
              {name}
            </button>
          ))}
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
            onClick={handleFinishAndExtrude}
            disabled={isBusy}
          >
            {extruding ? 'Extruding...' : 'Extrude'}
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

  // Only show buttons that have a chance of being applicable (i.e., if there's a selection)
  // To keep the toolbar clean, show all buttons but dim the inapplicable ones
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

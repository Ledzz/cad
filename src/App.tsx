import { useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { FeatureTree } from './components/FeatureTree'
import { Viewport } from './components/Viewport'
import { PropertiesPanel } from './components/PropertiesPanel'
import { FeaturePanel } from './components/FeaturePanel'
import { InputDialog } from './components/InputDialog'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { useAppStore } from './store/appStore'
import {
  getApplicableConstraints,
  createConstraintFromSelection,
} from './engine/constraintSolver'

import type { SketchConstraint } from './engine/sketchTypes'
import type { AppState } from './store/appStore'

/** Try to apply a constraint to the current selection via keyboard shortcut */
async function applyConstraintShortcut(store: AppState, constraintType: SketchConstraint['type']) {
  const sketch = store.activeSketch
  if (!sketch) return

  const { selectedEntityIds, entities } = sketch
  if (selectedEntityIds.length === 0) return

  const applicable = getApplicableConstraints(selectedEntityIds, entities)
  if (!applicable.includes(constraintType)) return

  // For dimensional constraints, use input dialog for value
  const needsValue = ['distance', 'horizontalDistance', 'verticalDistance', 'angle', 'radius'].includes(constraintType)
  let value: number | undefined

  if (needsValue) {
    const tempConstraint = createConstraintFromSelection(
      constraintType,
      'temp',
      selectedEntityIds,
      entities
    )
    if (tempConstraint && 'value' in tempConstraint) {
      const label = constraintType === 'angle' ? 'Angle (degrees)' : 'Value'
      const defaultVal = Math.round((tempConstraint as any).value * 1000) / 1000
      const result = await store.openNumberInput(label, defaultVal)
      if (result === null) return
      value = result
    }
  }

  const id = store.generateId('cst')
  const constraint = createConstraintFromSelection(
    constraintType,
    id,
    selectedEntityIds,
    entities,
    value
  )

  if (constraint) {
    store.addConstraint(constraint)
  }
}

function useSketchKeyboardShortcuts() {
  const mode = useAppStore((s) => s.mode)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const store = useAppStore.getState()
      if (store.mode !== 'sketching' || !store.activeSketch) return

      switch (e.key) {
        case 'Escape': {
          // If drawing, cancel the current drawing operation
          // If constraint tool active, clear it
          // If no drawing in progress, deselect or exit sketch
          const { drawingState, activeTool, activeConstraintTool } = store.activeSketch
          if (drawingState.placedPointIds.length > 0) {
            store.resetDrawingState()
          } else if (activeTool) {
            store.setActiveSketchTool(null)
          } else if (activeConstraintTool) {
            store.setActiveConstraintTool(null)
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          // Delete selected entities
          const { selectedEntityIds } = store.activeSketch
          if (selectedEntityIds.length > 0) {
            e.preventDefault()
            store.removeSketchEntities(selectedEntityIds)
          }
          break
        }
        case 'l':
        case 'L':
          if (!e.metaKey && !e.ctrlKey) {
            store.setActiveSketchTool(store.activeSketch.activeTool === 'line' ? null : 'line')
          }
          break
        case 'r':
        case 'R':
          if (!e.metaKey && !e.ctrlKey) {
            store.setActiveSketchTool(store.activeSketch.activeTool === 'rectangle' ? null : 'rectangle')
          }
          break
        case 'c':
        case 'C':
          if (!e.metaKey && !e.ctrlKey) {
            store.setActiveSketchTool(store.activeSketch.activeTool === 'circle' ? null : 'circle')
          }
          break
        case 'a':
        case 'A':
          if (!e.metaKey && !e.ctrlKey) {
            store.setActiveSketchTool(store.activeSketch.activeTool === 'arc' ? null : 'arc')
          }
          break
        case 'p':
        case 'P':
          if (!e.metaKey && !e.ctrlKey) {
            store.setActiveSketchTool(store.activeSketch.activeTool === 'point' ? null : 'point')
          }
          break

        // ─── Constraint shortcuts ─────────────────────────
        case 'h':
        case 'H':
          if (!e.metaKey && !e.ctrlKey) {
            applyConstraintShortcut(store, 'horizontal')
          }
          break
        case 'v':
        case 'V':
          if (!e.metaKey && !e.ctrlKey) {
            applyConstraintShortcut(store, 'vertical')
          }
          break
        case 'd':
        case 'D':
          if (!e.metaKey && !e.ctrlKey) {
            applyConstraintShortcut(store, 'distance')
          }
          break
        case 'e':
        case 'E':
          if (!e.metaKey && !e.ctrlKey) {
            applyConstraintShortcut(store, 'equal')
          }
          break
        case 'f':
        case 'F':
          if (!e.metaKey && !e.ctrlKey) {
            applyConstraintShortcut(store, 'fixed')
          }
          break
        case 'q':
        case 'Q':
          if (!e.metaKey && !e.ctrlKey) {
            applyConstraintShortcut(store, 'perpendicular')
          }
          break
        case 't':
        case 'T':
          if (!e.metaKey && !e.ctrlKey) {
            applyConstraintShortcut(store, 'tangent')
          }
          break
      }
    }

    if (mode === 'sketching') {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mode])
}

function useGlobalKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const store = useAppStore.getState()

      // Escape: cancel face selection mode
      if (e.key === 'Escape' && store.selectingSketchFace) {
        e.preventDefault()
        store.cancelFaceSelection()
        return
      }

      // Escape: cancel edge selection mode
      if (e.key === 'Escape' && store.edgeSelection?.active) {
        e.preventDefault()
        store.cancelEdgeSelection()
        return
      }

      // Escape: cancel measurement mode
      if (e.key === 'Escape' && store.measurementMode) {
        e.preventDefault()
        store.setMeasurementMode(null)
        return
      }

      // Undo: Ctrl/Cmd+Z (without Shift)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        // Don't undo while in sketch mode (would be confusing)
        if (store.mode === 'modeling' && !store.isRebuilding) {
          store.undo()
        }
        return
      }

      // Redo: Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
      if (
        ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')
      ) {
        e.preventDefault()
        if (store.mode === 'modeling' && !store.isRebuilding) {
          store.redo()
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}

function App() {
  useSketchKeyboardShortcuts()
  useGlobalKeyboardShortcuts()

  return (
    <>
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <FeatureTree />
        <Viewport />
        <PropertiesPanel />
      </div>
      <StatusBar />
      <FeaturePanel />
      <InputDialog />
      <CommandPalette />
    </>
  )
}

export default App

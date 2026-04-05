import { useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { FeatureTree } from './components/FeatureTree'
import { Viewport } from './components/Viewport'
import { PropertiesPanel } from './components/PropertiesPanel'
import { FeatureEditDialog } from './components/FeatureEditDialog'
import { useAppStore } from './store/appStore'

function useSketchKeyboardShortcuts() {
  const mode = useAppStore((s) => s.mode)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const store = useAppStore.getState()
      if (store.mode !== 'sketching' || !store.activeSketch) return

      switch (e.key) {
        case 'Escape': {
          // If drawing, cancel the current drawing operation
          // If no drawing in progress, deselect or exit sketch
          const { drawingState, activeTool } = store.activeSketch
          if (drawingState.placedPointIds.length > 0) {
            store.resetDrawingState()
          } else if (activeTool) {
            store.setActiveSketchTool(null)
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
      <FeatureEditDialog />
    </>
  )
}

export default App

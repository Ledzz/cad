import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { SKETCH_PLANES } from '../engine/sketchTypes'
import {
  generateFeatureId,
  snapshotSketch,
  type SketchFeature,
  type ExtrudeFeature,
} from '../engine/featureTypes'

const buttonBase =
  'px-2 py-1 text-xs rounded transition-colors cursor-pointer select-none'
const buttonIdle =
  `${buttonBase} text-gray-400 hover:text-gray-200 hover:bg-[#2a2a4a]`
const buttonActive =
  `${buttonBase} text-white bg-blue-600 hover:bg-blue-500`

export function Toolbar() {
  const mode = useAppStore((s) => s.mode)
  const activeSketch = useAppStore((s) => s.activeSketch)
  const enterSketchMode = useAppStore((s) => s.enterSketchMode)
  const exitSketchMode = useAppStore((s) => s.exitSketchMode)
  const setActiveSketchTool = useAppStore((s) => s.setActiveSketchTool)
  const addFeatures = useAppStore((s) => s.addFeatures)
  const isRebuilding = useAppStore((s) => s.isRebuilding)
  const [extruding, setExtruding] = useState(false)

  const activeTool = activeSketch?.activeTool ?? null

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
      // Create a SketchFeature (snapshot of current sketch)
      const sketchId = generateFeatureId('sketch')
      const sketchFeature: SketchFeature = {
        id: sketchId,
        name: `Sketch (${activeSketch.plane.name})`,
        type: 'sketch',
        suppressed: false,
        sketch: snapshotSketch(activeSketch.plane, activeSketch.entities),
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
    } catch (err) {
      console.error('[Toolbar] Extrude failed:', err)
      alert(`Extrude failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setExtruding(false)
    }
  }

  const isBusy = extruding || isRebuilding

  return (
    <div className="h-10 bg-[#16162a] border-b border-[#2a2a4a] flex items-center px-3 gap-2 shrink-0">
      <span className="text-sm font-semibold text-gray-300 tracking-wide">CAD</span>
      <div className="w-px h-5 bg-[#2a2a4a] mx-1" />

      {mode === 'modeling' ? (
        <>
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
            Sketch ({activeSketch?.plane.name})
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

          <button
            className={`${buttonBase} text-purple-400 hover:text-purple-300 hover:bg-purple-900/30`}
            onClick={handleFinishAndExtrude}
            disabled={isBusy}
          >
            {extruding ? 'Extruding...' : 'Extrude'}
          </button>
          <button
            className={`${buttonBase} text-green-400 hover:text-green-300 hover:bg-green-900/30`}
            onClick={() => exitSketchMode()}
          >
            Finish Sketch
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

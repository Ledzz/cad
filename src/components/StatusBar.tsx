import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'

// ─── Module-level cursor position (non-reactive to avoid re-render storms) ──

export const cursorWorld = { x: 0, y: 0, z: 0, valid: false }

/**
 * Status bar at the bottom of the viewport.
 * Shows: mode, active tool, selection info, cursor coordinates, feature count.
 */
export function StatusBar() {
  const mode = useAppStore((s) => s.mode)
  const activeSketch = useAppStore((s) => s.activeSketch)
  const selection = useAppStore((s) => s.selection)
  const features = useAppStore((s) => s.features)
  const isRebuilding = useAppStore((s) => s.isRebuilding)
  const selectingSketchFace = useAppStore((s) => s.selectingSketchFace)
  const edgeSelection = useAppStore((s) => s.edgeSelection)

  // Poll cursor position at ~15fps via rAF to avoid per-mousemove re-renders
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0, valid: false })
  const rafRef = useRef(0)

  useEffect(() => {
    let running = true
    function tick() {
      if (!running) return
      setCoords((prev) => {
        if (
          prev.x === cursorWorld.x &&
          prev.y === cursorWorld.y &&
          prev.z === cursorWorld.z &&
          prev.valid === cursorWorld.valid
        ) {
          return prev // no update, skip re-render
        }
        return { ...cursorWorld }
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Mode label
  let modeLabel = 'Modeling'
  if (mode === 'sketching') {
    modeLabel = `Sketch (${activeSketch?.plane.name ?? '?'})`
  }
  if (selectingSketchFace) {
    modeLabel = 'Select Face'
  }
  if (edgeSelection?.active) {
    modeLabel = `Select Edges (${edgeSelection.operation})`
  }

  // Active tool
  let toolLabel = ''
  if (mode === 'sketching' && activeSketch) {
    if (activeSketch.activeTool) {
      toolLabel = activeSketch.activeTool.charAt(0).toUpperCase() + activeSketch.activeTool.slice(1)
    } else if (activeSketch.activeConstraintTool) {
      toolLabel = activeSketch.activeConstraintTool.charAt(0).toUpperCase() + activeSketch.activeConstraintTool.slice(1)
    }
  }

  // Selection info
  let selectionLabel = ''
  if (mode === 'sketching' && activeSketch) {
    const count = activeSketch.selectedEntityIds.length
    if (count > 0) {
      selectionLabel = `${count} selected`
    }
  } else {
    const count = selection.selectedIds.length
    if (count > 0) {
      selectionLabel = `${count} object${count > 1 ? 's' : ''}`
    }
  }

  // Feature count
  const featureCount = features.filter((f) => !f.suppressed).length
  const totalFeatures = features.length

  // Coordinate formatting
  const fmt = (n: number) => n.toFixed(2)

  return (
    <div className="h-6 bg-[#16162a] border-t border-[#2a2a4a] flex items-center px-3 gap-4 shrink-0 text-[10px] text-gray-400 select-none">
      {/* Mode */}
      <span className="text-gray-300 font-medium">{modeLabel}</span>

      {/* Active tool */}
      {toolLabel && (
        <>
          <div className="w-px h-3 bg-[#2a2a4a]" />
          <span className="text-blue-400">{toolLabel}</span>
        </>
      )}

      {/* Selection */}
      {selectionLabel && (
        <>
          <div className="w-px h-3 bg-[#2a2a4a]" />
          <span className="text-yellow-400">{selectionLabel}</span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Rebuilding indicator */}
      {isRebuilding && (
        <span className="text-yellow-400 animate-pulse">Rebuilding...</span>
      )}

      {/* Feature count */}
      <span>
        {featureCount}/{totalFeatures} features
      </span>

      <div className="w-px h-3 bg-[#2a2a4a]" />

      {/* Cursor coordinates */}
      <span className="font-mono tabular-nums w-52 text-right">
        {coords.valid
          ? `X: ${fmt(coords.x)}  Y: ${fmt(coords.y)}  Z: ${fmt(coords.z)}`
          : 'X: —  Y: —  Z: —'}
      </span>
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import { Command } from 'cmdk'
import { useAppStore } from '../store/appStore'
import { SKETCH_PLANES } from '../engine/sketchTypes'
import type { SketchConstraint } from '../engine/sketchTypes'
import { generateFeatureId, createDefaultFeature, snapshotSketch } from '../engine/featureTypes'
import type { SketchFeature } from '../engine/featureTypes'
import {
  getApplicableConstraints,
  createConstraintFromSelection,
} from '../engine/constraintSolver'
import { saveProject } from '../engine/projectFile'

// ─── Command definition ────────────────────────────────────

interface CadCommand {
  id: string
  label: string
  group: string
  shortcut?: string
  keywords?: string[]
  /** Return false if the command shouldn't appear right now */
  available?: () => boolean
  action: () => void | Promise<void>
}

// ─── Command registry builder ──────────────────────────────

function buildCommands(): CadCommand[] {
  const commands: CadCommand[] = []

  // ─── File ─────────────────────────────────────────────
  commands.push({
    id: 'file:save',
    label: 'Save Project',
    group: 'File',
    shortcut: 'Ctrl+S',
    keywords: ['save', 'export', 'download', 'json'],
    available: () => useAppStore.getState().features.length > 0,
    action: () => saveProject(useAppStore.getState().features),
  })
  commands.push({
    id: 'file:export-stl',
    label: 'Export STL',
    group: 'File',
    keywords: ['stl', 'mesh', 'export', '3d print'],
    available: () => useAppStore.getState().sceneObjects.size > 0,
    action: async () => {
      const { getOccApi } = await import('../workers/occApi')
      const api = await getOccApi()
      const data = await api.exportSTL(false)
      const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'export.stl'
      a.click()
      URL.revokeObjectURL(url)
    },
  })
  commands.push({
    id: 'file:export-step',
    label: 'Export STEP',
    group: 'File',
    keywords: ['step', 'stp', 'export', 'cad'],
    available: () => useAppStore.getState().sceneObjects.size > 0,
    action: async () => {
      const { getOccApi } = await import('../workers/occApi')
      const api = await getOccApi()
      const data = await api.exportSTEP()
      const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'export.step'
      a.click()
      URL.revokeObjectURL(url)
    },
  })

  // ─── Edit ─────────────────────────────────────────────
  commands.push({
    id: 'edit:undo',
    label: 'Undo',
    group: 'Edit',
    shortcut: 'Ctrl+Z',
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.canUndo()
    },
    action: () => useAppStore.getState().undo(),
  })
  commands.push({
    id: 'edit:redo',
    label: 'Redo',
    group: 'Edit',
    shortcut: 'Ctrl+Shift+Z',
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.canRedo()
    },
    action: () => useAppStore.getState().redo(),
  })

  // ─── Sketch planes ───────────────────────────────────
  for (const [name, plane] of Object.entries(SKETCH_PLANES)) {
    commands.push({
      id: `sketch:plane-${name}`,
      label: `Sketch on ${name}`,
      group: 'Sketch',
      keywords: ['sketch', 'plane', name.toLowerCase()],
      available: () => useAppStore.getState().mode === 'modeling',
      action: () => useAppStore.getState().enterSketchMode(plane),
    })
  }
  commands.push({
    id: 'sketch:face',
    label: 'Sketch on Face',
    group: 'Sketch',
    keywords: ['sketch', 'face', 'surface', 'plane'],
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.sceneObjects.size > 0
    },
    action: () => useAppStore.getState().startFaceSelection(),
  })

  // ─── Sketch tools (only in sketch mode) ──────────────
  const sketchTools: Array<{ id: string; label: string; tool: string; shortcut: string }> = [
    { id: 'tool:line', label: 'Line Tool', tool: 'line', shortcut: 'L' },
    { id: 'tool:rectangle', label: 'Rectangle Tool', tool: 'rectangle', shortcut: 'R' },
    { id: 'tool:circle', label: 'Circle Tool', tool: 'circle', shortcut: 'C' },
    { id: 'tool:arc', label: 'Arc Tool', tool: 'arc', shortcut: 'A' },
    { id: 'tool:point', label: 'Point Tool', tool: 'point', shortcut: 'P' },
  ]

  for (const t of sketchTools) {
    commands.push({
      id: t.id,
      label: t.label,
      group: 'Sketch Tools',
      shortcut: t.shortcut,
      keywords: ['sketch', 'draw', t.tool],
      available: () => useAppStore.getState().mode === 'sketching',
      action: () => {
        const store = useAppStore.getState()
        const active = store.activeSketch?.activeTool
        store.setActiveSketchTool(active === t.tool ? null : (t.tool as any))
      },
    })
  }

  // ─── Sketch Constraints ──────────────────────────────
  const constraintTypes: Array<{ type: SketchConstraint['type']; label: string; shortcut?: string }> = [
    { type: 'coincident', label: 'Coincident' },
    { type: 'horizontal', label: 'Horizontal', shortcut: 'H' },
    { type: 'vertical', label: 'Vertical', shortcut: 'V' },
    { type: 'fixed', label: 'Fixed', shortcut: 'F' },
    { type: 'distance', label: 'Distance', shortcut: 'D' },
    { type: 'perpendicular', label: 'Perpendicular', shortcut: 'Q' },
    { type: 'parallel', label: 'Parallel' },
    { type: 'equal', label: 'Equal', shortcut: 'E' },
    { type: 'radius', label: 'Radius' },
    { type: 'tangent', label: 'Tangent', shortcut: 'T' },
    { type: 'midpoint', label: 'Midpoint' },
    { type: 'angle', label: 'Angle' },
  ]

  for (const ct of constraintTypes) {
    commands.push({
      id: `constraint:${ct.type}`,
      label: `${ct.label} Constraint`,
      group: 'Constraints',
      shortcut: ct.shortcut,
      keywords: ['constraint', ct.type, ct.label.toLowerCase()],
      available: () => {
        const s = useAppStore.getState()
        if (s.mode !== 'sketching' || !s.activeSketch) return false
        const { selectedEntityIds, entities } = s.activeSketch
        if (selectedEntityIds.length === 0) return false
        return getApplicableConstraints(selectedEntityIds, entities).includes(ct.type)
      },
      action: async () => {
        const store = useAppStore.getState()
        const sketch = store.activeSketch
        if (!sketch) return
        const { selectedEntityIds, entities } = sketch

        const needsValue = ['distance', 'horizontalDistance', 'verticalDistance', 'angle', 'radius'].includes(ct.type)
        let value: number | undefined

        if (needsValue) {
          const tempConstraint = createConstraintFromSelection(ct.type, 'temp', selectedEntityIds, entities)
          if (tempConstraint && 'value' in tempConstraint) {
            const label = ct.type === 'angle' ? 'Angle (degrees)' : 'Value'
            const defaultVal = Math.round((tempConstraint as any).value * 1000) / 1000
            const result = await store.openNumberInput(label, defaultVal)
            if (result === null) return
            value = result
          }
        }

        const constraint = createConstraintFromSelection(
          ct.type,
          store.generateId('cst'),
          selectedEntityIds,
          entities,
          value
        )
        if (constraint) store.addConstraint(constraint)
      },
    })
  }

  // ─── Sketch finish actions ───────────────────────────
  commands.push({
    id: 'sketch:extrude',
    label: 'Finish Sketch & Extrude',
    group: 'Sketch Actions',
    keywords: ['extrude', 'finish', 'boss', 'solid'],
    available: () => useAppStore.getState().mode === 'sketching',
    action: async () => {
      const store = useAppStore.getState()
      const sketch = store.activeSketch
      if (!sketch) return

      const hasProfile = Array.from(sketch.entities.values()).some(
        (e) => e.type !== 'point' && !e.construction
      )
      if (!hasProfile) { store.exitSketchMode(); return }

      const sketchId = generateFeatureId('sketch')
      const sketchFeature: SketchFeature = {
        id: sketchId,
        name: `Sketch (${sketch.plane.name})`,
        type: 'sketch',
        suppressed: false,
        sketch: snapshotSketch(sketch.plane, sketch.entities, sketch.constraints),
      }

      const featureId = generateFeatureId('extrude')
      const feature = createDefaultFeature('extrude', featureId, { sketchId, operation: 'boss' })

      const featuresWithSketch = [...store.features, sketchFeature]
      store._setFeaturesRaw(featuresWithSketch)
      store.exitSketchMode()
      await store.openFeaturePanelCreate(feature, sketchId)
    },
  })

  commands.push({
    id: 'sketch:finish',
    label: 'Finish Sketch',
    group: 'Sketch Actions',
    keywords: ['finish', 'done', 'save', 'sketch'],
    available: () => useAppStore.getState().mode === 'sketching',
    action: () => useAppStore.getState().confirmSketchEdit(),
  })

  commands.push({
    id: 'sketch:cancel',
    label: 'Cancel Sketch',
    group: 'Sketch Actions',
    keywords: ['cancel', 'exit', 'abort'],
    available: () => useAppStore.getState().mode === 'sketching',
    action: () => useAppStore.getState().exitSketchMode(),
  })

  // ─── 3D Features ─────────────────────────────────────
  commands.push({
    id: 'feature:fillet',
    label: 'Fillet',
    group: 'Features',
    keywords: ['fillet', 'round', 'edge', 'radius'],
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.sceneObjects.size > 0
    },
    action: () => useAppStore.getState().startEdgeSelection('fillet'),
  })
  commands.push({
    id: 'feature:chamfer',
    label: 'Chamfer',
    group: 'Features',
    keywords: ['chamfer', 'bevel', 'edge'],
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.sceneObjects.size > 0
    },
    action: () => useAppStore.getState().startEdgeSelection('chamfer'),
  })

  // ─── View ─────────────────────────────────────────────
  const views: Array<{ id: string; label: string; shortcut?: string }> = [
    { id: 'view:front', label: 'Front View' },
    { id: 'view:back', label: 'Back View' },
    { id: 'view:top', label: 'Top View' },
    { id: 'view:bottom', label: 'Bottom View' },
    { id: 'view:left', label: 'Left View' },
    { id: 'view:right', label: 'Right View' },
    { id: 'view:iso', label: 'Isometric View' },
  ]

  // Note: view commands require camera actions ref which is in Viewport.
  // These are registered but will dispatch a custom event that Viewport handles.
  for (const v of views) {
    commands.push({
      id: v.id,
      label: v.label,
      group: 'View',
      keywords: ['view', 'camera', v.label.split(' ')[0].toLowerCase()],
      action: () => {
        window.dispatchEvent(new CustomEvent('cad:named-view', { detail: v.id.replace('view:', '') }))
      },
    })
  }
  commands.push({
    id: 'view:fit',
    label: 'Zoom to Fit',
    group: 'View',
    keywords: ['zoom', 'fit', 'all', 'center'],
    action: () => {
      window.dispatchEvent(new CustomEvent('cad:zoom-to-fit'))
    },
  })
  commands.push({
    id: 'view:toggle-edges',
    label: 'Toggle Edge Display',
    group: 'View',
    keywords: ['edges', 'wireframe', 'shaded', 'outline'],
    action: () => useAppStore.getState().toggleShowEdges(),
  })

  // ─── Measurement ─────────────────────────────────────
  commands.push({
    id: 'measure:point-to-point',
    label: 'Measure Point-to-Point Distance',
    group: 'Measure',
    keywords: ['measure', 'distance', 'point', 'length'],
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.sceneObjects.size > 0
    },
    action: () => useAppStore.getState().setMeasurementMode('point-to-point'),
  })
  commands.push({
    id: 'measure:edge-length',
    label: 'Measure Edge Length',
    group: 'Measure',
    keywords: ['measure', 'edge', 'length', 'curve'],
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.sceneObjects.size > 0
    },
    action: () => useAppStore.getState().setMeasurementMode('edge-length'),
  })
  commands.push({
    id: 'measure:face-angle',
    label: 'Measure Angle Between Faces',
    group: 'Measure',
    keywords: ['measure', 'angle', 'face', 'surface', 'degrees'],
    available: () => {
      const s = useAppStore.getState()
      return s.mode === 'modeling' && s.sceneObjects.size > 0
    },
    action: () => useAppStore.getState().setMeasurementMode('face-angle'),
  })
  commands.push({
    id: 'measure:clear',
    label: 'Clear All Measurements',
    group: 'Measure',
    keywords: ['clear', 'remove', 'measure', 'reset'],
    available: () => useAppStore.getState().measurements.length > 0,
    action: () => useAppStore.getState().clearMeasurements(),
  })

  return commands
}

// ─── Component ─────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [commands] = useState(buildCommands)

  // Toggle with Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSelect = useCallback(
    (commandId: string) => {
      setOpen(false)
      const cmd = commands.find((c) => c.id === commandId)
      if (cmd) {
        // Small delay so the dialog closes first
        requestAnimationFrame(() => cmd.action())
      }
    },
    [commands]
  )

  // Filter to only available commands
  const available = commands.filter((c) => !c.available || c.available())

  // Group commands
  const groups = new Map<string, CadCommand[]>()
  for (const cmd of available) {
    const list = groups.get(cmd.group) ?? []
    list.push(cmd)
    groups.set(cmd.group, list)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      overlayClassName="fixed inset-0 bg-black/50"
      contentClassName="w-[480px] max-h-[360px] bg-[#1e1e3a] border border-[#3a3a5a] rounded-lg shadow-2xl overflow-hidden flex flex-col"
    >
      <div className="flex items-center border-b border-[#3a3a5a] px-3">
        <span className="text-gray-500 text-sm mr-2">&gt;</span>
        <Command.Input
          className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none py-2.5"
          placeholder="Type a command..."
          autoFocus
        />
      </div>

      <Command.List className="flex-1 overflow-y-auto p-1.5">
        <Command.Empty className="text-gray-500 text-xs text-center py-6">
          No commands found.
        </Command.Empty>

        {Array.from(groups.entries()).map(([groupName, cmds]) => (
          <Command.Group key={groupName} heading={groupName} className="mb-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider px-2 py-1">
              {groupName}
            </div>
            {cmds.map((cmd) => (
              <Command.Item
                key={cmd.id}
                value={cmd.id}
                keywords={cmd.keywords}
                onSelect={handleSelect}
                className="flex items-center justify-between px-2 py-1.5 text-xs text-gray-300 rounded cursor-pointer data-[selected=true]:bg-[#2a2a4a] data-[selected=true]:text-gray-100"
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="text-[10px] text-gray-500 bg-[#2a2a4a] px-1.5 py-0.5 rounded font-mono">
                    {cmd.shortcut}
                  </kbd>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  )
}

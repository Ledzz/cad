import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { Feature, ExtrudeFeature, RevolveFeature } from '../engine/featureTypes'

// ─── Feature type icons (simple text-based) ─────────────────

function FeatureIcon({ feature }: { feature: Feature }) {
  let label: string
  let color: string

  if (feature.type === 'sketch') {
    label = 'Sk'; color = 'bg-amber-600'
  } else if (feature.type === 'extrude' && (feature as ExtrudeFeature).operation === 'cut') {
    label = 'C'; color = 'bg-orange-600'
  } else if (feature.type === 'extrude') {
    label = 'E'; color = 'bg-purple-600'
  } else if (feature.type === 'revolve') {
    const axis = (feature as RevolveFeature).axis
    label = `R${axis}`; color = 'bg-teal-600'
  } else if (feature.type === 'fillet') {
    label = 'Fi'; color = 'bg-blue-600'
  } else if (feature.type === 'chamfer') {
    label = 'Ch'; color = 'bg-indigo-600'
  } else {
    label = '?'; color = 'bg-gray-600'
  }

  return (
    <span
      className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${color} text-white`}
    >
      {label}
    </span>
  )
}

// ─── Inline rename input ────────────────────────────────────

function InlineRename({
  name,
  onCommit,
  onCancel,
}: {
  name: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      className="bg-[#1a1a3a] text-gray-200 text-sm px-1 py-0 rounded border border-blue-500/50 outline-none flex-1 min-w-0"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value)
        if (e.key === 'Escape') onCancel()
      }}
      autoFocus
    />
  )
}

// ─── Context Menu ───────────────────────────────────────────

interface ContextMenuProps {
  feature: Feature
  x: number
  y: number
  onClose: () => void
  featureIndex: number
  totalFeatures: number
}

function ContextMenu({ feature, x, y, onClose, featureIndex, totalFeatures }: ContextMenuProps) {
  const toggleSuppression = useAppStore((s) => s.toggleSuppression)
  const removeFeature = useAppStore((s) => s.removeFeature)
  const reorderFeature = useAppStore((s) => s.reorderFeature)
  const setEditingFeature = useAppStore((s) => s.setEditingFeature)
  const editSketch = useAppStore((s) => s.editSketch)

  const hasEditableParams = feature.type === 'extrude'
  const isSketch = feature.type === 'sketch'

  useEffect(() => {
    const handleClick = () => onClose()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Delay to avoid catching the triggering right-click
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick)
      window.addEventListener('contextmenu', handleClick)
      window.addEventListener('keydown', handleKey)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const items: Array<{
    label: string
    action: () => void
    disabled?: boolean
    danger?: boolean
  }> = []

  if (isSketch) {
    items.push({
      label: 'Edit Sketch...',
      action: () => {
        editSketch(feature.id)
        onClose()
      },
    })
  }

  if (hasEditableParams) {
    items.push({
      label: 'Edit Parameters...',
      action: () => {
        setEditingFeature({ featureId: feature.id })
        onClose()
      },
    })
  }

  items.push({
    label: feature.suppressed ? 'Unsuppress' : 'Suppress',
    action: () => {
      toggleSuppression(feature.id)
      onClose()
    },
  })

  items.push({
    label: 'Move Up',
    action: () => {
      reorderFeature(feature.id, featureIndex - 1)
      onClose()
    },
    disabled: featureIndex === 0,
  })

  items.push({
    label: 'Move Down',
    action: () => {
      reorderFeature(feature.id, featureIndex + 1)
      onClose()
    },
    disabled: featureIndex >= totalFeatures - 1,
  })

  items.push({
    label: 'Delete',
    action: () => {
      removeFeature(feature.id)
      onClose()
    },
    danger: true,
  })

  return (
    <div
      className="fixed z-50 bg-[#1e1e3a] border border-[#3a3a5a] rounded shadow-xl py-1 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
            item.disabled
              ? 'text-gray-600 cursor-not-allowed'
              : item.danger
                ? 'text-red-400 hover:bg-red-900/30'
                : 'text-gray-300 hover:bg-[#2a2a4a]'
          }`}
          onClick={item.action}
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ─── Feature Tree ───────────────────────────────────────────

export function FeatureTree() {
  const features = useAppStore((s) => s.features)
  const selection = useAppStore((s) => s.selection)
  const setSelection = useAppStore((s) => s.setSelection)
  const renameFeature = useAppStore((s) => s.renameFeature)
  const setEditingFeature = useAppStore((s) => s.setEditingFeature)
  const editSketch = useAppStore((s) => s.editSketch)
  const isRebuilding = useAppStore((s) => s.isRebuilding)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    feature: Feature
    x: number
    y: number
    index: number
  } | null>(null)

  return (
    <div className="w-[260px] bg-[#16162a] border-r border-[#2a2a4a] flex flex-col shrink-0">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#2a2a4a] flex items-center justify-between">
        <span>Feature Tree</span>
        {isRebuilding && (
          <span className="text-yellow-400 animate-pulse normal-case font-normal">
            rebuilding...
          </span>
        )}
      </div>
      <div className="flex-1 py-1 overflow-y-auto">
        {features.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500 italic">No features yet</div>
        ) : (
          features.map((feature, index) => {
            const isSelected = selection.selectedIds.includes(feature.id)

            return (
              <button
                key={feature.id}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                  feature.suppressed
                    ? 'opacity-40'
                    : isSelected
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'text-gray-400 hover:bg-[#1e1e3a] hover:text-gray-300'
                }`}
                onClick={() => setSelection([feature.id])}
                onDoubleClick={() => {
                  if (feature.type === 'sketch') {
                    // Double-click sketch to edit it
                    editSketch(feature.id)
                  } else {
                    // For other features, open parameter edit dialog
                    setEditingFeature({ featureId: feature.id })
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({
                    feature,
                    x: e.clientX,
                    y: e.clientY,
                    index,
                  })
                }}
              >
                <FeatureIcon feature={feature} />
                {renamingId === feature.id ? (
                  <InlineRename
                    name={feature.name}
                    onCommit={(name) => {
                      if (name.trim()) renameFeature(feature.id, name.trim())
                      setRenamingId(null)
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <span
                    className={`flex-1 truncate ${
                      feature.suppressed ? 'line-through' : ''
                    }`}
                  >
                    {feature.name}
                  </span>
                )}
                {feature.suppressed && (
                  <span className="text-[10px] text-gray-600 shrink-0">
                    OFF
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          feature={contextMenu.feature}
          x={contextMenu.x}
          y={contextMenu.y}
          featureIndex={contextMenu.index}
          totalFeatures={features.length}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { getFullEditableParams, featureTypeLabel } from '../engine/featureTypes'
import type { ParamDef, ButtonParamDef } from '../engine/featureTypes'

/**
 * Non-blocking feature parameter panel.
 * Positioned in the top-left (below toolbar, right of feature tree) — Onshape style.
 * Used for both creating new features and editing existing ones.
 * Changes are applied live (immediate rebuild preview).
 * OK commits; Cancel reverts to the state before the panel opened.
 */
export function FeaturePanel() {
  const featurePanel = useAppStore((s) => s.featurePanel)

  if (!featurePanel) return null

  return <FeaturePanelInner key={featurePanel.feature.id} />
}

function FeaturePanelInner() {
  const featurePanel = useAppStore((s) => s.featurePanel)!
  const updateParam = useAppStore((s) => s.updateFeaturePanelParam)
  const commit = useAppStore((s) => s.commitFeaturePanel)
  const cancel = useAppStore((s) => s.cancelFeaturePanel)
  const isRebuilding = useAppStore((s) => s.isRebuilding)
  const startExtrudeFaceSelection = useAppStore((s) => s.startExtrudeFaceSelection)
  const allFeatures = useAppStore((s) => s.features)

  const { mode, feature } = featurePanel
  const params = getFullEditableParams(feature, allFeatures)

  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      firstInputRef.current?.focus()
      firstInputRef.current?.select()
    })
  }, [])

  // Escape to cancel, Enter to commit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancel()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [cancel])

  const handleParamChange = (param: ParamDef, rawValue: string) => {
    if (param.type === 'number') {
      const parsed = parseFloat(rawValue)
      if (isNaN(parsed)) return
      updateParam(param.key, parsed)
    } else if (param.type === 'select') {
      updateParam(param.key, rawValue)
    }
  }

  const handleButtonClick = (param: ButtonParamDef) => {
    if (param.key === 'selectFace') {
      startExtrudeFaceSelection()
    }
  }

  const title = mode === 'create'
    ? `New ${featureTypeLabel(feature.type)}`
    : `Edit ${featureTypeLabel(feature.type)}`

  return (
    <div className="fixed top-11 left-[268px] z-50">
      <div className="bg-[#1e1e3a] border border-[#3a3a5a] rounded-lg shadow-2xl w-[240px]">
        {/* Header */}
        <div className="px-3 py-2 border-b border-[#3a3a5a] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-300">{title}</h3>
          {isRebuilding && (
            <span className="text-[10px] text-yellow-400 animate-pulse">rebuilding...</span>
          )}
        </div>

        {/* Params */}
        <div className="px-3 py-2.5 space-y-2.5">
          {params.map((param, i) => (
            <ParamField
              key={param.key}
              param={param}
              inputRef={i === 0 ? firstInputRef : undefined}
              onChange={(v) => handleParamChange(param, v)}
              onButtonClick={() => param.type === 'button' && handleButtonClick(param)}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="px-3 py-2 border-t border-[#3a3a5a] flex justify-end gap-2">
          <button
            type="button"
            className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 rounded hover:bg-[#2a2a4a] transition-colors"
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-2.5 py-1 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            onClick={commit}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Parameter Field ────────────────────────────────────────

function ParamField({
  param,
  inputRef,
  onChange,
  onButtonClick,
}: {
  param: ParamDef
  inputRef?: React.Ref<HTMLInputElement>
  onChange: (value: string) => void
  onButtonClick?: () => void
}) {
  if (param.type === 'number') {
    return (
      <div>
        <label className="text-[11px] text-gray-500 block mb-0.5">{param.label}</label>
        <input
          ref={inputRef}
          type="number"
          className="w-full bg-[#12122a] text-gray-200 text-sm px-2 py-1.5 rounded border border-[#3a3a5a] outline-none focus:border-blue-500/50"
          defaultValue={param.value}
          min={param.min}
          max={param.max}
          step="any"
          onBlur={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onChange((e.target as HTMLInputElement).value)
            }
          }}
        />
      </div>
    )
  }

  if (param.type === 'button') {
    return (
      <div>
        <label className="text-[11px] text-gray-500 block mb-0.5">{param.label}</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-2.5 py-1.5 text-xs text-cyan-400 hover:text-cyan-300 bg-[#12122a] hover:bg-cyan-900/30 rounded border border-[#3a3a5a] transition-colors"
            onClick={onButtonClick}
          >
            {param.buttonLabel}
          </button>
          {param.statusText && (
            <span className="text-[10px] text-gray-500 truncate">{param.statusText}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="text-[11px] text-gray-500 block mb-0.5">{param.label}</label>
      <select
        className="w-full bg-[#12122a] text-gray-200 text-sm px-2 py-1.5 rounded border border-[#3a3a5a] outline-none focus:border-blue-500/50"
        value={param.value}
        onChange={(e) => onChange(e.target.value)}
      >
        {param.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

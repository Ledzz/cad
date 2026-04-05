import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { getEditableParams, featureTypeLabel } from '../engine/featureTypes'
import type { Feature } from '../engine/featureTypes'

/**
 * Modal dialog for editing a feature's numeric parameters.
 * Opened via double-click on the feature tree or the context menu.
 */
export function FeatureEditDialog() {
  const editingFeature = useAppStore((s) => s.editingFeature)
  const features = useAppStore((s) => s.features)
  const updateFeature = useAppStore((s) => s.updateFeature)
  const setEditingFeature = useAppStore((s) => s.setEditingFeature)

  if (!editingFeature) return null

  const feature = features.find((f) => f.id === editingFeature.featureId)
  if (!feature) return null

  return (
    <FeatureEditDialogInner
      feature={feature}
      onCommit={async (updates) => {
        await updateFeature(feature.id, updates)
        setEditingFeature(null)
      }}
      onCancel={() => setEditingFeature(null)}
    />
  )
}

// ─── Inner component (manages its own state) ────────────────

function FeatureEditDialogInner({
  feature,
  onCommit,
  onCancel,
}: {
  feature: Feature
  onCommit: (updates: Partial<Feature>) => Promise<void>
  onCancel: () => void
}) {
  const params = getEditableParams(feature)
  const paramKeys = Object.keys(params)

  // Local form state — initialize from current feature values
  const [values, setValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {}
    for (const [key, param] of Object.entries(params)) {
      v[key] = param.value
    }
    return v
  })
  const [submitting, setSubmitting] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstInputRef.current?.focus()
    firstInputRef.current?.select()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  if (paramKeys.length === 0) {
    // Nothing to edit (e.g., sketch features)
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onCommit(values as unknown as Partial<Feature>)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#1e1e3a] border border-[#3a3a5a] rounded-lg shadow-2xl w-[320px]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#3a3a5a] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            Edit {featureTypeLabel(feature.type)}
          </h3>
          <button
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            onClick={onCancel}
          >
            x
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-4 py-3 space-y-3">
          <div className="text-xs text-gray-500 mb-2">{feature.name}</div>

          {paramKeys.map((key, i) => {
            const param = params[key]
            return (
              <div key={key} className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-24 shrink-0">
                  {param.label}
                </label>
                <input
                  ref={i === 0 ? firstInputRef : undefined}
                  type="number"
                  className="flex-1 bg-[#12122a] text-gray-200 text-sm px-2 py-1 rounded border border-[#3a3a5a] outline-none focus:border-blue-500/50"
                  value={values[key]}
                  min={param.min}
                  step={param.step}
                  onChange={(e) =>
                    setValues({ ...values, [key]: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            )
          })}

          {/* Direction selector for extrude features */}
          {feature.type === 'extrude' && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400 w-24 shrink-0">
                Direction
              </label>
              <select
                className="flex-1 bg-[#12122a] text-gray-200 text-sm px-2 py-1 rounded border border-[#3a3a5a] outline-none focus:border-blue-500/50"
                value={(values as any).direction ?? feature.direction}
                onChange={(e) =>
                  setValues({ ...values, direction: e.target.value as any })
                }
              >
                <option value="normal">Normal</option>
                <option value="reverse">Reverse</option>
                <option value="symmetric">Symmetric</option>
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#3a3a5a]">
            <button
              type="button"
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded hover:bg-[#2a2a4a] transition-colors"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
            >
              {submitting ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

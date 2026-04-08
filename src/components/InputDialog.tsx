import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import type { NumberInputDialogState } from '../store/appStore'

/**
 * Positioned input dialog that replaces browser prompt() calls.
 * Appears in the top-left corner (below toolbar, to the right of the feature tree)
 * like Onshape's parameter panels.
 */
export function InputDialog() {
  const inputDialog = useAppStore((s) => s.inputDialog)

  if (!inputDialog) return null

  return <NumberInput dialog={inputDialog} />
}

// ─── Number Input ───────────────────────────────────────────

function NumberInput({ dialog }: { dialog: NumberInputDialogState }) {
  const closeInputDialog = useAppStore((s) => s.closeInputDialog)
  const [value, setValue] = useState(String(dialog.defaultValue))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Small delay to ensure the dialog is mounted before focusing
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseFloat(value)
    if (isNaN(parsed)) return
    dialog.resolve(parsed)
    closeInputDialog()
  }

  const handleCancel = () => {
    dialog.resolve(null)
    closeInputDialog()
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleCancel()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [])

  return (
    <div className="fixed top-11 left-52 z-50">
      <div className="bg-[#1e1e3a] border border-[#3a3a5a] rounded-lg shadow-2xl w-[220px]">
        <form onSubmit={handleSubmit} className="px-3 py-2.5 space-y-2">
          <label className="text-xs text-gray-400 block">{dialog.label}</label>
          <input
            ref={inputRef}
            type="number"
            className="w-full bg-[#12122a] text-gray-200 text-sm px-2 py-1.5 rounded border border-[#3a3a5a] outline-none focus:border-blue-500/50"
            value={value}
            step="any"
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 rounded hover:bg-[#2a2a4a] transition-colors"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-2.5 py-1 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >
              OK
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

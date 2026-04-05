import { useAppStore } from '../store/appStore'

export function FeatureTree() {
  const sceneObjects = useAppStore((s) => s.sceneObjects)
  const selection = useAppStore((s) => s.selection)
  const setSelection = useAppStore((s) => s.setSelection)

  const objectIds = Array.from(sceneObjects.keys())

  return (
    <div className="w-[260px] bg-[#16162a] border-r border-[#2a2a4a] flex flex-col shrink-0">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#2a2a4a]">
        Feature Tree
      </div>
      <div className="flex-1 py-1">
        {objectIds.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500 italic">No features yet</div>
        ) : (
          objectIds.map((id) => {
            const isSelected = selection.selectedIds.includes(id)
            return (
              <button
                key={id}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                  isSelected
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'text-gray-400 hover:bg-[#1e1e3a] hover:text-gray-300'
                }`}
                onClick={() => setSelection([id])}
              >
                <span className="w-3 h-3 rounded-sm bg-[#6688cc] shrink-0" />
                {id}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

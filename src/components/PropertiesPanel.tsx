import { useAppStore } from '../store/appStore'

export function PropertiesPanel() {
  const selection = useAppStore((s) => s.selection)
  const sceneObjects = useAppStore((s) => s.sceneObjects)
  const selectedIds = selection.selectedIds

  return (
    <div className="w-[260px] bg-[#16162a] border-l border-[#2a2a4a] flex flex-col shrink-0">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#2a2a4a]">
        Properties
      </div>
      <div className="flex-1 px-3 py-2 text-sm">
        {selectedIds.length === 0 ? (
          <div className="text-gray-500 italic">Nothing selected</div>
        ) : (
          <div className="space-y-3">
            <div className="text-gray-300 font-medium">
              {selectedIds.length === 1 ? selectedIds[0] : `${selectedIds.length} objects`}
            </div>
            {selectedIds.map((id) => {
              const geo = sceneObjects.get(id)
              if (!geo) return null
              const posAttr = geo.getAttribute('position')
              const vertCount = posAttr ? posAttr.count : 0
              const indexCount = geo.index ? geo.index.count : 0
              return (
                <div key={id} className="space-y-1">
                  <div className="text-xs text-gray-500">
                    <span className="text-gray-400">Vertices:</span> {vertCount}
                  </div>
                  <div className="text-xs text-gray-500">
                    <span className="text-gray-400">Triangles:</span> {indexCount / 3}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

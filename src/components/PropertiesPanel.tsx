import { useAppStore } from '../store/appStore'
import { featureTypeLabel, getEditableParams } from '../engine/featureTypes'

export function PropertiesPanel() {
  const selection = useAppStore((s) => s.selection)
  const sceneObjects = useAppStore((s) => s.sceneObjects)
  const features = useAppStore((s) => s.features)
  const setEditingFeature = useAppStore((s) => s.setEditingFeature)
  const selectedIds = selection.selectedIds

  return (
    <div className="w-[260px] bg-[#16162a] border-l border-[#2a2a4a] flex flex-col shrink-0">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-[#2a2a4a]">
        Properties
      </div>
      <div className="flex-1 px-3 py-2 text-sm overflow-y-auto">
        {selectedIds.length === 0 ? (
          <div className="text-gray-500 italic">Nothing selected</div>
        ) : (
          <div className="space-y-3">
            {selectedIds.map((id) => {
              const feature = features.find((f) => f.id === id)
              const geo = sceneObjects.get(id)

              return (
                <div key={id} className="space-y-2">
                  {/* Feature info */}
                  {feature ? (
                    <>
                      <div className="text-gray-300 font-medium">
                        {feature.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        <span className="text-gray-400">Type:</span>{' '}
                        {featureTypeLabel(feature.type)}
                      </div>
                      {feature.suppressed && (
                        <div className="text-xs text-yellow-500">Suppressed</div>
                      )}

                      {/* Show parameters */}
                      {(() => {
                        const params = getEditableParams(feature)
                        const keys = Object.keys(params)
                        if (keys.length === 0) return null
                        return (
                          <div className="space-y-1 pt-1 border-t border-[#2a2a4a]">
                            <div className="text-xs text-gray-400 font-medium">
                              Parameters
                            </div>
                            {keys.map((key) => (
                              <div key={key} className="text-xs text-gray-500 flex justify-between">
                                <span className="text-gray-400">
                                  {params[key].label}:
                                </span>
                                <span>{params[key].value}</span>
                              </div>
                            ))}
                            <button
                              className="mt-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                              onClick={() =>
                                setEditingFeature({ featureId: feature.id })
                              }
                            >
                              Edit...
                            </button>
                          </div>
                        )
                      })()}
                    </>
                  ) : (
                    <div className="text-gray-300 font-medium">{id}</div>
                  )}

                  {/* Geometry stats */}
                  {geo && (
                    <div className="space-y-1 pt-1 border-t border-[#2a2a4a]">
                      <div className="text-xs text-gray-400 font-medium">
                        Geometry
                      </div>
                      <div className="text-xs text-gray-500 flex justify-between">
                        <span className="text-gray-400">Vertices:</span>
                        <span>
                          {geo.getAttribute('position')?.count ?? 0}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 flex justify-between">
                        <span className="text-gray-400">Triangles:</span>
                        <span>
                          {geo.index ? geo.index.count / 3 : 0}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

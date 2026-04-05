import { useAppStore } from '../store/appStore'

const OBJECT_COLOR = '#6688cc'
const HOVER_COLOR = '#88aaee'
const SELECTED_COLOR = '#ffaa44'
const DIMMED_COLOR = '#334466'

/**
 * Renders all scene objects from the app store as Three.js meshes.
 * In sketch mode, objects are dimmed with transparency.
 */
export function SceneObjects() {
  const sceneObjects = useAppStore((s) => s.sceneObjects)
  const selection = useAppStore((s) => s.selection)
  const setHovered = useAppStore((s) => s.setHovered)
  const setSelection = useAppStore((s) => s.setSelection)
  const mode = useAppStore((s) => s.mode)

  const isSketchMode = mode === 'sketching'

  return (
    <>
      {Array.from(sceneObjects.entries()).map(([id, geometry]) => {
        const isSelected = selection.selectedIds.includes(id)
        const isHovered = selection.hoveredId === id

        const color = isSketchMode
          ? DIMMED_COLOR
          : isSelected
            ? SELECTED_COLOR
            : isHovered
              ? HOVER_COLOR
              : OBJECT_COLOR

        return (
          <mesh
            key={id}
            geometry={geometry}
            onPointerOver={(e) => {
              if (isSketchMode) return
              e.stopPropagation()
              setHovered(id)
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              if (isSketchMode) return
              setHovered(null)
              document.body.style.cursor = 'default'
            }}
            onClick={(e) => {
              if (isSketchMode) return
              e.stopPropagation()
              if (e.nativeEvent.shiftKey) {
                // Multi-select with Shift
                const newSelection = isSelected
                  ? selection.selectedIds.filter((s) => s !== id)
                  : [...selection.selectedIds, id]
                setSelection(newSelection)
              } else {
                setSelection([id])
              }
            }}
          >
            <meshStandardMaterial
              color={color}
              metalness={0.2}
              roughness={0.6}
              flatShading={false}
              transparent={isSketchMode}
              opacity={isSketchMode ? 0.25 : 1}
              depthWrite={!isSketchMode}
            />
          </mesh>
        )
      })}
    </>
  )
}

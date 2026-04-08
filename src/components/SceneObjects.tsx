import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useAppStore } from '../store/appStore'
import type { FaceRange } from '../engine/tessellation'

const OBJECT_COLOR = '#6688cc'
const HOVER_COLOR = '#88aaee'
const SELECTED_COLOR = '#ffaa44'
const DIMMED_COLOR = '#334466'
const FACE_HIGHLIGHT_COLOR = '#55ddaa'
const EDGE_COLOR = '#888888'
const EDGE_HOVER_COLOR = '#ffdd44'
const EDGE_SELECTED_COLOR = '#ff6644'

/**
 * Given a triangle index from a Three.js raycaster hit, find which OCCT face
 * it belongs to by searching the faceRanges.
 */
function findFaceFromTriIndex(triIndex: number, faceRanges: FaceRange[]): FaceRange | undefined {
  const idx = triIndex * 3 // faceRanges use index-buffer offsets (3 indices per triangle)
  return faceRanges.find((r) => idx >= r.startIndex && idx < r.startIndex + r.count)
}

/**
 * Build a BufferGeometry that contains only the triangles of a single face,
 * for use as a highlight overlay.
 */
function buildFaceHighlightGeometry(
  sourceGeometry: THREE.BufferGeometry,
  faceRange: FaceRange
): THREE.BufferGeometry {
  const positions = sourceGeometry.getAttribute('position') as THREE.BufferAttribute
  const normals = sourceGeometry.getAttribute('normal') as THREE.BufferAttribute
  const index = sourceGeometry.getIndex()

  if (!index) return new THREE.BufferGeometry()

  const indexArray = index.array
  const numIndices = faceRange.count
  const startIdx = faceRange.startIndex

  // Extract the relevant triangles into a new non-indexed geometry
  const newPositions = new Float32Array(numIndices * 3)
  const newNormals = new Float32Array(numIndices * 3)

  for (let i = 0; i < numIndices; i++) {
    const srcIdx = indexArray[startIdx + i]
    newPositions[i * 3] = positions.getX(srcIdx)
    newPositions[i * 3 + 1] = positions.getY(srcIdx)
    newPositions[i * 3 + 2] = positions.getZ(srcIdx)
    newNormals[i * 3] = normals.getX(srcIdx)
    newNormals[i * 3 + 1] = normals.getY(srcIdx)
    newNormals[i * 3 + 2] = normals.getZ(srcIdx)
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(newPositions, 3))
  geom.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3))
  return geom
}

/**
 * Component that renders a highlight overlay for a hovered face.
 */
function FaceHighlight({
  geometry,
  faceRange,
}: {
  geometry: THREE.BufferGeometry
  faceRange: FaceRange
}) {
  const highlightGeometry = useMemo(
    () => buildFaceHighlightGeometry(geometry, faceRange),
    [geometry, faceRange]
  )

  return (
    <mesh geometry={highlightGeometry} renderOrder={1}>
      <meshStandardMaterial
        color={FACE_HIGHLIGHT_COLOR}
        metalness={0.2}
        roughness={0.6}
        transparent
        opacity={0.6}
        depthTest={true}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

/**
 * Renders selectable edges as lines during edge selection mode.
 */
function EdgeSelectionOverlay() {
  const edgeSelection = useAppStore((s) => s.edgeSelection)
  const toggleEdgeSelection = useAppStore((s) => s.toggleEdgeSelection)
  const setHoveredEdge = useAppStore((s) => s.setHoveredEdge)

  if (!edgeSelection?.active) return null

  return (
    <>
      {edgeSelection.edges.map((edgePoints, idx) => {
        // Convert flat array to [x,y,z] tuples
        const points: [number, number, number][] = []
        for (let i = 0; i < edgePoints.length; i += 3) {
          points.push([edgePoints[i], edgePoints[i + 1], edgePoints[i + 2]])
        }
        if (points.length < 2) return null

        const isSelected = edgeSelection.selectedEdgeIndices.includes(idx)
        const isHovered = edgeSelection.hoveredEdgeIndex === idx
        const color = isSelected ? EDGE_SELECTED_COLOR : isHovered ? EDGE_HOVER_COLOR : EDGE_COLOR
        const lineWidth = isSelected ? 3 : isHovered ? 2.5 : 1.5

        return (
          <Line
            key={idx}
            points={points}
            color={color}
            lineWidth={lineWidth}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHoveredEdge(idx)
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              setHoveredEdge(null)
              document.body.style.cursor = 'crosshair'
            }}
            onClick={(e) => {
              e.stopPropagation()
              toggleEdgeSelection(idx)
            }}
          />
        )
      })}
    </>
  )
}

/**
 * Renders all scene objects from the app store as Three.js meshes.
 * In sketch mode, objects are dimmed with transparency.
 * In face selection mode, individual faces can be hovered and clicked.
 */
export function SceneObjects() {
  const sceneObjects = useAppStore((s) => s.sceneObjects)
  const selection = useAppStore((s) => s.selection)
  const setHovered = useAppStore((s) => s.setHovered)
  const setSelection = useAppStore((s) => s.setSelection)
  const mode = useAppStore((s) => s.mode)
  const selectingSketchFace = useAppStore((s) => s.selectingSketchFace)
  const hoveredFace = useAppStore((s) => s.hoveredFace)
  const setHoveredFace = useAppStore((s) => s.setHoveredFace)
  const selectFaceForSketch = useAppStore((s) => s.selectFaceForSketch)
  const edgeSelection = useAppStore((s) => s.edgeSelection)

  const isSketchMode = mode === 'sketching'
  const isFaceSelectionMode = selectingSketchFace && !isSketchMode
  const isEdgeSelectionMode = edgeSelection?.active ?? false

  return (
    <>
      {Array.from(sceneObjects.entries()).map(([id, geometry]) => {
        const isSelected = selection.selectedIds.includes(id)
        const isHovered = selection.hoveredId === id
        const faceRanges = geometry.userData?.faceRanges as FaceRange[] | undefined

        // In face selection mode, show normal object color (slightly desaturated)
        const color = isSketchMode
          ? DIMMED_COLOR
          : isEdgeSelectionMode
            ? OBJECT_COLOR
            : isFaceSelectionMode
              ? OBJECT_COLOR
              : isSelected
                ? SELECTED_COLOR
                : isHovered
                  ? HOVER_COLOR
                  : OBJECT_COLOR

        // Check if this object has a hovered face
        const hoveredFaceRange =
          isFaceSelectionMode && hoveredFace?.featureId === id && faceRanges
            ? faceRanges.find((r) => r.faceIndex === hoveredFace.faceIndex)
            : undefined

        return (
          <group key={id}>
            <mesh
              geometry={geometry}
              onPointerOver={(e) => {
                if (isSketchMode) return
                e.stopPropagation()

                if (isFaceSelectionMode) {
                  // Face-level hover
                  if (faceRanges && e.faceIndex != null) {
                    const face = findFaceFromTriIndex(e.faceIndex, faceRanges)
                    if (face) {
                      setHoveredFace({ featureId: id, faceIndex: face.faceIndex })
                    }
                  }
                  document.body.style.cursor = 'crosshair'
                } else {
                  setHovered(id)
                  document.body.style.cursor = 'pointer'
                }
              }}
              onPointerMove={(e) => {
                // Update face hover as pointer moves across the mesh
                if (!isFaceSelectionMode || !faceRanges || e.faceIndex == null) return
                e.stopPropagation()
                const face = findFaceFromTriIndex(e.faceIndex, faceRanges)
                if (face) {
                  const currentHover = useAppStore.getState().hoveredFace
                  if (!currentHover || currentHover.featureId !== id || currentHover.faceIndex !== face.faceIndex) {
                    setHoveredFace({ featureId: id, faceIndex: face.faceIndex })
                  }
                }
              }}
              onPointerOut={() => {
                if (isSketchMode) return
                if (isFaceSelectionMode) {
                  setHoveredFace(null)
                  document.body.style.cursor = 'crosshair'
                } else {
                  setHovered(null)
                  document.body.style.cursor = 'default'
                }
              }}
              onClick={(e) => {
                if (isSketchMode) return
                e.stopPropagation()

                if (isFaceSelectionMode) {
                  // Face-level selection
                  if (faceRanges && e.faceIndex != null) {
                    const face = findFaceFromTriIndex(e.faceIndex, faceRanges)
                    if (face) {
                      selectFaceForSketch(id, face.faceIndex)
                    }
                  }
                } else {
                  if (e.nativeEvent.shiftKey) {
                    const newSelection = isSelected
                      ? selection.selectedIds.filter((s) => s !== id)
                      : [...selection.selectedIds, id]
                    setSelection(newSelection)
                  } else {
                    setSelection([id])
                  }
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

            {/* Face highlight overlay */}
            {hoveredFaceRange && (
              <FaceHighlight geometry={geometry} faceRange={hoveredFaceRange} />
            )}
          </group>
        )
      })}
      {/* Edge selection overlay */}
      <EdgeSelectionOverlay />
    </>
  )
}

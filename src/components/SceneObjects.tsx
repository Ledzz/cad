import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useAppStore } from '../store/appStore'
import type { FaceRange } from '../engine/tessellation'
import type { MeasurementPicking } from '../store/appStore'

const OBJECT_COLOR = '#6688cc'
const HOVER_COLOR = '#88aaee'
const SELECTED_COLOR = '#ffaa44'
const DIMMED_COLOR = '#334466'
const FACE_HIGHLIGHT_COLOR = '#55ddaa'
const EDGE_COLOR = '#888888'
const EDGE_HOVER_COLOR = '#ffdd44'
const EDGE_SELECTED_COLOR = '#ff6644'
const BREP_EDGE_COLOR = '#222233'

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
 * Renders B-Rep edges overlaid on shaded surfaces ("shaded with edges" mode).
 * Edge polylines come from OCCT tessellation data stored in geometry.userData.
 */
function BRepEdgeOverlay({ geometry }: { geometry: THREE.BufferGeometry }) {
  const edgePolylines = geometry.userData?.edgePolylines as number[][] | undefined
  if (!edgePolylines || edgePolylines.length === 0) return null

  return (
    <>
      {edgePolylines.map((flat, idx) => {
        const points: [number, number, number][] = []
        for (let i = 0; i < flat.length; i += 3) {
          points.push([flat[i], flat[i + 1], flat[i + 2]])
        }
        if (points.length < 2) return null
        return (
          <Line
            key={idx}
            points={points}
            color={BREP_EDGE_COLOR}
            lineWidth={1}
            depthTest
            renderOrder={2}
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
  const showEdges = useAppStore((s) => s.showEdges)
  const measurementMode = useAppStore((s) => s.measurementMode)
  const measurementPicking = useAppStore((s) => s.measurementPicking)
  const addMeasurement = useAppStore((s) => s.addMeasurement)
  const setMeasurementPicking = useAppStore((s) => s.setMeasurementPicking)
  const setMeasurementMode = useAppStore((s) => s.setMeasurementMode)

  const isSketchMode = mode === 'sketching'
  const isFaceSelectionMode = selectingSketchFace && !isSketchMode
  const isEdgeSelectionMode = edgeSelection?.active ?? false
  const isMeasurementMode = measurementMode !== null && !isSketchMode

  /** Handle measurement picks */
  const handleMeasurementClick = async (
    e: any,
    featureId: string,
    geometry: THREE.BufferGeometry,
    faceRanges: FaceRange[] | undefined
  ) => {
    if (!measurementMode) return

    if (measurementMode === 'point-to-point') {
      const point: [number, number, number] = [e.point.x, e.point.y, e.point.z]
      if (!measurementPicking?.firstPoint) {
        setMeasurementPicking({ firstPoint: point })
      } else {
        const p1 = measurementPicking.firstPoint
        const dx = point[0] - p1[0]
        const dy = point[1] - p1[1]
        const dz = point[2] - p1[2]
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
        addMeasurement({ type: 'point-to-point', p1, p2: point, distance })
        setMeasurementMode(null)
      }
    } else if (measurementMode === 'edge-length') {
      // Edge-length measurement: find the nearest edge from edgePolylines
      const edgePolylines = geometry.userData?.edgePolylines as number[][] | undefined
      if (!edgePolylines || edgePolylines.length === 0) return

      // Find closest edge to click point
      const clickPt = e.point as THREE.Vector3
      let bestEdgeIdx = 0
      let bestDist = Infinity
      for (let ei = 0; ei < edgePolylines.length; ei++) {
        const flat = edgePolylines[ei]
        for (let i = 0; i < flat.length; i += 3) {
          const dx = flat[i] - clickPt.x
          const dy = flat[i + 1] - clickPt.y
          const dz = flat[i + 2] - clickPt.z
          const d = dx * dx + dy * dy + dz * dz
          if (d < bestDist) { bestDist = d; bestEdgeIdx = ei }
        }
      }

      try {
        const { getOccApi } = await import('../workers/occApi')
        const api = await getOccApi()
        const length = await api.getEdgeLength(featureId, bestEdgeIdx)
        const midpoint = await api.getEdgeMidpoint(featureId, bestEdgeIdx)
        addMeasurement({ type: 'edge-length', midpoint: midpoint as [number, number, number], length })
        setMeasurementMode(null)
      } catch (err) {
        console.error('[Measurement] Edge length failed:', err)
      }
    } else if (measurementMode === 'face-angle') {
      if (!faceRanges || e.faceIndex == null) return
      const face = findFaceFromTriIndex(e.faceIndex, faceRanges)
      if (!face) return

      try {
        const { getOccApi } = await import('../workers/occApi')
        const api = await getOccApi()
        const centroid = await api.getFaceCentroid(featureId, face.faceIndex)

        if (!measurementPicking?.firstFace) {
          setMeasurementPicking({
            firstFace: {
              shapeId: featureId,
              faceIndex: face.faceIndex,
              centroid: centroid as [number, number, number],
            },
          })
        } else {
          const angle = await api.getAngleBetweenFaces(
            measurementPicking.firstFace.shapeId,
            measurementPicking.firstFace.faceIndex,
            face.faceIndex
          )
          addMeasurement({
            type: 'face-angle',
            centroid1: measurementPicking.firstFace.centroid,
            centroid2: centroid as [number, number, number],
            angle,
          })
          setMeasurementMode(null)
        }
      } catch (err) {
        console.error('[Measurement] Face angle failed:', err)
      }
    }
  }

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
                } else if (isMeasurementMode) {
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

                if (isMeasurementMode) {
                  handleMeasurementClick(e, id, geometry, faceRanges)
                  return
                }

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

            {/* B-Rep edge overlay (shaded with edges mode) */}
            {showEdges && !isSketchMode && (
              <BRepEdgeOverlay geometry={geometry} />
            )}
          </group>
        )
      })}
      {/* Edge selection overlay */}
      <EdgeSelectionOverlay />
    </>
  )
}

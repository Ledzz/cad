import { Text, Line } from '@react-three/drei'
import { useAppStore } from '../store/appStore'
import type { Measurement } from '../store/appStore'

const MEASURE_COLOR = '#ff8844'
const MEASURE_TEXT_COLOR = '#ffcc88'

function PointToPointAnnotation({ m }: { m: Measurement & { type: 'point-to-point' } }) {
  const mid: [number, number, number] = [
    (m.p1[0] + m.p2[0]) / 2,
    (m.p1[1] + m.p2[1]) / 2,
    (m.p1[2] + m.p2[2]) / 2,
  ]

  return (
    <>
      <Line
        points={[m.p1, m.p2]}
        color={MEASURE_COLOR}
        lineWidth={2}
        dashed
        dashSize={0.3}
        gapSize={0.15}
      />
      {/* Endpoints */}
      <mesh position={m.p1}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial color={MEASURE_COLOR} />
      </mesh>
      <mesh position={m.p2}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshBasicMaterial color={MEASURE_COLOR} />
      </mesh>
      {/* Label */}
      <Text
        position={[mid[0], mid[1] + 0.5, mid[2]]}
        fontSize={0.5}
        color={MEASURE_TEXT_COLOR}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.04}
        outlineColor="#000000"
      >
        {m.distance.toFixed(2)} mm
      </Text>
    </>
  )
}

function EdgeLengthAnnotation({ m }: { m: Measurement & { type: 'edge-length' } }) {
  return (
    <Text
      position={[m.midpoint[0], m.midpoint[1] + 0.5, m.midpoint[2]]}
      fontSize={0.5}
      color={MEASURE_TEXT_COLOR}
      anchorX="center"
      anchorY="bottom"
      outlineWidth={0.04}
      outlineColor="#000000"
    >
      L: {m.length.toFixed(2)} mm
    </Text>
  )
}

function FaceAngleAnnotation({ m }: { m: Measurement & { type: 'face-angle' } }) {
  const mid: [number, number, number] = [
    (m.centroid1[0] + m.centroid2[0]) / 2,
    (m.centroid1[1] + m.centroid2[1]) / 2 + 0.5,
    (m.centroid1[2] + m.centroid2[2]) / 2,
  ]

  return (
    <>
      <Line
        points={[m.centroid1, m.centroid2]}
        color={MEASURE_COLOR}
        lineWidth={1.5}
        dashed
        dashSize={0.3}
        gapSize={0.15}
      />
      <Text
        position={mid}
        fontSize={0.5}
        color={MEASURE_TEXT_COLOR}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.04}
        outlineColor="#000000"
      >
        {m.angle.toFixed(1)}°
      </Text>
    </>
  )
}

/**
 * Renders measurement annotations (distances, lengths, angles) in the 3D scene.
 */
export function MeasurementOverlay() {
  const measurements = useAppStore((s) => s.measurements)

  if (measurements.length === 0) return null

  return (
    <>
      {measurements.map((m, idx) => {
        switch (m.type) {
          case 'point-to-point':
            return <PointToPointAnnotation key={idx} m={m} />
          case 'edge-length':
            return <EdgeLengthAnnotation key={idx} m={m} />
          case 'face-angle':
            return <FaceAngleAnnotation key={idx} m={m} />
        }
      })}
    </>
  )
}

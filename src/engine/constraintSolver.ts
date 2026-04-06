/**
 * Gauss-Newton constraint solver for the 2D sketch system.
 *
 * The solver collects all free point coordinates into a variable vector,
 * computes residuals and Jacobians for each constraint, then iterates
 * using Levenberg-Marquardt damped Gauss-Newton to minimize the total
 * constraint error.
 *
 * All linear algebra is implemented inline — sketch sizes are small
 * enough (<200 variables) that no external library is needed.
 */

import type {
  SketchEntity,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchConstraint,
  ConstraintStatus,
} from './sketchTypes'

// ─── Configuration ──────────────────────────────────────────

const MAX_ITERATIONS = 100
const CONVERGENCE_TOLERANCE = 1e-10
const LAMBDA_INITIAL = 1e-3
const LAMBDA_FACTOR = 10
const LAMBDA_MAX = 1e8

// ─── Solver Result ──────────────────────────────────────────

export interface SolverResult {
  /** Updated point positions: Map<pointId, {x, y}> */
  pointUpdates: Map<string, { x: number; y: number }>
  /** Constraint status */
  status: ConstraintStatus
}

// ─── Variable Mapping ───────────────────────────────────────

interface VarMap {
  /** Map from point ID to index in the variable vector (x is at index, y is at index+1) */
  pointIndex: Map<string, number>
  /** Total number of variables */
  numVars: number
  /** The variable vector */
  vars: Float64Array
}

function buildVarMap(
  entities: Map<string, SketchEntity>,
  fixedPointIds?: Set<string>
): VarMap {
  const pointIndex = new Map<string, number>()
  let idx = 0
  const points: SketchPoint[] = []

  for (const entity of entities.values()) {
    if (entity.type === 'point' && !fixedPointIds?.has(entity.id)) {
      pointIndex.set(entity.id, idx)
      points.push(entity)
      idx += 2
    }
  }

  const vars = new Float64Array(idx)
  for (const pt of points) {
    const i = pointIndex.get(pt.id)!
    vars[i] = pt.x
    vars[i + 1] = pt.y
  }

  return { pointIndex, numVars: idx, vars }
}

// ─── Point helpers ──────────────────────────────────────────

function getPointCoords(
  pointId: string,
  varMap: VarMap,
  entities: Map<string, SketchEntity>
): { x: number; y: number; varIdx: number } {
  const vi = varMap.pointIndex.get(pointId)
  if (vi !== undefined) {
    return { x: varMap.vars[vi], y: varMap.vars[vi + 1], varIdx: vi }
  }
  // Fixed point — read from entities
  const pt = entities.get(pointId) as SketchPoint | undefined
  if (!pt) return { x: 0, y: 0, varIdx: -1 }
  return { x: pt.x, y: pt.y, varIdx: -1 }
}

// ─── Residual + Jacobian computation ────────────────────────

interface ResidualEntry {
  value: number
  /** Sparse Jacobian: list of (variable_index, derivative) */
  jacobian: Array<{ varIdx: number; deriv: number }>
}

function computeResiduals(
  constraints: SketchConstraint[],
  varMap: VarMap,
  entities: Map<string, SketchEntity>
): ResidualEntry[] {
  const residuals: ResidualEntry[] = []

  for (const c of constraints) {
    switch (c.type) {
      case 'coincident': {
        const p1 = getPointCoords(c.pointId1, varMap, entities)
        const p2 = getPointCoords(c.pointId2, varMap, entities)

        // r1 = p1.x - p2.x, r2 = p1.y - p2.y
        const j1: ResidualEntry['jacobian'] = []
        const j2: ResidualEntry['jacobian'] = []
        if (p1.varIdx >= 0) { j1.push({ varIdx: p1.varIdx, deriv: 1 }); j2.push({ varIdx: p1.varIdx + 1, deriv: 1 }) }
        if (p2.varIdx >= 0) { j1.push({ varIdx: p2.varIdx, deriv: -1 }); j2.push({ varIdx: p2.varIdx + 1, deriv: -1 }) }

        residuals.push({ value: p1.x - p2.x, jacobian: j1 })
        residuals.push({ value: p1.y - p2.y, jacobian: j2 })
        break
      }

      case 'horizontal': {
        // Two points must have same Y
        const pIds = getLinePoints(c, entities)
        if (!pIds) break
        const p1 = getPointCoords(pIds[0], varMap, entities)
        const p2 = getPointCoords(pIds[1], varMap, entities)

        const j: ResidualEntry['jacobian'] = []
        if (p1.varIdx >= 0) j.push({ varIdx: p1.varIdx + 1, deriv: 1 })
        if (p2.varIdx >= 0) j.push({ varIdx: p2.varIdx + 1, deriv: -1 })
        residuals.push({ value: p1.y - p2.y, jacobian: j })
        break
      }

      case 'vertical': {
        // Two points must have same X
        const pIds = getLinePoints(c, entities)
        if (!pIds) break
        const p1 = getPointCoords(pIds[0], varMap, entities)
        const p2 = getPointCoords(pIds[1], varMap, entities)

        const j: ResidualEntry['jacobian'] = []
        if (p1.varIdx >= 0) j.push({ varIdx: p1.varIdx, deriv: 1 })
        if (p2.varIdx >= 0) j.push({ varIdx: p2.varIdx, deriv: -1 })
        residuals.push({ value: p1.x - p2.x, jacobian: j })
        break
      }

      case 'fixed': {
        const p = getPointCoords(c.pointId, varMap, entities)

        const jx: ResidualEntry['jacobian'] = []
        const jy: ResidualEntry['jacobian'] = []
        if (p.varIdx >= 0) { jx.push({ varIdx: p.varIdx, deriv: 1 }); jy.push({ varIdx: p.varIdx + 1, deriv: 1 }) }
        residuals.push({ value: p.x - c.x, jacobian: jx })
        residuals.push({ value: p.y - c.y, jacobian: jy })
        break
      }

      case 'distance': {
        const p1 = getPointCoords(c.pointId1, varMap, entities)
        const p2 = getPointCoords(c.pointId2, varMap, entities)

        const dx = p1.x - p2.x
        const dy = p1.y - p2.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const r = dist - c.value

        if (dist < 1e-12) {
          // Degenerate: push apart in an arbitrary direction
          const j: ResidualEntry['jacobian'] = []
          if (p1.varIdx >= 0) j.push({ varIdx: p1.varIdx, deriv: 1 })
          if (p2.varIdx >= 0) j.push({ varIdx: p2.varIdx, deriv: -1 })
          residuals.push({ value: -c.value, jacobian: j })
        } else {
          const nx = dx / dist
          const ny = dy / dist
          const j: ResidualEntry['jacobian'] = []
          if (p1.varIdx >= 0) { j.push({ varIdx: p1.varIdx, deriv: nx }); j.push({ varIdx: p1.varIdx + 1, deriv: ny }) }
          if (p2.varIdx >= 0) { j.push({ varIdx: p2.varIdx, deriv: -nx }); j.push({ varIdx: p2.varIdx + 1, deriv: -ny }) }
          residuals.push({ value: r, jacobian: j })
        }
        break
      }

      case 'horizontalDistance': {
        const p1 = getPointCoords(c.pointId1, varMap, entities)
        const p2 = getPointCoords(c.pointId2, varMap, entities)

        // r = (p2.x - p1.x) - value
        const j: ResidualEntry['jacobian'] = []
        if (p2.varIdx >= 0) j.push({ varIdx: p2.varIdx, deriv: 1 })
        if (p1.varIdx >= 0) j.push({ varIdx: p1.varIdx, deriv: -1 })
        residuals.push({ value: (p2.x - p1.x) - c.value, jacobian: j })
        break
      }

      case 'verticalDistance': {
        const p1 = getPointCoords(c.pointId1, varMap, entities)
        const p2 = getPointCoords(c.pointId2, varMap, entities)

        const j: ResidualEntry['jacobian'] = []
        if (p2.varIdx >= 0) j.push({ varIdx: p2.varIdx + 1, deriv: 1 })
        if (p1.varIdx >= 0) j.push({ varIdx: p1.varIdx + 1, deriv: -1 })
        residuals.push({ value: (p2.y - p1.y) - c.value, jacobian: j })
        break
      }

      case 'angle': {
        const line1 = entities.get(c.lineId1) as SketchLine | undefined
        const line2 = entities.get(c.lineId2) as SketchLine | undefined
        if (!line1 || !line2) break

        const l1s = getPointCoords(line1.startPointId, varMap, entities)
        const l1e = getPointCoords(line1.endPointId, varMap, entities)
        const l2s = getPointCoords(line2.startPointId, varMap, entities)
        const l2e = getPointCoords(line2.endPointId, varMap, entities)

        const d1x = l1e.x - l1s.x
        const d1y = l1e.y - l1s.y
        const d2x = l2e.x - l2s.x
        const d2y = l2e.y - l2s.y

        const targetRad = c.value * Math.PI / 180
        const dot = d1x * d2x + d1y * d2y
        const cross = d1x * d2y - d1y * d2x
        const angle = Math.atan2(cross, dot)

        // Normalize the difference to [-pi, pi]
        let diff = angle - targetRad
        while (diff > Math.PI) diff -= 2 * Math.PI
        while (diff < -Math.PI) diff += 2 * Math.PI

        // Derivatives of atan2(cross, dot) w.r.t. the 8 point coordinates
        const denom = dot * dot + cross * cross
        if (denom < 1e-20) break

        const j: ResidualEntry['jacobian'] = []
        // d(angle)/d(l1s.x) = d(angle)/d(d1x) * d(d1x)/d(l1s.x) = ...
        // d(atan2(cross,dot))/d(d1x) = (dot * d(cross)/d(d1x) - cross * d(dot)/d(d1x)) / denom
        // d(cross)/d(d1x) = d2y, d(dot)/d(d1x) = d2x
        const da_d1x = (dot * d2y - cross * d2x) / denom
        const da_d1y = (dot * (-d2x) - cross * d2y) / denom  // d(cross)/d(d1y) = -d2x, d(dot)/d(d1y) = d2y
        const da_d2x = (dot * (-d1y) - cross * d1x) / denom  // d(cross)/d(d2x) = -d1y, d(dot)/d(d2x) = d1x
        const da_d2y = (dot * d1x - cross * d1y) / denom      // d(cross)/d(d2y) = d1x, d(dot)/d(d2y) = d1y

        // d1 = l1e - l1s, so d(d1x)/d(l1s.x) = -1, d(d1x)/d(l1e.x) = +1
        if (l1s.varIdx >= 0) { j.push({ varIdx: l1s.varIdx, deriv: -da_d1x }); j.push({ varIdx: l1s.varIdx + 1, deriv: -da_d1y }) }
        if (l1e.varIdx >= 0) { j.push({ varIdx: l1e.varIdx, deriv: da_d1x }); j.push({ varIdx: l1e.varIdx + 1, deriv: da_d1y }) }
        if (l2s.varIdx >= 0) { j.push({ varIdx: l2s.varIdx, deriv: -da_d2x }); j.push({ varIdx: l2s.varIdx + 1, deriv: -da_d2y }) }
        if (l2e.varIdx >= 0) { j.push({ varIdx: l2e.varIdx, deriv: da_d2x }); j.push({ varIdx: l2e.varIdx + 1, deriv: da_d2y }) }

        residuals.push({ value: diff, jacobian: j })
        break
      }

      case 'perpendicular': {
        const line1 = entities.get(c.lineId1) as SketchLine | undefined
        const line2 = entities.get(c.lineId2) as SketchLine | undefined
        if (!line1 || !line2) break

        const l1s = getPointCoords(line1.startPointId, varMap, entities)
        const l1e = getPointCoords(line1.endPointId, varMap, entities)
        const l2s = getPointCoords(line2.startPointId, varMap, entities)
        const l2e = getPointCoords(line2.endPointId, varMap, entities)

        const d1x = l1e.x - l1s.x, d1y = l1e.y - l1s.y
        const d2x = l2e.x - l2s.x, d2y = l2e.y - l2s.y

        // Normalize: dot / (|d1| * |d2|) = 0
        const len1 = Math.sqrt(d1x * d1x + d1y * d1y)
        const len2 = Math.sqrt(d2x * d2x + d2y * d2y)
        const normFactor = len1 * len2
        if (normFactor < 1e-12) break

        // r = dot(d1, d2) / (|d1| * |d2|)
        const dot = d1x * d2x + d1y * d2y
        const r = dot / normFactor

        // Jacobian of normalized dot product
        const j: ResidualEntry['jacobian'] = []
        // dr/d(d1x) = (d2x * normFactor - dot * (d1x/len1) * len2) / normFactor^2
        //           = d2x / normFactor - dot * d1x / (len1^2 * normFactor)
        const drd1x = d2x / normFactor - dot * d1x / (len1 * len1 * normFactor)
        const drd1y = d2y / normFactor - dot * d1y / (len1 * len1 * normFactor)
        const drd2x = d1x / normFactor - dot * d2x / (len2 * len2 * normFactor)
        const drd2y = d1y / normFactor - dot * d2y / (len2 * len2 * normFactor)

        if (l1s.varIdx >= 0) { j.push({ varIdx: l1s.varIdx, deriv: -drd1x }); j.push({ varIdx: l1s.varIdx + 1, deriv: -drd1y }) }
        if (l1e.varIdx >= 0) { j.push({ varIdx: l1e.varIdx, deriv: drd1x }); j.push({ varIdx: l1e.varIdx + 1, deriv: drd1y }) }
        if (l2s.varIdx >= 0) { j.push({ varIdx: l2s.varIdx, deriv: -drd2x }); j.push({ varIdx: l2s.varIdx + 1, deriv: -drd2y }) }
        if (l2e.varIdx >= 0) { j.push({ varIdx: l2e.varIdx, deriv: drd2x }); j.push({ varIdx: l2e.varIdx + 1, deriv: drd2y }) }

        residuals.push({ value: r, jacobian: j })
        break
      }

      case 'parallel': {
        const line1 = entities.get(c.lineId1) as SketchLine | undefined
        const line2 = entities.get(c.lineId2) as SketchLine | undefined
        if (!line1 || !line2) break

        const l1s = getPointCoords(line1.startPointId, varMap, entities)
        const l1e = getPointCoords(line1.endPointId, varMap, entities)
        const l2s = getPointCoords(line2.startPointId, varMap, entities)
        const l2e = getPointCoords(line2.endPointId, varMap, entities)

        const d1x = l1e.x - l1s.x, d1y = l1e.y - l1s.y
        const d2x = l2e.x - l2s.x, d2y = l2e.y - l2s.y

        // Normalize: cross / (|d1| * |d2|) = 0
        const len1 = Math.sqrt(d1x * d1x + d1y * d1y)
        const len2 = Math.sqrt(d2x * d2x + d2y * d2y)
        const normFactor = len1 * len2
        if (normFactor < 1e-12) break

        const cross = d1x * d2y - d1y * d2x
        const r = cross / normFactor

        const j: ResidualEntry['jacobian'] = []
        // dr/d(d1x) = (d2y * normFactor - cross * (d1x/len1) * len2) / normFactor^2
        const drd1x = d2y / normFactor - cross * d1x / (len1 * len1 * normFactor)
        const drd1y = -d2x / normFactor - cross * d1y / (len1 * len1 * normFactor)
        const drd2x = -d1y / normFactor - cross * d2x / (len2 * len2 * normFactor)
        const drd2y = d1x / normFactor - cross * d2y / (len2 * len2 * normFactor)

        if (l1s.varIdx >= 0) { j.push({ varIdx: l1s.varIdx, deriv: -drd1x }); j.push({ varIdx: l1s.varIdx + 1, deriv: -drd1y }) }
        if (l1e.varIdx >= 0) { j.push({ varIdx: l1e.varIdx, deriv: drd1x }); j.push({ varIdx: l1e.varIdx + 1, deriv: drd1y }) }
        if (l2s.varIdx >= 0) { j.push({ varIdx: l2s.varIdx, deriv: -drd2x }); j.push({ varIdx: l2s.varIdx + 1, deriv: -drd2y }) }
        if (l2e.varIdx >= 0) { j.push({ varIdx: l2e.varIdx, deriv: drd2x }); j.push({ varIdx: l2e.varIdx + 1, deriv: drd2y }) }

        residuals.push({ value: r, jacobian: j })
        break
      }

      case 'equal': {
        const e1 = entities.get(c.entityId1)
        const e2 = entities.get(c.entityId2)
        if (!e1 || !e2) break

        if (e1.type === 'line' && e2.type === 'line') {
          // Equal length: |l1| - |l2| = 0
          const l1s = getPointCoords(e1.startPointId, varMap, entities)
          const l1e = getPointCoords(e1.endPointId, varMap, entities)
          const l2s = getPointCoords(e2.startPointId, varMap, entities)
          const l2e = getPointCoords(e2.endPointId, varMap, entities)

          const d1x = l1e.x - l1s.x, d1y = l1e.y - l1s.y
          const d2x = l2e.x - l2s.x, d2y = l2e.y - l2s.y
          const len1 = Math.sqrt(d1x * d1x + d1y * d1y)
          const len2 = Math.sqrt(d2x * d2x + d2y * d2y)

          // Use squared difference for better numerical behavior
          // r = (len1^2 - len2^2) normalized
          const r = len1 - len2

          const j: ResidualEntry['jacobian'] = []
          if (len1 > 1e-12) {
            const nx1 = d1x / len1, ny1 = d1y / len1
            if (l1s.varIdx >= 0) { j.push({ varIdx: l1s.varIdx, deriv: -nx1 }); j.push({ varIdx: l1s.varIdx + 1, deriv: -ny1 }) }
            if (l1e.varIdx >= 0) { j.push({ varIdx: l1e.varIdx, deriv: nx1 }); j.push({ varIdx: l1e.varIdx + 1, deriv: ny1 }) }
          }
          if (len2 > 1e-12) {
            const nx2 = d2x / len2, ny2 = d2y / len2
            if (l2s.varIdx >= 0) { j.push({ varIdx: l2s.varIdx, deriv: nx2 }); j.push({ varIdx: l2s.varIdx + 1, deriv: ny2 }) }
            if (l2e.varIdx >= 0) { j.push({ varIdx: l2e.varIdx, deriv: -nx2 }); j.push({ varIdx: l2e.varIdx + 1, deriv: -ny2 }) }
          }

          residuals.push({ value: r, jacobian: j })
        } else if (e1.type === 'circle' && e2.type === 'circle') {
          // Equal radius: radius1 - radius2 = 0
          // Circle radii are not solver variables (they're stored on the entity),
          // but the distance from center to a point on the circle is what we constrain.
          // For now, simply set: r = e1.radius - e2.radius (no variables to solve)
          residuals.push({ value: e1.radius - e2.radius, jacobian: [] })
        }
        break
      }

      case 'radius': {
        const entity = entities.get(c.entityId)
        if (!entity) break

        if (entity.type === 'circle') {
          // Circle radius is stored directly — r = circle.radius - c.value
          // This is a parameter constraint, not a geometric one in our current model.
          // For circles, the radius is a direct property, so the residual has no solver variables.
          residuals.push({ value: entity.radius - c.value, jacobian: [] })
        } else if (entity.type === 'arc') {
          // Arc: constrain distance from center to start point = c.value
          const center = getPointCoords(entity.centerPointId, varMap, entities)
          const start = getPointCoords(entity.startPointId, varMap, entities)
          const dx = start.x - center.x
          const dy = start.y - center.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const r = dist - c.value

          if (dist < 1e-12) {
            residuals.push({ value: -c.value, jacobian: [] })
          } else {
            const nx = dx / dist, ny = dy / dist
            const j: ResidualEntry['jacobian'] = []
            if (start.varIdx >= 0) { j.push({ varIdx: start.varIdx, deriv: nx }); j.push({ varIdx: start.varIdx + 1, deriv: ny }) }
            if (center.varIdx >= 0) { j.push({ varIdx: center.varIdx, deriv: -nx }); j.push({ varIdx: center.varIdx + 1, deriv: -ny }) }
            residuals.push({ value: r, jacobian: j })
          }
        }
        break
      }

      case 'tangent': {
        const e1 = entities.get(c.entityId1)
        const e2 = entities.get(c.entityId2)
        if (!e1 || !e2) break

        if (e1.type === 'line' && (e2.type === 'circle' || e2.type === 'arc')) {
          // Distance from line to circle center = radius
          addLineTangentResiduals(e1, e2, varMap, entities, residuals)
        } else if ((e1.type === 'circle' || e1.type === 'arc') && e2.type === 'line') {
          addLineTangentResiduals(e2, e1 as SketchCircle | SketchArc, varMap, entities, residuals)
        } else if ((e1.type === 'circle' || e1.type === 'arc') && (e2.type === 'circle' || e2.type === 'arc')) {
          // Distance between centers = r1 + r2 (external tangent) or |r1 - r2| (internal)
          // We'll use external tangent by default
          addCircleTangentResiduals(
            e1 as SketchCircle | SketchArc,
            e2 as SketchCircle | SketchArc,
            varMap, entities, residuals
          )
        }
        break
      }

      case 'midpoint': {
        const p = getPointCoords(c.pointId, varMap, entities)
        const line = entities.get(c.lineId) as SketchLine | undefined
        if (!line) break

        const ls = getPointCoords(line.startPointId, varMap, entities)
        const le = getPointCoords(line.endPointId, varMap, entities)

        // r1 = p.x - (ls.x + le.x)/2, r2 = p.y - (ls.y + le.y)/2
        const jx: ResidualEntry['jacobian'] = []
        const jy: ResidualEntry['jacobian'] = []
        if (p.varIdx >= 0) { jx.push({ varIdx: p.varIdx, deriv: 1 }); jy.push({ varIdx: p.varIdx + 1, deriv: 1 }) }
        if (ls.varIdx >= 0) { jx.push({ varIdx: ls.varIdx, deriv: -0.5 }); jy.push({ varIdx: ls.varIdx + 1, deriv: -0.5 }) }
        if (le.varIdx >= 0) { jx.push({ varIdx: le.varIdx, deriv: -0.5 }); jy.push({ varIdx: le.varIdx + 1, deriv: -0.5 }) }

        residuals.push({ value: p.x - (ls.x + le.x) / 2, jacobian: jx })
        residuals.push({ value: p.y - (ls.y + le.y) / 2, jacobian: jy })
        break
      }

      case 'pointOnEntity': {
        const p = getPointCoords(c.pointId, varMap, entities)
        const entity = entities.get(c.entityId)
        if (!entity) break

        if (entity.type === 'line') {
          // Point lies on line: signed area of triangle (ls, le, p) = 0
          // r = (dx*(p.y - ls.y) - dy*(p.x - ls.x)) / len
          // where dx = le.x-ls.x, dy = le.y-ls.y, len = |le-ls|
          const ls = getPointCoords(entity.startPointId, varMap, entities)
          const le = getPointCoords(entity.endPointId, varMap, entities)

          const dx = le.x - ls.x
          const dy = le.y - ls.y
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len < 1e-12) break

          const rVal = (dx * (p.y - ls.y) - dy * (p.x - ls.x)) / len

          // Exact partial derivatives (treating len as constant for this iteration):
          // d(r_unnorm)/d(px) = -dy, d(r_unnorm)/d(py) = dx
          // d(r_unnorm)/d(lsx) = le.y - p.y, d(r_unnorm)/d(lsy) = p.x - le.x
          // d(r_unnorm)/d(lex) = p.y - ls.y, d(r_unnorm)/d(ley) = ls.x - p.x
          const j: ResidualEntry['jacobian'] = []
          if (p.varIdx >= 0) {
            j.push({ varIdx: p.varIdx, deriv: -dy / len })
            j.push({ varIdx: p.varIdx + 1, deriv: dx / len })
          }
          if (ls.varIdx >= 0) {
            j.push({ varIdx: ls.varIdx, deriv: (le.y - p.y) / len })
            j.push({ varIdx: ls.varIdx + 1, deriv: (p.x - le.x) / len })
          }
          if (le.varIdx >= 0) {
            j.push({ varIdx: le.varIdx, deriv: (p.y - ls.y) / len })
            j.push({ varIdx: le.varIdx + 1, deriv: (ls.x - p.x) / len })
          }

          residuals.push({ value: rVal, jacobian: j })
        } else if (entity.type === 'circle') {
          // Point on circle: dist(p, center) - radius = 0
          const center = getPointCoords(entity.centerPointId, varMap, entities)
          const dx = p.x - center.x
          const dy = p.y - center.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < 1e-12) {
            residuals.push({ value: -entity.radius, jacobian: [] })
          } else {
            const nx = dx / dist, ny = dy / dist
            const j: ResidualEntry['jacobian'] = []
            if (p.varIdx >= 0) { j.push({ varIdx: p.varIdx, deriv: nx }); j.push({ varIdx: p.varIdx + 1, deriv: ny }) }
            if (center.varIdx >= 0) { j.push({ varIdx: center.varIdx, deriv: -nx }); j.push({ varIdx: center.varIdx + 1, deriv: -ny }) }
            residuals.push({ value: dist - entity.radius, jacobian: j })
          }
        }
        break
      }
    }
  }

  return residuals
}

// ─── Helper: get point IDs for horizontal/vertical constraints ─

function getLinePoints(
  c: { entityId?: string; pointId1?: string; pointId2?: string },
  entities: Map<string, SketchEntity>
): [string, string] | null {
  if (c.pointId1 && c.pointId2) {
    return [c.pointId1, c.pointId2]
  }
  if (c.entityId) {
    const entity = entities.get(c.entityId) as SketchLine | undefined
    if (entity?.type === 'line') {
      return [entity.startPointId, entity.endPointId]
    }
  }
  return null
}

// ─── Helper: line tangent to circle/arc ─────────────────────

function addLineTangentResiduals(
  line: SketchLine,
  circle: SketchCircle | SketchArc,
  varMap: VarMap,
  entities: Map<string, SketchEntity>,
  residuals: ResidualEntry[]
) {
  const ls = getPointCoords(line.startPointId, varMap, entities)
  const le = getPointCoords(line.endPointId, varMap, entities)
  const cc = getPointCoords(circle.centerPointId, varMap, entities)
  const radius = circle.radius

  const dx = le.x - ls.x, dy = le.y - ls.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-12) return

  // Distance from center to line = |cross(le-ls, cc-ls)| / |le-ls|
  // = |(dx*(cc.y-ls.y) - dy*(cc.x-ls.x))| / len
  // We want this = radius
  // Use signed version: cross / len - radius or cross / len + radius
  // To avoid absolute value issues, use: (cross/len)^2 - radius^2 = 0
  const cross = dx * (cc.y - ls.y) - dy * (cc.x - ls.x)
  const signedDist = cross / len
  // r = signedDist^2 - radius^2
  const r = signedDist * signedDist - radius * radius

  // Derivatives
  const j: ResidualEntry['jacobian'] = []
  // d(r)/d(...) = 2 * signedDist * d(signedDist)/d(...)
  // d(signedDist)/d(cc.x) = -dy/len
  // d(signedDist)/d(cc.y) = dx/len
  const factor = 2 * signedDist
  if (cc.varIdx >= 0) {
    j.push({ varIdx: cc.varIdx, deriv: factor * (-dy / len) })
    j.push({ varIdx: cc.varIdx + 1, deriv: factor * (dx / len) })
  }
  if (ls.varIdx >= 0) {
    j.push({ varIdx: ls.varIdx, deriv: factor * ((cc.y - le.y) / len) })
    j.push({ varIdx: ls.varIdx + 1, deriv: factor * ((le.x - cc.x) / len) })
  }
  if (le.varIdx >= 0) {
    j.push({ varIdx: le.varIdx, deriv: factor * ((ls.y - cc.y) / len) })
    j.push({ varIdx: le.varIdx + 1, deriv: factor * ((cc.x - ls.x) / len) })
  }

  residuals.push({ value: r, jacobian: j })
}

// ─── Helper: circle tangent to circle ───────────────────────

function addCircleTangentResiduals(
  c1: SketchCircle | SketchArc,
  c2: SketchCircle | SketchArc,
  varMap: VarMap,
  entities: Map<string, SketchEntity>,
  residuals: ResidualEntry[]
) {
  const cc1 = getPointCoords(c1.centerPointId, varMap, entities)
  const cc2 = getPointCoords(c2.centerPointId, varMap, entities)
  const r1 = c1.radius
  const r2 = c2.radius

  const dx = cc2.x - cc1.x
  const dy = cc2.y - cc1.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  // External tangent: dist = r1 + r2
  // Use squared form: dist^2 - (r1+r2)^2 = 0
  const rSum = r1 + r2
  const r = dist * dist - rSum * rSum

  const j: ResidualEntry['jacobian'] = []
  // d(dist^2)/d(cc1.x) = 2*(cc1.x-cc2.x) = -2*dx
  if (cc1.varIdx >= 0) {
    j.push({ varIdx: cc1.varIdx, deriv: -2 * dx })
    j.push({ varIdx: cc1.varIdx + 1, deriv: -2 * dy })
  }
  if (cc2.varIdx >= 0) {
    j.push({ varIdx: cc2.varIdx, deriv: 2 * dx })
    j.push({ varIdx: cc2.varIdx + 1, deriv: 2 * dy })
  }

  residuals.push({ value: r, jacobian: j })
}

// ─── Linear Algebra: Dense solver ───────────────────────────

/**
 * Solve (JᵀJ + λI)Δx = -Jᵀr using Cholesky decomposition.
 * Returns null if the system is singular (even with damping).
 */
function solveLevenbergMarquardt(
  residuals: ResidualEntry[],
  numVars: number,
  lambda: number
): Float64Array | null {
  if (numVars === 0) return new Float64Array(0)

  const n = numVars

  // Build JᵀJ + λI and Jᵀr
  const JtJ = new Float64Array(n * n) // row-major
  const Jtr = new Float64Array(n)

  for (const res of residuals) {
    // For each residual, accumulate its sparse Jacobian row into JᵀJ and Jᵀr
    for (const { varIdx: i, deriv: di } of res.jacobian) {
      Jtr[i] += di * res.value
      for (const { varIdx: j, deriv: dj } of res.jacobian) {
        JtJ[i * n + j] += di * dj
      }
    }
  }

  // Add damping
  for (let i = 0; i < n; i++) {
    JtJ[i * n + i] += lambda
  }

  // Solve using Cholesky: JtJ * dx = -Jtr
  const negJtr = new Float64Array(n)
  for (let i = 0; i < n; i++) negJtr[i] = -Jtr[i]

  return choleskySolve(JtJ, negJtr, n)
}

/**
 * Cholesky decomposition and solve: A * x = b where A is symmetric positive definite.
 * A is n×n row-major, b is n-vector. Returns x or null if A is not positive definite.
 */
function choleskySolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  // L * Lᵀ = A (in-place in L)
  const L = new Float64Array(n * n)

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j]
      for (let k = 0; k < j; k++) {
        sum -= L[i * n + k] * L[j * n + k]
      }
      if (i === j) {
        if (sum <= 0) return null // Not positive definite
        L[i * n + j] = Math.sqrt(sum)
      } else {
        L[i * n + j] = sum / L[j * n + j]
      }
    }
  }

  // Forward substitution: L * y = b
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = b[i]
    for (let j = 0; j < i; j++) {
      sum -= L[i * n + j] * y[j]
    }
    y[i] = sum / L[i * n + i]
  }

  // Back substitution: Lᵀ * x = y
  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]
    for (let j = i + 1; j < n; j++) {
      sum -= L[j * n + i] * x[j]
    }
    x[i] = sum / L[i * n + i]
  }

  return x
}

// ─── Compute DOF ────────────────────────────────────────────

function computeDOF(
  residuals: ResidualEntry[],
  numVars: number
): { dof: number; isOverConstrained: boolean } {
  if (numVars === 0) return { dof: 0, isOverConstrained: false }

  // Count independent constraints by computing the numerical rank of J
  const numResiduals = residuals.length
  if (numResiduals === 0) return { dof: numVars, isOverConstrained: false }

  // Build dense Jacobian matrix for rank computation
  const m = numResiduals
  const n = numVars
  const J = new Float64Array(m * n)

  for (let i = 0; i < m; i++) {
    for (const { varIdx, deriv } of residuals[i].jacobian) {
      J[i * n + varIdx] = deriv
    }
  }

  // Compute rank via column pivoting QR (simplified: just count non-zero singular values)
  // For simplicity, compute JᵀJ and count eigenvalues > threshold
  const JtJ = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < m; k++) {
        sum += J[k * n + i] * J[k * n + j]
      }
      JtJ[i * n + j] = sum
      JtJ[j * n + i] = sum
    }
  }

  // Estimate rank: count diagonal elements of Cholesky that are above threshold
  // (rough approximation — proper SVD would be better but overkill)
  const rank = estimateRank(JtJ, n)
  const dof = Math.max(0, numVars - rank)
  const isOverConstrained = rank < numResiduals && dof === 0

  return { dof, isOverConstrained }
}

function estimateRank(A: Float64Array, n: number): number {
  // Try Cholesky with pivoting to estimate rank
  const L = new Float64Array(n * n)
  const perm = new Array(n)
  for (let i = 0; i < n; i++) perm[i] = i

  // Copy A
  const Acopy = new Float64Array(A)

  let rank = 0
  const threshold = 1e-8

  for (let k = 0; k < n; k++) {
    // Find largest diagonal element
    let maxVal = -1
    let maxIdx = k
    for (let i = k; i < n; i++) {
      const pi = perm[i]
      const val = Acopy[pi * n + pi]
      if (val > maxVal) {
        maxVal = val
        maxIdx = i
      }
    }

    if (maxVal < threshold) break
    rank++

    // Swap
    const tmp = perm[k]
    perm[k] = perm[maxIdx]
    perm[maxIdx] = tmp

    const pk = perm[k]
    const sqrtVal = Math.sqrt(maxVal)
    L[pk * n + pk] = sqrtVal

    // Update
    for (let i = k + 1; i < n; i++) {
      const pi = perm[i]
      L[pi * n + pk] = Acopy[pi * n + pk] / sqrtVal
    }

    for (let i = k + 1; i < n; i++) {
      const pi = perm[i]
      for (let j = k + 1; j <= i; j++) {
        const pj = perm[j]
        Acopy[pi * n + pj] -= L[pi * n + pk] * L[pj * n + pk]
        Acopy[pj * n + pi] = Acopy[pi * n + pj]
      }
    }
  }

  return rank
}

// ─── Main Solver ────────────────────────────────────────────

/**
 * Solve all constraints in the sketch, returning updated point positions.
 *
 * @param entities - The sketch entities (points, lines, circles, arcs)
 * @param constraints - The constraints to satisfy
 * @param draggedPointId - If dragging a point, its ID (kept fixed during solve)
 * @param dragPosition - The target position for the dragged point
 */
export function solveConstraints(
  entities: Map<string, SketchEntity>,
  constraints: SketchConstraint[],
  draggedPointId?: string,
  dragPosition?: { x: number; y: number }
): SolverResult {
  if (constraints.length === 0) {
    return {
      pointUpdates: new Map(),
      status: {
        dof: countFreeVariables(entities),
        isOverConstrained: false,
        isSolved: true,
        conflictingConstraintIds: [],
      },
    }
  }

  // If dragging, temporarily modify the entity map
  let workingEntities = entities
  if (draggedPointId && dragPosition) {
    workingEntities = new Map(entities)
    const pt = workingEntities.get(draggedPointId) as SketchPoint | undefined
    if (pt) {
      workingEntities.set(draggedPointId, { ...pt, x: dragPosition.x, y: dragPosition.y })
    }
  }

  // Build variable map (exclude dragged point — it's fixed)
  const fixedPoints = draggedPointId ? new Set([draggedPointId]) : undefined
  const varMap = buildVarMap(workingEntities, fixedPoints)

  if (varMap.numVars === 0) {
    // No free variables
    const res = computeResiduals(constraints, varMap, workingEntities)
    const totalError = res.reduce((sum, r) => sum + r.value * r.value, 0)
    return {
      pointUpdates: draggedPointId && dragPosition
        ? new Map([[draggedPointId, dragPosition]])
        : new Map(),
      status: {
        dof: 0,
        isOverConstrained: totalError > CONVERGENCE_TOLERANCE,
        isSolved: totalError <= CONVERGENCE_TOLERANCE,
        conflictingConstraintIds: [],
      },
    }
  }

  // Levenberg-Marquardt iteration
  let lambda = LAMBDA_INITIAL

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const res = computeResiduals(constraints, varMap, workingEntities)
    const totalError = res.reduce((sum, r) => sum + r.value * r.value, 0)

    if (totalError < CONVERGENCE_TOLERANCE) {
      // Converged
      const dofInfo = computeDOF(res, varMap.numVars)
      return {
        pointUpdates: extractPointUpdates(varMap, workingEntities, draggedPointId, dragPosition),
        status: {
          dof: dofInfo.dof,
          isOverConstrained: dofInfo.isOverConstrained,
          isSolved: true,
          conflictingConstraintIds: [],
        },
      }
    }

    // Solve for step
    const step = solveLevenbergMarquardt(res, varMap.numVars, lambda)

    if (!step) {
      // Singular — increase damping
      lambda = Math.min(lambda * LAMBDA_FACTOR, LAMBDA_MAX)
      continue
    }

    // Apply step
    const oldVars = new Float64Array(varMap.vars)
    for (let i = 0; i < varMap.numVars; i++) {
      varMap.vars[i] += step[i]
    }

    // Update working entities with new positions
    updateEntitiesFromVars(varMap, workingEntities)

    // Compute new error
    const newRes = computeResiduals(constraints, varMap, workingEntities)
    const newError = newRes.reduce((sum, r) => sum + r.value * r.value, 0)

    if (newError < totalError) {
      // Good step — decrease damping
      lambda = Math.max(lambda / LAMBDA_FACTOR, 1e-10)
    } else {
      // Bad step — revert and increase damping
      varMap.vars.set(oldVars)
      updateEntitiesFromVars(varMap, workingEntities)
      lambda = Math.min(lambda * LAMBDA_FACTOR, LAMBDA_MAX)

      if (lambda >= LAMBDA_MAX) {
        // Can't make progress
        break
      }
    }
  }

  // Did not converge perfectly — return best result
  const finalRes = computeResiduals(constraints, varMap, workingEntities)
  const finalError = finalRes.reduce((sum, r) => sum + r.value * r.value, 0)
  const dofInfo = computeDOF(finalRes, varMap.numVars)

  return {
    pointUpdates: extractPointUpdates(varMap, workingEntities, draggedPointId, dragPosition),
    status: {
      dof: dofInfo.dof,
      isOverConstrained: dofInfo.isOverConstrained || finalError > 0.01,
      isSolved: finalError < 0.01,
      conflictingConstraintIds: [],
    },
  }
}

// ─── Helpers ────────────────────────────────────────────────

function updateEntitiesFromVars(
  varMap: VarMap,
  entities: Map<string, SketchEntity>
) {
  for (const [pointId, idx] of varMap.pointIndex) {
    const pt = entities.get(pointId) as SketchPoint | undefined
    if (pt) {
      entities.set(pointId, { ...pt, x: varMap.vars[idx], y: varMap.vars[idx + 1] })
    }
  }
}

function extractPointUpdates(
  varMap: VarMap,
  _entities: Map<string, SketchEntity>,
  draggedPointId?: string,
  dragPosition?: { x: number; y: number }
): Map<string, { x: number; y: number }> {
  const updates = new Map<string, { x: number; y: number }>()

  for (const [pointId, idx] of varMap.pointIndex) {
    updates.set(pointId, { x: varMap.vars[idx], y: varMap.vars[idx + 1] })
  }

  if (draggedPointId && dragPosition) {
    updates.set(draggedPointId, dragPosition)
  }

  return updates
}

function countFreeVariables(entities: Map<string, SketchEntity>): number {
  let count = 0
  for (const entity of entities.values()) {
    if (entity.type === 'point') count += 2
  }
  return count
}

// ─── Constraint Applicability ───────────────────────────────

/**
 * Determine which constraints can be applied given the current selection.
 */
export function getApplicableConstraints(
  selectedIds: string[],
  entities: Map<string, SketchEntity>
): SketchConstraint['type'][] {
  const selected = selectedIds.map((id) => entities.get(id)).filter(Boolean) as SketchEntity[]
  const applicable: SketchConstraint['type'][] = []

  const points = selected.filter((e) => e.type === 'point') as SketchPoint[]
  const lines = selected.filter((e) => e.type === 'line') as SketchLine[]
  const circles = selected.filter((e) => e.type === 'circle') as SketchCircle[]
  const arcs = selected.filter((e) => e.type === 'arc') as SketchArc[]

  // 2 points
  if (points.length === 2 && selected.length === 2) {
    applicable.push('coincident', 'horizontal', 'vertical', 'distance', 'horizontalDistance', 'verticalDistance')
  }

  // 1 point
  if (points.length === 1 && selected.length === 1) {
    applicable.push('fixed')
  }

  // 1 line
  if (lines.length === 1 && selected.length === 1) {
    applicable.push('horizontal', 'vertical', 'distance')
  }

  // 2 lines
  if (lines.length === 2 && selected.length === 2) {
    applicable.push('parallel', 'perpendicular', 'equal', 'angle')
  }

  // 1 circle or arc
  if ((circles.length === 1 || arcs.length === 1) && selected.length === 1) {
    applicable.push('radius')
  }

  // 2 circles/arcs
  if (circles.length + arcs.length === 2 && selected.length === 2) {
    applicable.push('equal', 'tangent')
  }

  // 1 point + 1 line
  if (points.length === 1 && lines.length === 1 && selected.length === 2) {
    applicable.push('midpoint', 'pointOnEntity')
  }

  // 1 point + 1 circle/arc
  if (points.length === 1 && (circles.length === 1 || arcs.length === 1) && selected.length === 2) {
    applicable.push('pointOnEntity')
  }

  // 1 line + 1 circle/arc
  if (lines.length === 1 && (circles.length === 1 || arcs.length === 1) && selected.length === 2) {
    applicable.push('tangent')
  }

  return applicable
}

/**
 * Create a constraint from the given type and selected entities.
 * Returns null if the selection is not valid for the constraint type.
 */
export function createConstraintFromSelection(
  constraintType: SketchConstraint['type'],
  constraintId: string,
  selectedIds: string[],
  entities: Map<string, SketchEntity>,
  value?: number
): SketchConstraint | null {
  const selected = selectedIds.map((id) => entities.get(id)).filter(Boolean) as SketchEntity[]
  const points = selected.filter((e) => e.type === 'point') as SketchPoint[]
  const lines = selected.filter((e) => e.type === 'line') as SketchLine[]
  const circles = selected.filter((e) => e.type === 'circle') as SketchCircle[]
  const arcs = selected.filter((e) => e.type === 'arc') as SketchArc[]

  switch (constraintType) {
    case 'coincident':
      if (points.length === 2) {
        return { type: 'coincident', id: constraintId, pointId1: points[0].id, pointId2: points[1].id }
      }
      return null

    case 'horizontal':
      if (lines.length === 1) {
        return { type: 'horizontal', id: constraintId, entityId: lines[0].id }
      }
      if (points.length === 2) {
        return { type: 'horizontal', id: constraintId, pointId1: points[0].id, pointId2: points[1].id }
      }
      return null

    case 'vertical':
      if (lines.length === 1) {
        return { type: 'vertical', id: constraintId, entityId: lines[0].id }
      }
      if (points.length === 2) {
        return { type: 'vertical', id: constraintId, pointId1: points[0].id, pointId2: points[1].id }
      }
      return null

    case 'fixed':
      if (points.length === 1) {
        return { type: 'fixed', id: constraintId, pointId: points[0].id, x: points[0].x, y: points[0].y }
      }
      return null

    case 'distance': {
      if (points.length === 2) {
        const dx = points[1].x - points[0].x
        const dy = points[1].y - points[0].y
        const measured = Math.sqrt(dx * dx + dy * dy)
        return { type: 'distance', id: constraintId, pointId1: points[0].id, pointId2: points[1].id, value: value ?? measured }
      }
      if (lines.length === 1) {
        const p1 = entities.get(lines[0].startPointId) as SketchPoint
        const p2 = entities.get(lines[0].endPointId) as SketchPoint
        if (!p1 || !p2) return null
        const dx = p2.x - p1.x, dy = p2.y - p1.y
        const measured = Math.sqrt(dx * dx + dy * dy)
        return { type: 'distance', id: constraintId, pointId1: p1.id, pointId2: p2.id, value: value ?? measured }
      }
      return null
    }

    case 'horizontalDistance': {
      if (points.length === 2) {
        const measured = points[1].x - points[0].x
        return { type: 'horizontalDistance', id: constraintId, pointId1: points[0].id, pointId2: points[1].id, value: value ?? measured }
      }
      return null
    }

    case 'verticalDistance': {
      if (points.length === 2) {
        const measured = points[1].y - points[0].y
        return { type: 'verticalDistance', id: constraintId, pointId1: points[0].id, pointId2: points[1].id, value: value ?? measured }
      }
      return null
    }

    case 'angle': {
      if (lines.length === 2) {
        const l1 = lines[0], l2 = lines[1]
        const l1s = entities.get(l1.startPointId) as SketchPoint
        const l1e = entities.get(l1.endPointId) as SketchPoint
        const l2s = entities.get(l2.startPointId) as SketchPoint
        const l2e = entities.get(l2.endPointId) as SketchPoint
        if (!l1s || !l1e || !l2s || !l2e) return null
        const d1x = l1e.x - l1s.x, d1y = l1e.y - l1s.y
        const d2x = l2e.x - l2s.x, d2y = l2e.y - l2s.y
        const measured = Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y) * 180 / Math.PI
        return { type: 'angle', id: constraintId, lineId1: l1.id, lineId2: l2.id, value: value ?? measured }
      }
      return null
    }

    case 'perpendicular':
      if (lines.length === 2) {
        return { type: 'perpendicular', id: constraintId, lineId1: lines[0].id, lineId2: lines[1].id }
      }
      return null

    case 'parallel':
      if (lines.length === 2) {
        return { type: 'parallel', id: constraintId, lineId1: lines[0].id, lineId2: lines[1].id }
      }
      return null

    case 'equal':
      if (selected.length === 2) {
        return { type: 'equal', id: constraintId, entityId1: selected[0].id, entityId2: selected[1].id }
      }
      return null

    case 'radius':
      if (circles.length === 1) {
        return { type: 'radius', id: constraintId, entityId: circles[0].id, value: value ?? circles[0].radius }
      }
      if (arcs.length === 1) {
        return { type: 'radius', id: constraintId, entityId: arcs[0].id, value: value ?? arcs[0].radius }
      }
      return null

    case 'tangent':
      if (selected.length === 2) {
        return { type: 'tangent', id: constraintId, entityId1: selected[0].id, entityId2: selected[1].id }
      }
      return null

    case 'midpoint':
      if (points.length === 1 && lines.length === 1) {
        return { type: 'midpoint', id: constraintId, pointId: points[0].id, lineId: lines[0].id }
      }
      return null

    case 'pointOnEntity':
      if (points.length === 1 && selected.length === 2) {
        const otherEntity = selected.find((e) => e.type !== 'point')
        if (otherEntity) {
          return { type: 'pointOnEntity', id: constraintId, pointId: points[0].id, entityId: otherEntity.id }
        }
      }
      return null

    default:
      return null
  }
}

/**
 * Get all point IDs referenced by a constraint.
 * Useful for cascade deletion when removing entities.
 */
export function getConstraintReferencedIds(
  constraint: SketchConstraint,
  _entities: Map<string, SketchEntity>
): string[] {
  const ids: string[] = []

  switch (constraint.type) {
    case 'coincident':
      ids.push(constraint.pointId1, constraint.pointId2)
      break
    case 'horizontal':
    case 'vertical':
      if (constraint.entityId) ids.push(constraint.entityId)
      if (constraint.pointId1) ids.push(constraint.pointId1)
      if (constraint.pointId2) ids.push(constraint.pointId2)
      break
    case 'fixed':
      ids.push(constraint.pointId)
      break
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance':
      ids.push(constraint.pointId1, constraint.pointId2)
      break
    case 'angle':
    case 'perpendicular':
    case 'parallel':
      ids.push(constraint.lineId1, constraint.lineId2)
      break
    case 'equal':
    case 'tangent':
      ids.push(constraint.entityId1, constraint.entityId2)
      break
    case 'radius':
      ids.push(constraint.entityId)
      break
    case 'midpoint':
      ids.push(constraint.pointId, constraint.lineId)
      break
    case 'pointOnEntity':
      ids.push(constraint.pointId, constraint.entityId)
      break
  }

  return ids
}

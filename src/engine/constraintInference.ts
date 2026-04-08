/**
 * Automatic constraint inference during sketch drawing.
 *
 * When the user draws entities (lines, circles, arcs, rectangles), this module
 * examines the newly created geometry and infers constraints that a CAD user
 * would typically apply manually — horizontal/vertical lines, coincident points,
 * perpendicular connections, tangency, and equal-length rectangle edges.
 *
 * All functions are pure (no side effects, no store access) so they can be
 * unit-tested in isolation.
 */

import type {
  SketchEntity,
  SketchPoint,
  SketchLine,
  SketchCircle,
  SketchArc,
  SketchConstraint,
} from './sketchTypes'

// ─── Configuration ──────────────────────────────────────────

/** Angular tolerance in degrees for near-horizontal / near-vertical detection */
export const ANGLE_TOLERANCE_DEG = 2.5

/** Angular tolerance in radians (derived) */
const ANGLE_TOLERANCE_RAD = (ANGLE_TOLERANCE_DEG * Math.PI) / 180

/** Relative length tolerance for equal-length detection (2%) */
const EQUAL_LENGTH_TOLERANCE = 0.02

/** Angular tolerance in radians for perpendicular detection */
const PERPENDICULAR_TOLERANCE_RAD = ANGLE_TOLERANCE_RAD

/** Angular tolerance in radians for tangent detection */
const TANGENT_TOLERANCE_RAD = ANGLE_TOLERANCE_RAD

// ─── Helpers ────────────────────────────────────────────────

function getPoint(entities: Map<string, SketchEntity>, id: string): SketchPoint | null {
  const e = entities.get(id)
  return e && e.type === 'point' ? e : null
}

/** Angle of a line to the positive X-axis, in radians [0, pi) */
function lineAngle(p1: SketchPoint, p2: SketchPoint): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  // atan2 returns (-pi, pi]; we want the unsigned angle of the direction
  let a = Math.atan2(dy, dx)
  // Normalize to [0, pi) — we don't care about line "direction", just orientation
  if (a < 0) a += Math.PI
  if (a >= Math.PI) a -= Math.PI
  return a
}

function lineLength(p1: SketchPoint, p2: SketchPoint): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Check if an angle (in radians, [0, pi)) is near 0 or pi (horizontal) */
function isNearHorizontal(angle: number): boolean {
  return angle < ANGLE_TOLERANCE_RAD || angle > Math.PI - ANGLE_TOLERANCE_RAD
}

/** Check if an angle (in radians, [0, pi)) is near pi/2 (vertical) */
function isNearVertical(angle: number): boolean {
  return Math.abs(angle - Math.PI / 2) < ANGLE_TOLERANCE_RAD
}

/** Check if two angles are near-perpendicular */
function isNearPerpendicular(angle1: number, angle2: number): boolean {
  let diff = Math.abs(angle1 - angle2)
  // Normalize to [0, pi)
  if (diff > Math.PI / 2) diff = Math.PI - diff
  return Math.abs(diff - Math.PI / 2) < PERPENDICULAR_TOLERANCE_RAD
}

/**
 * Check if two lengths are approximately equal within the relative tolerance.
 * Uses the average length as the reference to avoid asymmetry.
 */
function isNearEqual(len1: number, len2: number): boolean {
  const avg = (len1 + len2) / 2
  if (avg < 1e-6) return true // Both essentially zero
  return Math.abs(len1 - len2) / avg < EQUAL_LENGTH_TOLERANCE
}

/**
 * Check if a line is tangent to a circle/arc at a shared endpoint.
 * The line must share an endpoint with the circle/arc, and the direction
 * from the circle center to that shared point must be perpendicular to
 * the line direction.
 */
function checkLineTangentToArc(
  line: SketchLine,
  arc: SketchArc,
  entities: Map<string, SketchEntity>
): boolean {
  const ls = getPoint(entities, line.startPointId)
  const le = getPoint(entities, line.endPointId)
  const center = getPoint(entities, arc.centerPointId)
  if (!ls || !le || !center) return false

  // Find the shared point between line and arc
  let sharedPt: SketchPoint | null = null
  if (line.startPointId === arc.startPointId || line.startPointId === arc.endPointId) {
    sharedPt = ls
  } else if (line.endPointId === arc.startPointId || line.endPointId === arc.endPointId) {
    sharedPt = le
  }
  if (!sharedPt) return false

  // Line direction
  const ldx = le.x - ls.x
  const ldy = le.y - ls.y
  const lLen = Math.sqrt(ldx * ldx + ldy * ldy)
  if (lLen < 1e-10) return false

  // Radius direction (center -> shared point)
  const rdx = sharedPt.x - center.x
  const rdy = sharedPt.y - center.y
  const rLen = Math.sqrt(rdx * rdx + rdy * rdy)
  if (rLen < 1e-10) return false

  // Tangent iff the dot product of normalized directions is near zero
  const dot = (ldx / lLen) * (rdx / rLen) + (ldy / lLen) * (rdy / rLen)
  return Math.abs(dot) < Math.sin(TANGENT_TOLERANCE_RAD)
}

// ─── Duplicate Detection ────────────────────────────────────

/**
 * Check if a constraint of the given type with the given entity references
 * already exists in the constraint list.  Handles order-independent matching
 * for symmetric constraints (coincident, parallel, perpendicular, equal, tangent).
 */
function isDuplicate(
  candidate: SketchConstraint,
  existing: SketchConstraint[]
): boolean {
  for (const c of existing) {
    if (c.type !== candidate.type) continue

    switch (c.type) {
      case 'coincident': {
        const cand = candidate as typeof c
        if (
          (c.pointId1 === cand.pointId1 && c.pointId2 === cand.pointId2) ||
          (c.pointId1 === cand.pointId2 && c.pointId2 === cand.pointId1)
        ) return true
        break
      }
      case 'horizontal':
      case 'vertical': {
        const cand = candidate as typeof c
        if (c.entityId && c.entityId === cand.entityId) return true
        if (c.pointId1 && c.pointId2 && cand.pointId1 && cand.pointId2) {
          if (
            (c.pointId1 === cand.pointId1 && c.pointId2 === cand.pointId2) ||
            (c.pointId1 === cand.pointId2 && c.pointId2 === cand.pointId1)
          ) return true
        }
        break
      }
      case 'perpendicular':
      case 'parallel': {
        const cand = candidate as typeof c
        if (
          (c.lineId1 === cand.lineId1 && c.lineId2 === cand.lineId2) ||
          (c.lineId1 === cand.lineId2 && c.lineId2 === cand.lineId1)
        ) return true
        break
      }
      case 'equal': {
        const cand = candidate as typeof c
        if (
          (c.entityId1 === cand.entityId1 && c.entityId2 === cand.entityId2) ||
          (c.entityId1 === cand.entityId2 && c.entityId2 === cand.entityId1)
        ) return true
        break
      }
      case 'tangent': {
        const cand = candidate as typeof c
        if (
          (c.entityId1 === cand.entityId1 && c.entityId2 === cand.entityId2) ||
          (c.entityId1 === cand.entityId2 && c.entityId2 === cand.entityId1)
        ) return true
        break
      }
      case 'midpoint': {
        const cand = candidate as typeof c
        if (c.pointId === cand.pointId && c.lineId === cand.lineId) return true
        break
      }
      case 'pointOnEntity': {
        const cand = candidate as typeof c
        if (c.pointId === cand.pointId && c.entityId === cand.entityId) return true
        break
      }
      case 'fixed': {
        const cand = candidate as typeof c
        if (c.pointId === cand.pointId) return true
        break
      }
      // Dimensional constraints (distance, angle, radius, etc.) are not auto-inferred
      // so we don't need duplicate detection for them here.
    }
  }
  return false
}

// ─── Main Inference Entry Point ─────────────────────────────

/**
 * Given a set of newly created entity IDs, examine the sketch state and
 * return a list of constraints that should be automatically applied.
 *
 * @param newEntityIds  IDs of entities created in this drawing operation
 * @param entities      Full entity map (including the new ones)
 * @param existingConstraints  Constraints already in the sketch
 * @param nextId        Function that returns a fresh unique constraint ID
 * @returns  Array of constraints to add (may be empty)
 */
export function inferConstraints(
  newEntityIds: string[],
  entities: Map<string, SketchEntity>,
  existingConstraints: SketchConstraint[],
  nextId: () => string
): SketchConstraint[] {
  const result: SketchConstraint[] = []

  // Collect new entities by type
  const newEntities = newEntityIds.map((id) => entities.get(id)).filter(Boolean) as SketchEntity[]
  const newLines = newEntities.filter((e) => e.type === 'line') as SketchLine[]
  const newArcs = newEntities.filter((e) => e.type === 'arc') as SketchArc[]

  // Helper: add a constraint if it's not a duplicate of existing OR already-inferred ones
  const allConstraints = [...existingConstraints]
  function add(c: SketchConstraint) {
    if (!isDuplicate(c, allConstraints)) {
      result.push(c)
      allConstraints.push(c)
    }
  }

  // ── 1. Horizontal / Vertical line inference ───────────────
  for (const line of newLines) {
    const p1 = getPoint(entities, line.startPointId)
    const p2 = getPoint(entities, line.endPointId)
    if (!p1 || !p2) continue

    const angle = lineAngle(p1, p2)
    if (isNearHorizontal(angle)) {
      add({ type: 'horizontal', id: nextId(), entityId: line.id })
    } else if (isNearVertical(angle)) {
      add({ type: 'vertical', id: nextId(), entityId: line.id })
    }
  }

  // ── 2. Perpendicular inference (new line connected to existing line) ──
  for (const line of newLines) {
    const p1 = getPoint(entities, line.startPointId)
    const p2 = getPoint(entities, line.endPointId)
    if (!p1 || !p2) continue

    const newAngle = lineAngle(p1, p2)
    // Skip if already constrained as H or V — perpendicular to axis is just V or H
    const isHV =
      isNearHorizontal(newAngle) || isNearVertical(newAngle)

    if (!isHV) {
      // Find existing lines sharing an endpoint with this new line
      for (const entity of entities.values()) {
        if (entity.type !== 'line') continue
        if (newEntityIds.includes(entity.id)) continue // Skip other new lines (rectangle handled separately)

        // Must share an endpoint
        const sharesEndpoint =
          entity.startPointId === line.startPointId ||
          entity.startPointId === line.endPointId ||
          entity.endPointId === line.startPointId ||
          entity.endPointId === line.endPointId
        if (!sharesEndpoint) continue

        const ep1 = getPoint(entities, entity.startPointId)
        const ep2 = getPoint(entities, entity.endPointId)
        if (!ep1 || !ep2) continue

        const existingAngle = lineAngle(ep1, ep2)
        if (isNearPerpendicular(newAngle, existingAngle)) {
          add({ type: 'perpendicular', id: nextId(), lineId1: entity.id, lineId2: line.id })
        }
      }
    }
  }

  // ── 3. Tangent inference (new line tangent to existing arc) ───────
  for (const line of newLines) {
    for (const entity of entities.values()) {
      if (entity.type !== 'arc') continue
      if (newEntityIds.includes(entity.id)) continue
      if (checkLineTangentToArc(line, entity, entities)) {
        add({ type: 'tangent', id: nextId(), entityId1: line.id, entityId2: entity.id })
      }
    }
  }

  // ── 3b. New arc tangent to existing line ──────────────────
  for (const arc of newArcs) {
    for (const entity of entities.values()) {
      if (entity.type !== 'line') continue
      if (newEntityIds.includes(entity.id)) continue
      if (checkLineTangentToArc(entity as SketchLine, arc, entities)) {
        add({ type: 'tangent', id: nextId(), entityId1: entity.id, entityId2: arc.id })
      }
    }
  }

  // ── 4. Equal-length inference for rectangle edges ─────────
  //    When multiple new lines are created at once (rectangle), check
  //    for pairs with equal length and add equal constraints on
  //    opposite pairs (1st & 3rd, 2nd & 4th).
  if (newLines.length === 4) {
    // Heuristic: if exactly 4 new lines were created, treat as rectangle
    const lengths = newLines.map((l) => {
      const p1 = getPoint(entities, l.startPointId)
      const p2 = getPoint(entities, l.endPointId)
      return p1 && p2 ? lineLength(p1, p2) : 0
    })
    // Opposite edges: [0] & [2], [1] & [3]
    if (lengths[0] > 1e-6 && isNearEqual(lengths[0], lengths[2])) {
      add({ type: 'equal', id: nextId(), entityId1: newLines[0].id, entityId2: newLines[2].id })
    }
    if (lengths[1] > 1e-6 && isNearEqual(lengths[1], lengths[3])) {
      add({ type: 'equal', id: nextId(), entityId1: newLines[1].id, entityId2: newLines[3].id })
    }
  }

  return result
}

// ─── Snap-Aware Inference Helpers ───────────────────────────

/**
 * Describes a coincident relationship that should be recorded when a new
 * entity reuses an existing point via snapping.  This is tracked separately
 * from `inferConstraints` because point reuse happens at click time
 * (before the entity is fully formed).
 *
 * When a drawing tool calls `getOrCreatePoint` and the returned point
 * already existed, we record that point ID.  Later, when the entity is
 * finalized, we decide whether a coincident constraint is appropriate.
 *
 * NOTE: Currently the system reuses the same point object (same ID) when
 * snapping, so there's no need for an explicit coincident constraint
 * between two different point IDs.  Coincident inference is therefore
 * intentionally omitted — the topological sharing already ensures
 * the points stay merged.  If the system later supports "nearby but
 * separate points" (e.g., for splitting), this is where coincident
 * constraints would be generated.
 */

// Re-export the tolerance for use in tests and snap indicators
export { ANGLE_TOLERANCE_RAD }

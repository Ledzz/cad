/**
 * Sketch data model for the 2D sketch system.
 * All sketch entities use 2D coordinates in the sketch plane's local space.
 */

// ─── Sketch Plane ───────────────────────────────────────────

export interface SketchPlane {
  /** Human-readable name: 'XY', 'XZ', 'YZ', or 'Face N' */
  name: string
  /** Origin point in world space */
  origin: [number, number, number]
  /** Normal direction in world space */
  normal: [number, number, number]
  /** Local X axis direction in world space */
  xDir: [number, number, number]
  /** Local Y axis direction in world space (derived: normal × xDir, but stored for convenience) */
  yDir: [number, number, number]
}

/** Predefined sketch planes */
export const SKETCH_PLANES: Record<string, SketchPlane> = {
  XY: {
    name: 'XY',
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    xDir: [1, 0, 0],
    yDir: [0, 1, 0],
  },
  XZ: {
    name: 'XZ',
    origin: [0, 0, 0],
    normal: [0, 1, 0],
    xDir: [1, 0, 0],
    yDir: [0, 0, -1],
  },
  YZ: {
    name: 'YZ',
    origin: [0, 0, 0],
    normal: [1, 0, 0],
    xDir: [0, 1, 0],
    yDir: [0, 0, 1],
  },
}

// ─── Sketch Entities ────────────────────────────────────────

export interface SketchPoint {
  type: 'point'
  id: string
  x: number
  y: number
  /** If true, this is construction geometry (dashed, not used for profiles) */
  construction: boolean
}

export interface SketchLine {
  type: 'line'
  id: string
  /** ID of the start SketchPoint */
  startPointId: string
  /** ID of the end SketchPoint */
  endPointId: string
  construction: boolean
}

export interface SketchCircle {
  type: 'circle'
  id: string
  /** ID of the center SketchPoint */
  centerPointId: string
  radius: number
  construction: boolean
}

export interface SketchArc {
  type: 'arc'
  id: string
  /** ID of the center SketchPoint */
  centerPointId: string
  /** ID of the start SketchPoint (on the arc) */
  startPointId: string
  /** ID of the end SketchPoint (on the arc) */
  endPointId: string
  radius: number
  /** Start angle in radians */
  startAngle: number
  /** End angle in radians */
  endAngle: number
  construction: boolean
}

export type SketchEntity = SketchPoint | SketchLine | SketchCircle | SketchArc

// ─── Constraints ────────────────────────────────────────────

/** Constraint that makes two points coincide */
export interface CoincidentConstraint {
  type: 'coincident'
  id: string
  pointId1: string
  pointId2: string
}

/** Constraint that makes a line (or two points) horizontal (same Y) */
export interface HorizontalConstraint {
  type: 'horizontal'
  id: string
  /** Either a line ID or two point IDs */
  entityId?: string
  pointId1?: string
  pointId2?: string
}

/** Constraint that makes a line (or two points) vertical (same X) */
export interface VerticalConstraint {
  type: 'vertical'
  id: string
  entityId?: string
  pointId1?: string
  pointId2?: string
}

/** Constraint that fixes a point at specific coordinates */
export interface FixedConstraint {
  type: 'fixed'
  id: string
  pointId: string
  x: number
  y: number
}

/** Constraint that sets the distance between two points (or length of a line) */
export interface DistanceConstraint {
  type: 'distance'
  id: string
  pointId1: string
  pointId2: string
  value: number
}

/** Constraint that sets the horizontal distance between two points */
export interface HorizontalDistanceConstraint {
  type: 'horizontalDistance'
  id: string
  pointId1: string
  pointId2: string
  value: number
}

/** Constraint that sets the vertical distance between two points */
export interface VerticalDistanceConstraint {
  type: 'verticalDistance'
  id: string
  pointId1: string
  pointId2: string
  value: number
}

/** Constraint that sets the angle between two lines */
export interface AngleConstraint {
  type: 'angle'
  id: string
  lineId1: string
  lineId2: string
  /** Angle in degrees */
  value: number
}

/** Constraint that makes two lines perpendicular */
export interface PerpendicularConstraint {
  type: 'perpendicular'
  id: string
  lineId1: string
  lineId2: string
}

/** Constraint that makes two lines parallel */
export interface ParallelConstraint {
  type: 'parallel'
  id: string
  lineId1: string
  lineId2: string
}

/** Constraint that makes two lines/circles have equal length/radius */
export interface EqualConstraint {
  type: 'equal'
  id: string
  entityId1: string
  entityId2: string
}

/** Constraint that sets the radius of a circle or arc */
export interface RadiusConstraint {
  type: 'radius'
  id: string
  entityId: string
  value: number
}

/** Constraint that makes a line tangent to a circle/arc */
export interface TangentConstraint {
  type: 'tangent'
  id: string
  entityId1: string
  entityId2: string
}

/** Constraint that places a point at the midpoint of a line */
export interface MidpointConstraint {
  type: 'midpoint'
  id: string
  pointId: string
  lineId: string
}

/** Constraint that makes a point lie on a line or circle */
export interface PointOnEntityConstraint {
  type: 'pointOnEntity'
  id: string
  pointId: string
  entityId: string
}

export type SketchConstraint =
  | CoincidentConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | FixedConstraint
  | DistanceConstraint
  | HorizontalDistanceConstraint
  | VerticalDistanceConstraint
  | AngleConstraint
  | PerpendicularConstraint
  | ParallelConstraint
  | EqualConstraint
  | RadiusConstraint
  | TangentConstraint
  | MidpointConstraint
  | PointOnEntityConstraint

/** Constraint status for the sketch */
export interface ConstraintStatus {
  /** Degrees of freedom remaining (0 = fully constrained) */
  dof: number
  /** Whether the sketch is over-constrained */
  isOverConstrained: boolean
  /** Whether the solver converged successfully */
  isSolved: boolean
  /** IDs of conflicting constraints (if over-constrained) */
  conflictingConstraintIds: string[]
}

// ─── Drawing Tools ──────────────────────────────────────────

export type SketchTool = 'line' | 'circle' | 'arc' | 'rectangle' | 'point' | null

/** State machine for multi-click drawing tools */
export interface DrawingState {
  tool: SketchTool
  /** IDs of points placed so far in the current drawing operation */
  placedPointIds: string[]
  /** Preview position in sketch 2D coords (follows cursor) */
  previewPosition: { x: number; y: number } | null
}

// ─── Snap ───────────────────────────────────────────────────

export type SnapTarget =
  | { type: 'endpoint'; pointId: string; x: number; y: number }
  | { type: 'midpoint'; x: number; y: number }
  | { type: 'grid'; x: number; y: number }
  | { type: 'axis-x'; x: number; y: number }
  | { type: 'axis-y'; x: number; y: number }
  | null

// ─── Selection Rectangle ────────────────────────────────────

export interface SelectionRect {
  /** Start position in sketch 2D coords */
  startX: number
  startY: number
  /** Current end position in sketch 2D coords */
  endX: number
  endY: number
}

// ─── Full Sketch State ─────────────────────────────────────

/** Active constraint tool */
export type ConstraintTool =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'fixed'
  | 'distance'
  | 'horizontalDistance'
  | 'verticalDistance'
  | 'angle'
  | 'perpendicular'
  | 'parallel'
  | 'equal'
  | 'radius'
  | 'tangent'
  | 'midpoint'
  | 'pointOnEntity'
  | null

export interface SketchState {
  id: string
  plane: SketchPlane
  entities: Map<string, SketchEntity>
  /** Constraints applied to the sketch */
  constraints: SketchConstraint[]
  /** Current constraint solver status */
  constraintStatus: ConstraintStatus
  /** Currently selected entity IDs */
  selectedEntityIds: string[]
  /** Currently hovered entity ID */
  hoveredEntityId: string | null
  /** Active drawing tool */
  activeTool: SketchTool
  /** Active constraint tool */
  activeConstraintTool: ConstraintTool
  /** Current drawing operation state */
  drawingState: DrawingState
  /** Active selection rectangle (drag-to-select), or null */
  selectionRect: SelectionRect | null
  /** Next entity ID counter */
  nextEntityId: number
}

export function createEmptySketch(id: string, plane: SketchPlane): SketchState {
  return {
    id,
    plane,
    entities: new Map(),
    constraints: [],
    constraintStatus: {
      dof: 0,
      isOverConstrained: false,
      isSolved: true,
      conflictingConstraintIds: [],
    },
    selectedEntityIds: [],
    hoveredEntityId: null,
    activeTool: null,
    activeConstraintTool: null,
    drawingState: {
      tool: null,
      placedPointIds: [],
      previewPosition: null,
    },
    selectionRect: null,
    nextEntityId: 1,
  }
}

/** Generate a unique entity ID within a sketch */
export function generateEntityId(sketch: SketchState, prefix: string): string {
  return `${prefix}_${sketch.nextEntityId}`
}

/** Get a point entity by ID, or null */
export function getPoint(sketch: SketchState, id: string): SketchPoint | null {
  const entity = sketch.entities.get(id)
  return entity?.type === 'point' ? entity : null
}

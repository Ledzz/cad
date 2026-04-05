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

// ─── Full Sketch State ─────────────────────────────────────

export interface SketchState {
  id: string
  plane: SketchPlane
  entities: Map<string, SketchEntity>
  /** Currently selected entity IDs */
  selectedEntityIds: string[]
  /** Currently hovered entity ID */
  hoveredEntityId: string | null
  /** Active drawing tool */
  activeTool: SketchTool
  /** Current drawing operation state */
  drawingState: DrawingState
  /** Next entity ID counter */
  nextEntityId: number
}

export function createEmptySketch(id: string, plane: SketchPlane): SketchState {
  return {
    id,
    plane,
    entities: new Map(),
    selectedEntityIds: [],
    hoveredEntityId: null,
    activeTool: null,
    drawingState: {
      tool: null,
      placedPointIds: [],
      previewPosition: null,
    },
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

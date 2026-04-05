/**
 * Tessellation data transferred from the OCCT worker to the main thread.
 * Uses transferable ArrayBuffers for zero-copy performance.
 */
export interface TessellationData {
  id: string
  vertices: Float32Array   // [x, y, z, x, y, z, ...] — flat positions
  normals: Float32Array    // [nx, ny, nz, ...] — per-vertex normals
  indices: Uint32Array     // triangle indices
  faceRanges: FaceRange[]  // per-face index ranges for picking
}

export interface FaceRange {
  faceIndex: number
  startIndex: number
  count: number
}

export interface EdgeData {
  vertices: Float32Array   // line segment positions
}

/**
 * Messages sent to the OCCT worker.
 */
export type OccWorkerRequest =
  | { type: 'init' }
  | { type: 'makeBox'; id: string; dx: number; dy: number; dz: number }
  | { type: 'makeCylinder'; id: string; radius: number; height: number }
  | { type: 'makeSphere'; id: string; radius: number }

/**
 * Messages sent from the OCCT worker.
 */
export type OccWorkerResponse =
  | { type: 'ready' }
  | { type: 'tessellation'; data: TessellationData }
  | { type: 'error'; message: string }

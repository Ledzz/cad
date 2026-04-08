/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Comlink from 'comlink'
import type { OpenCascadeInstance } from '../wasm/opencascade'
import type { TopoDSShape, TopoDSShell, TopoDSWire, BRepAlgoAPI_Fuse, TopToolsListOfShape, EmscriptenFS } from '../engine/occTypes'
import type { TessellationData, FaceRange } from '../engine/tessellation'

let oc: OpenCascadeInstance | null = null

// ─── Shape Registry ─────────────────────────────────────────
// Keeps OCCT shapes in WASM memory so downstream features
// (boolean ops, fillets, etc.) can reference upstream results.

const shapeRegistry = new Map<string, TopoDSShape>()

// ─── Tessellation ───────────────────────────────────────────

/**
 * Tessellate an OCCT TopoDS_Shape into flat arrays suitable for Three.js BufferGeometry.
 */
function tessellateShape(shape: TopoDSShape, id: string, linearDeflection = 0.1, angularDeflection = 0.5): TessellationData {
  if (!oc) throw new Error('OpenCascade not initialized')

  // Run incremental mesh on the shape
  const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, linearDeflection, false, angularDeflection, false)
  if (!mesh.IsDone()) {
    mesh.delete()
    throw new Error('Tessellation failed')
  }

  const allVertices: number[] = []
  const allNormals: number[] = []
  const allIndices: number[] = []
  const faceRanges: FaceRange[] = []

  let vertexOffset = 0
  let faceIndex = 0

  // Iterate over all faces in the shape
  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current())
    const location = new oc.TopLoc_Location_1()
    const triangulationHandle = oc.BRep_Tool.Triangulation(face, location, 0 as any /* Poly_MeshPurpose_NONE */)

    if (triangulationHandle && !triangulationHandle.IsNull()) {
      const triangulation = triangulationHandle.get()
      const nbTriangles = triangulation.NbTriangles()
      const nbNodes = triangulation.NbNodes()

      const startIndex = allIndices.length

      // Check if face is reversed — need to flip normals and winding
      const isReversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED

      // Get the transformation for this face
      const trsf = location.Transformation()

      // Extract rotation part of the transformation (upper-left 3x3)
      const r11 = trsf.Value(1, 1), r12 = trsf.Value(1, 2), r13 = trsf.Value(1, 3)
      const r21 = trsf.Value(2, 1), r22 = trsf.Value(2, 2), r23 = trsf.Value(2, 3)
      const r31 = trsf.Value(3, 1), r32 = trsf.Value(3, 2), r33 = trsf.Value(3, 3)
      const t1 = trsf.Value(1, 4), t2 = trsf.Value(2, 4), t3 = trsf.Value(3, 4)

      const hasNormals = triangulation.HasNormals()

      // Extract vertices and normals
      for (let i = 1; i <= nbNodes; i++) {
        const node = triangulation.Node(i)
        const x = node.X(), y = node.Y(), z = node.Z()

        // Transform position
        allVertices.push(
          r11 * x + r12 * y + r13 * z + t1,
          r21 * x + r22 * y + r23 * z + t2,
          r31 * x + r32 * y + r33 * z + t3,
        )

        // Use OCCT-provided normals if available
        if (hasNormals) {
          const normal = triangulation.Normal(i)
          let nx = normal.X(), ny = normal.Y(), nz = normal.Z()

          // Flip normal for reversed faces
          if (isReversed) { nx = -nx; ny = -ny; nz = -nz }

          // Transform normal by rotation only (no translation)
          const tnx = r11 * nx + r12 * ny + r13 * nz
          const tny = r21 * nx + r22 * ny + r23 * nz
          const tnz = r31 * nx + r32 * ny + r33 * nz

          allNormals.push(tnx, tny, tnz)
        } else {
          // Placeholder — will compute from triangles below
          allNormals.push(0, 0, 0)
        }
      }

      // Extract triangle indices, respecting face orientation
      for (let i = 1; i <= nbTriangles; i++) {
        const tri = triangulation.Triangle(i)
        const n1 = tri.Value(1) - 1 + vertexOffset
        const n2 = tri.Value(2) - 1 + vertexOffset
        const n3 = tri.Value(3) - 1 + vertexOffset
        if (isReversed) {
          allIndices.push(n1, n3, n2) // swap winding
        } else {
          allIndices.push(n1, n2, n3)
        }
      }

      // Fallback: compute normals from cross product if OCCT didn't provide them
      if (!hasNormals) {
        for (let i = 1; i <= nbTriangles; i++) {
          const tri = triangulation.Triangle(i)
          let i1 = tri.Value(1) - 1 + vertexOffset
          let i2 = tri.Value(2) - 1 + vertexOffset
          let i3 = tri.Value(3) - 1 + vertexOffset
          if (isReversed) { const tmp = i2; i2 = i3; i3 = tmp }

          const ax = allVertices[i2 * 3] - allVertices[i1 * 3]
          const ay = allVertices[i2 * 3 + 1] - allVertices[i1 * 3 + 1]
          const az = allVertices[i2 * 3 + 2] - allVertices[i1 * 3 + 2]
          const bx = allVertices[i3 * 3] - allVertices[i1 * 3]
          const by = allVertices[i3 * 3 + 1] - allVertices[i1 * 3 + 1]
          const bz = allVertices[i3 * 3 + 2] - allVertices[i1 * 3 + 2]

          const nx = ay * bz - az * by
          const ny = az * bx - ax * bz
          const nz = ax * by - ay * bx

          for (const idx of [i1, i2, i3]) {
            allNormals[idx * 3] += nx
            allNormals[idx * 3 + 1] += ny
            allNormals[idx * 3 + 2] += nz
          }
        }
      }

      const count = nbTriangles * 3
      faceRanges.push({ faceIndex, startIndex, count })

      vertexOffset += nbNodes
    }

    location.delete()
    faceIndex++
    explorer.Next()
  }

  explorer.delete()
  mesh.delete()

  // Normalize all normals
  for (let i = 0; i < allNormals.length; i += 3) {
    const nx = allNormals[i]
    const ny = allNormals[i + 1]
    const nz = allNormals[i + 2]
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0) {
      allNormals[i] /= len
      allNormals[i + 1] /= len
      allNormals[i + 2] /= len
    }
  }

  // Collect B-Rep edge polylines for "shaded with edges" display
  const edgePolylines = collectEdgePolylines(shape)

  return {
    id,
    vertices: new Float32Array(allVertices),
    normals: new Float32Array(allNormals),
    indices: new Uint32Array(allIndices),
    faceRanges,
    edgePolylines,
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Collect edge polylines from a shape for "shaded with edges" display.
 * Reuses collectUniqueEdges for deduplication, then samples each edge curve.
 */
function collectEdgePolylines(shape: TopoDSShape): number[][] {
  if (!oc) return []
  const uniqueEdges = collectUniqueEdges(shape)
  const edgePolylines: number[][] = []
  const NUM_SAMPLES = 32

  for (const edgeShape of uniqueEdges) {
    try {
      const edge = oc.TopoDS.Edge_1(edgeShape)
      const adaptor = new oc.BRepAdaptor_Curve_2(edge)
      const u0: number = adaptor.FirstParameter()
      const u1: number = adaptor.LastParameter()

      const points: number[] = []
      for (let i = 0; i <= NUM_SAMPLES; i++) {
        const u = u0 + (u1 - u0) * (i / NUM_SAMPLES)
        const pnt = adaptor.Value(u)
        points.push(pnt.X(), pnt.Y(), pnt.Z())
        pnt.delete()
      }

      adaptor.delete()

      if (points.length >= 6) {
        edgePolylines.push(points)
      }
    } catch {
      // Skip degenerate edges
    }
  }

  return edgePolylines
}

/**
 * Get the last stored shape from the registry (the final solid in the feature chain).
 * The rebuild engine always stores the latest result as the last entry.
 */
function getLastShape(): TopoDSShape | null {
  let last: TopoDSShape | null = null
  for (const [, shape] of shapeRegistry) {
    last = shape
  }
  return last
}

/**
 * Collect unique (deduplicated) edges from a shape.
 * TopExp_Explorer visits each edge once per face it borders, so we deduplicate
 * by hashing start+end point coordinates (rounded).
 *
 * Returns an array of OCCT TopoDSEdge objects in a stable order that matches
 * the indices returned by getShapeEdges(). Caller must NOT delete these edges
 * (they are owned by the shape).
 */
function collectUniqueEdges(shape: TopoDSShape): TopoDSShape[] {
  if (!oc) return []

  const uniqueEdges: TopoDSShape[] = []
  const seenKeys = new Set<string>()

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  const round = (v: number) => Math.round(v * 1e4) / 1e4

  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current())

    try {
      const adaptor = new oc.BRepAdaptor_Curve_2(edge)
      const u0: number = adaptor.FirstParameter()
      const u1: number = adaptor.LastParameter()

      if (!isFinite(u0) || !isFinite(u1) || Math.abs(u1 - u0) < 1e-12) {
        adaptor.delete()
        explorer.Next()
        continue
      }

      // Get start and end points for dedup key
      const p0 = adaptor.Value(u0)
      const p1 = adaptor.Value(u1)
      const key1 = `${round(p0.X())},${round(p0.Y())},${round(p0.Z())}-${round(p1.X())},${round(p1.Y())},${round(p1.Z())}`
      const key2 = `${round(p1.X())},${round(p1.Y())},${round(p1.Z())}-${round(p0.X())},${round(p0.Y())},${round(p0.Z())}`
      p0.delete()
      p1.delete()
      adaptor.delete()

      if (!seenKeys.has(key1) && !seenKeys.has(key2)) {
        seenKeys.add(key1)
        uniqueEdges.push(edge)
      }
    } catch {
      // Skip degenerate edges
    }

    explorer.Next()
  }

  explorer.delete()
  return uniqueEdges
}

// ─── Worker API ─────────────────────────────────────────────

/**
 * The API exposed via Comlink from this Web Worker.
 */
const occWorkerApi = {
  async init(): Promise<boolean> {
    try {
      // Dynamic import to load the custom-built WASM module
      const occModule = await import('../wasm/opencascade.js')
      const initFn = occModule.default
      oc = await initFn({
        // Tell Emscripten where to find the .wasm file
        locateFile: (path: string) => {
          if (path.endsWith('.wasm')) {
            return '/opencascade.wasm'
          }
          return path
        },
      }) as OpenCascadeInstance
      console.log('[OCC Worker] OpenCascade initialized successfully')
      return true
    } catch (err) {
      console.error('[OCC Worker] Failed to initialize OpenCascade:', err)
      throw err
    }
  },

  // ─── Shape Registry ─────────────────────────────────────

  /** Delete a stored shape and free its WASM memory. */
  deleteShape(id: string): void {
    const shape = shapeRegistry.get(id)
    if (shape) {
      try { shape.delete() } catch { /* ignore */ }
      shapeRegistry.delete(id)
    }
  },

  /** Delete all stored shapes and free WASM memory. */
  clearShapes(): void {
    for (const [, shape] of shapeRegistry) {
      try { shape.delete() } catch { /* ignore */ }
    }
    shapeRegistry.clear()
  },

  /** Tessellate a previously stored shape by its ID. */
  tessellateStoredShape(id: string): TessellationData {
    const shape = shapeRegistry.get(id)
    if (!shape) throw new Error(`Shape "${id}" not found in registry`)
    const result = tessellateShape(shape, id)
    return Comlink.transfer(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer])
  },

  // ─── Face Geometry Query ─────────────────────────────────

  /**
   * Extract the plane (origin, normal, xDir, yDir) from a planar face.
   * Returns null if the face is not planar.
   *
   * @param shapeId - The shape ID in the registry
   * @param faceIndex - The 0-based face index (matching faceRanges from tessellation)
   */
  getFacePlane(
    shapeId: string,
    faceIndex: number
  ): { origin: [number, number, number]; normal: [number, number, number]; xDir: [number, number, number]; yDir: [number, number, number] } | null {
    if (!oc) throw new Error('OpenCascade not initialized')

    // Try direct lookup first
    let shape = shapeRegistry.get(shapeId)

    // If not found, this might be a multi-loop extrude. The sub-shapes are
    // stored as "<id>__loop_0", "<id>__loop_1", etc. We need to find which
    // sub-shape the faceIndex belongs to and compute the local face index.
    if (!shape) {
      let remainingIndex = faceIndex
      let loopIdx = 0
      while (true) {
        const loopId = `${shapeId}__loop_${loopIdx}`
        const loopShape = shapeRegistry.get(loopId)
        if (!loopShape) break

        // Count faces in this sub-shape
        const explorer = new oc.TopExp_Explorer_2(
          loopShape,
          oc.TopAbs_ShapeEnum.TopAbs_FACE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        )
        let faceCount = 0
        while (explorer.More()) { faceCount++; explorer.Next() }
        explorer.delete()

        if (remainingIndex < faceCount) {
          // Found the right sub-shape
          shape = loopShape
          faceIndex = remainingIndex
          break
        }
        remainingIndex -= faceCount
        loopIdx++
      }
    }

    if (!shape) throw new Error(`Shape "${shapeId}" not found in registry`)

    // Iterate to the Nth face
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )

    let currentIndex = 0
    while (explorer.More()) {
      if (currentIndex === faceIndex) {
        const face = oc.TopoDS.Face_1(explorer.Current())
        const isReversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED

        // Use BRepAdaptor_Surface to get surface type and geometry
        const adaptor = new oc.BRepAdaptor_Surface_2(face, true)
        const surfType = adaptor.GetType()

        if (surfType.value !== oc.GeomAbs_SurfaceType.GeomAbs_Plane.value) {
          // Not a planar face
          adaptor.delete()
          explorer.delete()
          return null
        }

        const pln = adaptor.Plane()
        const pos = pln.Position()

        const loc = pos.Location()
        const dir = pos.Direction()
        const xdir = pos.XDirection()
        const ydir = pos.YDirection()

        let nx = dir.X(), ny = dir.Y(), nz = dir.Z()
        // Flip normal for reversed faces to match visual orientation
        if (isReversed) { nx = -nx; ny = -ny; nz = -nz }

        const result: {
          origin: [number, number, number]
          normal: [number, number, number]
          xDir: [number, number, number]
          yDir: [number, number, number]
        } = {
          origin: [loc.X(), loc.Y(), loc.Z()],
          normal: [nx, ny, nz],
          xDir: [xdir.X(), xdir.Y(), xdir.Z()],
          yDir: [ydir.X(), ydir.Y(), ydir.Z()],
        }

        // If the face is reversed, also flip yDir so we maintain a right-handed
        // coordinate system with the flipped normal: xDir × yDir = normal
        if (isReversed) {
          result.yDir = [-result.yDir[0], -result.yDir[1], -result.yDir[2]]
        }

        // Clean up OCCT objects
        pln.delete()
        adaptor.delete()
        explorer.delete()
        return result
      }

      currentIndex++
      explorer.Next()
    }

    explorer.delete()
    throw new Error(`Face index ${faceIndex} not found in shape "${shapeId}" (has ${currentIndex} faces)`)
  },

  // ─── Wire/Edge builders ─────────────────────────────────

  /**
   * Build a wire from a group of edge definitions.
   * Returns the wire and a list of objects to delete later.
   */
  _buildWireFromEdges(
    edges: Array<{
      type: 'line' | 'arc' | 'circle'
      points: number[][]
      radius?: number
      normal?: number[]
    }>
  ): { wire: TopoDSWire; toDelete: any[] } {
    if (!oc) throw new Error('OpenCascade not initialized')

    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()
    const toDelete: any[] = [wireBuilder]

    for (const edge of edges) {
      switch (edge.type) {
        case 'line': {
          const p1 = new oc.gp_Pnt_3(edge.points[0][0], edge.points[0][1], edge.points[0][2])
          const p2 = new oc.gp_Pnt_3(edge.points[1][0], edge.points[1][1], edge.points[1][2])
          const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)
          if (!edgeBuilder.IsDone()) throw new Error('Failed to create line edge')
          wireBuilder.Add_1(oc.TopoDS.Edge_1(edgeBuilder.Shape()))
          toDelete.push(edgeBuilder)
          p1.delete(); p2.delete()
          break
        }
        case 'arc': {
          const p1 = new oc.gp_Pnt_3(edge.points[0][0], edge.points[0][1], edge.points[0][2])
          const p2 = new oc.gp_Pnt_3(edge.points[1][0], edge.points[1][1], edge.points[1][2])
          const p3 = new oc.gp_Pnt_3(edge.points[2][0], edge.points[2][1], edge.points[2][2])
          const arcBuilder = new oc.GC_MakeArcOfCircle_4(p1, p2, p3)
          if (!arcBuilder.IsDone()) throw new Error('Failed to create arc')
          const curve = arcBuilder.Value()
          const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_24(curve)
          if (!edgeBuilder.IsDone()) throw new Error('Failed to create arc edge')
          wireBuilder.Add_1(oc.TopoDS.Edge_1(edgeBuilder.Shape()))
          toDelete.push(edgeBuilder, arcBuilder)
          p1.delete(); p2.delete(); p3.delete()
          break
        }
        case 'circle': {
          const center = edge.points[0]
          const normal = edge.normal || [0, 0, 1]
          const radius = edge.radius || 1
          const pnt = new oc.gp_Pnt_3(center[0], center[1], center[2])
          const dir = new oc.gp_Dir_4(normal[0], normal[1], normal[2])
          const ax = new oc.gp_Ax2_3(pnt, dir)
          const circ = new oc.gp_Circ_2(ax, radius)
          const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_8(circ)
          if (!edgeBuilder.IsDone()) throw new Error('Failed to create circle edge')
          wireBuilder.Add_1(oc.TopoDS.Edge_1(edgeBuilder.Shape()))
          toDelete.push(edgeBuilder)
          circ.delete(); pnt.delete(); dir.delete(); ax.delete()
          break
        }
      }
    }

    if (!wireBuilder.IsDone()) {
      throw new Error('Failed to build wire')
    }

    return { wire: wireBuilder.Wire(), toDelete }
  },

  /**
   * Build solids by extruding sketch profiles.
   *
   * Takes edge groups (each group is a separate connected loop),
   * builds wire → face → prism for each, and merges the tessellation
   * results into a single TessellationData.
   *
   * When `operation` is 'cut', the combined prism tool is subtracted from
   * the target shape identified by `targetShapeId`.
   */
  extrudeSketch(
    id: string,
    edgeGroups: Array<Array<{
      type: 'line' | 'arc' | 'circle'
      points: number[][]
      radius?: number
      normal?: number[]
    }>>,
    extrudeDirection: [number, number, number],
    extrudeDistance: number,
    operation: 'boss' | 'cut' = 'boss',
    targetShapeId?: string
  ): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')

    // Clean up old shape(s) for this feature
    occWorkerApi.deleteShape(id)
    // Also clean up any sub-shapes from a previous multi-loop extrude
    for (const key of shapeRegistry.keys()) {
      if (key.startsWith(id + '__loop_')) {
        const shape = shapeRegistry.get(key)
        if (shape) { try { shape.delete() } catch { /* ignore */ } }
        shapeRegistry.delete(key)
      }
    }

    const allVertices: number[] = []
    const allNormals: number[] = []
    const allIndices: number[] = []
    const allFaceRanges: FaceRange[] = []
    let globalVertexOffset = 0
    let globalFaceIndex = 0

    if (operation === 'cut') {
      // ── Cut (Boolean subtraction) ────────────────────────
      if (!targetShapeId) throw new Error('Cut extrude requires a targetShapeId')
      const targetShape = shapeRegistry.get(targetShapeId)
      if (!targetShape) throw new Error(`Target shape "${targetShapeId}" not found in registry`)

      // Build all loop prisms, fuse them into a single tool shape
      let toolShape: TopoDSShape | null = null
      const toolsToDelete: any[] = []

      for (let loopIdx = 0; loopIdx < edgeGroups.length; loopIdx++) {
        const edges = edgeGroups[loopIdx]
        if (edges.length === 0) continue

        const loopToDelete: any[] = []
        try {
          const { wire, toDelete: wireCleanup } = occWorkerApi._buildWireFromEdges(edges)
          loopToDelete.push(...wireCleanup)

          const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
          loopToDelete.push(faceBuilder)
          if (!faceBuilder.IsDone()) throw new Error(`Failed to create face (loop ${loopIdx})`)

          const vec = new oc.gp_Vec_4(
            extrudeDirection[0] * extrudeDistance,
            extrudeDirection[1] * extrudeDistance,
            extrudeDirection[2] * extrudeDistance
          )
          const prism = new oc.BRepPrimAPI_MakePrism_1(faceBuilder.Shape(), vec, false, true)
          loopToDelete.push(prism)
          vec.delete()

          if (!prism.IsDone()) throw new Error(`Prism failed (loop ${loopIdx})`)
          const prismShape = prism.Shape()

          if (toolShape === null) {
            toolShape = prismShape
          } else {
            // Fuse this prism into the accumulated tool
            const fuseArgsList: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
            const fuseToolsList: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
            fuseArgsList.Append_1(toolShape)
            fuseToolsList.Append_1(prismShape)
            const fuseOp: BRepAlgoAPI_Fuse = new oc.BRepAlgoAPI_Fuse_1()
            fuseOp.SetArguments(fuseArgsList)
            fuseOp.SetTools(fuseToolsList)
            fuseOp.Build(new oc.Message_ProgressRange_1())
            toolsToDelete.push(fuseOp, fuseArgsList, fuseToolsList)
            if (!fuseOp.IsDone()) throw new Error(`Tool fuse failed at loop ${loopIdx}`)
            toolShape = fuseOp.Shape()
          }
        } finally {
          for (const obj of loopToDelete) {
            try { obj.delete() } catch { /* ignore */ }
          }
        }
      }

      if (!toolShape) throw new Error('No tool geometry produced for cut extrude')

      // Subtract tool from target using SetArguments/SetTools/Build pattern
      const argsList: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
      const toolsList: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
      argsList.Append_1(targetShape)
      toolsList.Append_1(toolShape)

      const cutOp = new oc.BRepAlgoAPI_Cut_1()
      cutOp.SetArguments(argsList)
      cutOp.SetTools(toolsList)
      cutOp.Build(new oc.Message_ProgressRange_1())
      toolsToDelete.push(cutOp, argsList, toolsList)
      try {
        if (!cutOp.IsDone()) throw new Error('Boolean cut operation failed')
        const resultShape = cutOp.Shape()

        // Store the result in the registry
        shapeRegistry.set(id, resultShape)

        // Tessellate the result
        const tess = tessellateShape(resultShape, id)
        const result: TessellationData = {
          id,
          vertices: tess.vertices,
          normals: tess.normals,
          indices: tess.indices,
          faceRanges: tess.faceRanges,
        }
        return Comlink.transfer(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer])
      } finally {
        for (const obj of toolsToDelete) {
          try { obj.delete() } catch { /* ignore */ }
        }
      }
    }

    // ── Boss (add material) ──────────────────────────────────
    for (let loopIdx = 0; loopIdx < edgeGroups.length; loopIdx++) {
      const edges = edgeGroups[loopIdx]
      if (edges.length === 0) continue

      const allToDelete: any[] = []

      try {
        // Build wire from this loop's edges
        const { wire, toDelete: wireCleanup } = occWorkerApi._buildWireFromEdges(edges)
        allToDelete.push(...wireCleanup)

        // Create face from wire
        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
        allToDelete.push(faceBuilder)
        if (!faceBuilder.IsDone()) {
          throw new Error(`Failed to create face from wire (loop ${loopIdx})`)
        }

        const face = faceBuilder.Shape()

        // Extrude the face
        const vec = new oc.gp_Vec_4(
          extrudeDirection[0] * extrudeDistance,
          extrudeDirection[1] * extrudeDistance,
          extrudeDirection[2] * extrudeDistance
        )
        const prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true)
        allToDelete.push(prism)
        vec.delete()

        if (!prism.IsDone()) {
          throw new Error(`Extrude failed (loop ${loopIdx})`)
        }

        const solid = prism.Shape()

        // Store each loop's shape in the registry
        const loopId = edgeGroups.length === 1 ? id : `${id}__loop_${loopIdx}`
        shapeRegistry.set(loopId, solid)

        // Tessellate this solid
        const tess = tessellateShape(solid, loopId)

        // Merge into combined arrays
        const vertCount = tess.vertices.length / 3
        const indexOffset = allIndices.length

        for (let i = 0; i < tess.vertices.length; i++) {
          allVertices.push(tess.vertices[i])
        }
        for (let i = 0; i < tess.normals.length; i++) {
          allNormals.push(tess.normals[i])
        }
        for (let i = 0; i < tess.indices.length; i++) {
          allIndices.push(tess.indices[i] + globalVertexOffset)
        }
        for (const range of tess.faceRanges) {
          allFaceRanges.push({
            faceIndex: range.faceIndex + globalFaceIndex,
            startIndex: range.startIndex + indexOffset,
            count: range.count,
          })
        }

        globalVertexOffset += vertCount
        globalFaceIndex += tess.faceRanges.length
      } finally {
        for (const obj of allToDelete) {
          try { obj.delete() } catch { /* ignore cleanup errors */ }
        }
      }
    }

    if (allVertices.length === 0) {
      throw new Error('No geometry produced from extrude')
    }

    const result: TessellationData = {
      id,
      vertices: new Float32Array(allVertices),
      normals: new Float32Array(allNormals),
      indices: new Uint32Array(allIndices),
      faceRanges: allFaceRanges,
    }

    return Comlink.transfer(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer])
  },

  /**
   * Symmetric extrude: extrude half distance in each direction and fuse the two prisms.
   */
  extrudeSketchSymmetric(
    id: string,
    edgeGroups: Array<Array<{
      type: 'line' | 'arc' | 'circle'
      points: number[][]
      radius?: number
      normal?: number[]
    }>>,
    direction: [number, number, number],
    halfDistance: number
  ): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')

    // Clean up old shapes
    occWorkerApi.deleteShape(id)
    for (const key of shapeRegistry.keys()) {
      if (key.startsWith(id + '__')) {
        const shape = shapeRegistry.get(key)
        if (shape) { try { shape.delete() } catch { /* ignore */ } }
        shapeRegistry.delete(key)
      }
    }

    const allToDelete: any[] = []

    try {
      // Build all loop prisms in both directions, fuse them
      let combinedShape: TopoDSShape | null = null

      for (let loopIdx = 0; loopIdx < edgeGroups.length; loopIdx++) {
        const edges = edgeGroups[loopIdx]
        if (edges.length === 0) continue

        const { wire, toDelete: wireCleanup } = occWorkerApi._buildWireFromEdges(edges)
        allToDelete.push(...wireCleanup)

        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
        allToDelete.push(faceBuilder)
        if (!faceBuilder.IsDone()) throw new Error(`Failed to create face (loop ${loopIdx})`)

        const face = faceBuilder.Shape()

        // Forward prism
        const vecFwd = new oc.gp_Vec_4(
          direction[0] * halfDistance,
          direction[1] * halfDistance,
          direction[2] * halfDistance
        )
        const prismFwd = new oc.BRepPrimAPI_MakePrism_1(face, vecFwd, false, true)
        allToDelete.push(prismFwd)
        vecFwd.delete()
        if (!prismFwd.IsDone()) throw new Error(`Forward prism failed (loop ${loopIdx})`)

        // Reverse prism
        const vecRev = new oc.gp_Vec_4(
          -direction[0] * halfDistance,
          -direction[1] * halfDistance,
          -direction[2] * halfDistance
        )
        const prismRev = new oc.BRepPrimAPI_MakePrism_1(face, vecRev, false, true)
        allToDelete.push(prismRev)
        vecRev.delete()
        if (!prismRev.IsDone()) throw new Error(`Reverse prism failed (loop ${loopIdx})`)

        // Fuse the two prisms
        const fuseArgs: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
        const fuseTools: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
        fuseArgs.Append_1(prismFwd.Shape())
        fuseTools.Append_1(prismRev.Shape())
        const fuseOp: BRepAlgoAPI_Fuse = new oc.BRepAlgoAPI_Fuse_1()
        fuseOp.SetArguments(fuseArgs)
        fuseOp.SetTools(fuseTools)
        fuseOp.Build(new oc.Message_ProgressRange_1())
        allToDelete.push(fuseOp, fuseArgs, fuseTools)
        if (!fuseOp.IsDone()) throw new Error(`Symmetric fuse failed (loop ${loopIdx})`)

        const loopShape = fuseOp.Shape()

        if (combinedShape === null) {
          combinedShape = loopShape
        } else {
          // Fuse with previous loops
          const combineArgs: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
          const combineTools: TopToolsListOfShape = new oc.TopTools_ListOfShape_1()
          combineArgs.Append_1(combinedShape)
          combineTools.Append_1(loopShape)
          const combineOp: BRepAlgoAPI_Fuse = new oc.BRepAlgoAPI_Fuse_1()
          combineOp.SetArguments(combineArgs)
          combineOp.SetTools(combineTools)
          combineOp.Build(new oc.Message_ProgressRange_1())
          allToDelete.push(combineOp, combineArgs, combineTools)
          if (!combineOp.IsDone()) throw new Error(`Loop combine fuse failed`)
          combinedShape = combineOp.Shape()
        }
      }

      if (!combinedShape) throw new Error('No geometry produced from symmetric extrude')

      shapeRegistry.set(id, combinedShape)
      const tess = tessellateShape(combinedShape, id)
      return Comlink.transfer(tess, [tess.vertices.buffer, tess.normals.buffer, tess.indices.buffer])
    } finally {
      for (const obj of allToDelete) {
        try { obj.delete() } catch { /* ignore */ }
      }
    }
  },

  /**
   * Revolve a sketch profile around a world axis.
   *
   * @param id - Feature ID (used as registry key)
   * @param edgeGroups - Connected loops from the sketch
   * @param axisDirection - Unit vector of the world axis ([1,0,0]=X, [0,1,0]=Y, [0,0,1]=Z)
   * @param angle - Revolution angle in degrees (360 = full solid of revolution)
   */
  revolveSketch(
    id: string,
    edgeGroups: Array<Array<{
      type: 'line' | 'arc' | 'circle'
      points: number[][]
      radius?: number
      normal?: number[]
    }>>,
    axisDirection: [number, number, number],
    angle: number
  ): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')

    // Clean up previous shapes for this feature
    occWorkerApi.deleteShape(id)
    for (const key of shapeRegistry.keys()) {
      if (key.startsWith(id + '__loop_')) {
        const s = shapeRegistry.get(key)
        if (s) { try { s.delete() } catch { /* ignore */ } }
        shapeRegistry.delete(key)
      }
    }

    const allVertices: number[] = []
    const allNormals: number[] = []
    const allIndices: number[] = []
    const allFaceRanges: FaceRange[] = []
    let globalVertexOffset = 0
    let globalFaceIndex = 0

    for (let loopIdx = 0; loopIdx < edgeGroups.length; loopIdx++) {
      const edges = edgeGroups[loopIdx]
      if (edges.length === 0) continue

      const allToDelete: any[] = []
      try {
        // Build wire → face
        const { wire, toDelete: wireCleanup } = occWorkerApi._buildWireFromEdges(edges)
        allToDelete.push(...wireCleanup)

        const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
        allToDelete.push(faceBuilder)
        if (!faceBuilder.IsDone()) throw new Error(`Failed to create face (loop ${loopIdx})`)

        // Build the revolution axis through the world origin
        const origin = new oc.gp_Pnt_3(0, 0, 0)
        const dir = new oc.gp_Dir_4(axisDirection[0], axisDirection[1], axisDirection[2])
        const ax1 = new oc.gp_Ax1_2(origin, dir)
        allToDelete.push(origin, dir, ax1)

        const face = faceBuilder.Face()

        // Build revolve — prefer _2 for full revolutions (proper closed solid),
        // _1 for partial angles.  Use IsDone() as the gate to avoid ever calling
        // Shape() on a failed builder (which throws a raw C++ exception pointer
        // that corrupts Emscripten's exception state for subsequent WASM calls).
        const angleRad = (angle / 180) * Math.PI
        const isFull = angle >= 360

        const faceRevolve = isFull
          ? new oc.BRepPrimAPI_MakeRevol_2(face, ax1, false)
          : new oc.BRepPrimAPI_MakeRevol_1(face, ax1, angleRad, false)
        allToDelete.push(faceRevolve)

        let solid: TopoDSShape
        if (faceRevolve.IsDone()) {
          solid = faceRevolve.Shape()
        } else {
          // Face revolve failed (e.g. face normal parallel to axis, or profile
          // on axis). Fall back: revolve the wire to get a shell, then wrap
          // with MakeSolid. Wire revolve has no cap topology — avoids the
          // degenerate-cap issue that kills face revolve.
          const wireRevolve = isFull
            ? new oc.BRepPrimAPI_MakeRevol_2(wire, ax1, false)
            : new oc.BRepPrimAPI_MakeRevol_1(wire, ax1, angleRad, false)
          allToDelete.push(wireRevolve)

          if (!wireRevolve.IsDone()) {
            throw new Error(
              `Revolve failed (loop ${loopIdx}). Ensure the sketch profile is ` +
              `fully on one side of the ${['X','Y','Z'][axisDirection.indexOf(1)] ?? '?'} axis ` +
              `and does not cross or touch the axis.`
            )
          }

          const shell = wireRevolve.Shape()
          const solidBuilder = new oc.BRepBuilderAPI_MakeSolid_3(shell as TopoDSShell)
          allToDelete.push(solidBuilder)
          solid = solidBuilder.IsDone() ? solidBuilder.Shape() : shell
        }

        if (!solid || solid.IsNull()) throw new Error(`Revolve produced null shape (loop ${loopIdx})`)

        const loopId = edgeGroups.length === 1 ? id : `${id}__loop_${loopIdx}`
        shapeRegistry.set(loopId, solid)

        const tess = tessellateShape(solid, loopId)
        const vertCount = tess.vertices.length / 3
        const indexOffset = allIndices.length

        for (let i = 0; i < tess.vertices.length; i++) allVertices.push(tess.vertices[i])
        for (let i = 0; i < tess.normals.length; i++) allNormals.push(tess.normals[i])
        for (let i = 0; i < tess.indices.length; i++) allIndices.push(tess.indices[i] + globalVertexOffset)
        for (const range of tess.faceRanges) {
          allFaceRanges.push({
            faceIndex: range.faceIndex + globalFaceIndex,
            startIndex: range.startIndex + indexOffset,
            count: range.count,
          })
        }

        globalVertexOffset += vertCount
        globalFaceIndex += tess.faceRanges.length
      } finally {
        for (const obj of allToDelete) {
          try { obj.delete() } catch { /* ignore */ }
        }
      }
    }

    if (allVertices.length === 0) throw new Error('No geometry produced from revolve')

    const result: TessellationData = {
      id,
      vertices: new Float32Array(allVertices),
      normals: new Float32Array(allNormals),
      indices: new Uint32Array(allIndices),
      faceRanges: allFaceRanges,
    }

    return Comlink.transfer(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer])
  },

  /**
   * Apply a constant-radius fillet to edges of a stored shape.
   * If edgeIndices is provided, only those edges are filleted (0-based).
   * Otherwise, all edges are filleted.
   */
  filletShape(id: string, targetShapeId: string, radius: number, edgeIndices?: number[]): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')

    const targetShape = shapeRegistry.get(targetShapeId)
    if (!targetShape) throw new Error(`Target shape "${targetShapeId}" not found in registry`)

    occWorkerApi.deleteShape(id)

    const fillet = new oc.BRepFilletAPI_MakeFillet(targetShape, oc.ChFi3d_FilletShape.ChFi3d_Rational)
    try {
      const uniqueEdges = collectUniqueEdges(targetShape)
      const useAll = !edgeIndices || edgeIndices.length === 0
      const edgeSet = useAll ? null : new Set(edgeIndices)
      let edgeCount = 0

      for (let i = 0; i < uniqueEdges.length; i++) {
        if (useAll || edgeSet!.has(i)) {
          const edge = oc.TopoDS.Edge_1(uniqueEdges[i])
          try {
            fillet.Add_2(radius, edge)
            edgeCount++
          } catch (e) {
            console.warn(`[OCC Worker] Failed to add edge ${i} to fillet:`, e)
          }
        }
      }

      if (edgeCount === 0) throw new Error('No edges could be filleted')

      fillet.Build(new oc.Message_ProgressRange_1())
      if (!fillet.IsDone()) throw new Error('Fillet operation failed')

      const resultShape = fillet.Shape()
      shapeRegistry.set(id, resultShape)

      const tess = tessellateShape(resultShape, id)
      return Comlink.transfer(tess, [tess.vertices.buffer, tess.normals.buffer, tess.indices.buffer])
    } finally {
      fillet.delete()
    }
  },

  /**
   * Apply an equal-distance chamfer to edges of a stored shape.
   * If edgeIndices is provided, only those edges are chamfered (0-based).
   * Otherwise, all edges are chamfered.
   */
  chamferShape(id: string, targetShapeId: string, distance: number, edgeIndices?: number[]): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')

    const targetShape = shapeRegistry.get(targetShapeId)
    if (!targetShape) throw new Error(`Target shape "${targetShapeId}" not found in registry`)

    occWorkerApi.deleteShape(id)

    const chamfer = new oc.BRepFilletAPI_MakeChamfer(targetShape)
    try {
      const uniqueEdges = collectUniqueEdges(targetShape)
      const useAll = !edgeIndices || edgeIndices.length === 0
      const edgeSet = useAll ? null : new Set(edgeIndices)
      let edgeCount = 0

      for (let i = 0; i < uniqueEdges.length; i++) {
        if (useAll || edgeSet!.has(i)) {
          const edge = oc.TopoDS.Edge_1(uniqueEdges[i])
          try {
            chamfer.Add_2(distance, edge)
            edgeCount++
          } catch (e) {
            console.warn(`[OCC Worker] Failed to add edge ${i} to chamfer:`, e)
          }
        }
      }

      if (edgeCount === 0) throw new Error('No edges could be chamfered')

      chamfer.Build(new oc.Message_ProgressRange_1())
      if (!chamfer.IsDone()) throw new Error('Chamfer operation failed')

      const resultShape = chamfer.Shape()
      shapeRegistry.set(id, resultShape)

      const tess = tessellateShape(resultShape, id)
      return Comlink.transfer(tess, [tess.vertices.buffer, tess.normals.buffer, tess.indices.buffer])
    } finally {
      chamfer.delete()
    }
  },

  // ─── Edge Extraction ──────────────────────────────────────

  /**
   * Extract edges from a stored shape as polyline segments for rendering.
   * Returns an array of edge polylines: each edge is an array of [x,y,z] points.
   * Used for edge selection UI.
   */
  getShapeEdges(shapeId: string): { edges: number[][] } {
    if (!oc) throw new Error('OpenCascade not initialized')

    const shape = shapeRegistry.get(shapeId)
    if (!shape) throw new Error(`Shape "${shapeId}" not found in registry`)

    const uniqueEdges = collectUniqueEdges(shape)
    const edges: number[][] = []

    const NUM_SAMPLES = 32 // number of points to sample along each curve

    for (const edgeShape of uniqueEdges) {
      try {
        const edge = oc.TopoDS.Edge_1(edgeShape)
        const adaptor = new oc.BRepAdaptor_Curve_2(edge)
        const u0: number = adaptor.FirstParameter()
        const u1: number = adaptor.LastParameter()

        const points: number[] = []
        for (let i = 0; i <= NUM_SAMPLES; i++) {
          const u = u0 + (u1 - u0) * (i / NUM_SAMPLES)
          const pnt = adaptor.Value(u)
          points.push(pnt.X(), pnt.Y(), pnt.Z())
          pnt.delete()
        }

        adaptor.delete()

        if (points.length >= 6) {
          edges.push(points)
        }
      } catch {
        // Push empty to keep index alignment with collectUniqueEdges
        edges.push([])
      }
    }

    return { edges }
  },

  // ─── Measurement ────────────────────────────────────────────

  /**
   * Get the exact length of an edge using BRepGProp.LinearProperties.
   * @param shapeId - The shape ID in the registry
   * @param edgeIndex - The 0-based edge index (from collectUniqueEdges ordering)
   */
  getEdgeLength(shapeId: string, edgeIndex: number): number {
    if (!oc) throw new Error('OpenCascade not initialized')

    const shape = shapeRegistry.get(shapeId)
    if (!shape) throw new Error(`Shape "${shapeId}" not found in registry`)

    const uniqueEdges = collectUniqueEdges(shape)
    if (edgeIndex < 0 || edgeIndex >= uniqueEdges.length) {
      throw new Error(`Edge index ${edgeIndex} out of range (${uniqueEdges.length} edges)`)
    }

    const edge = uniqueEdges[edgeIndex]
    const props = new oc.GProp_GProps_1()
    try {
      oc.BRepGProp.LinearProperties(edge, props, false, false)
      return props.Mass()
    } finally {
      props.delete()
    }
  },

  /**
   * Get the angle between two faces' normals using gp_Dir.Angle().
   * @param shapeId - The shape ID in the registry
   * @param faceIndex1 - First face index (from tessellation faceRanges)
   * @param faceIndex2 - Second face index
   * @returns Angle in degrees between the two face normals
   */
  getAngleBetweenFaces(shapeId: string, faceIndex1: number, faceIndex2: number): number {
    if (!oc) throw new Error('OpenCascade not initialized')

    const shape = shapeRegistry.get(shapeId)
    if (!shape) throw new Error(`Shape "${shapeId}" not found in registry`)

    function getFaceNormal(faceIdx: number): { nx: number; ny: number; nz: number } {
      const explorer = new oc!.TopExp_Explorer_2(
        shape!,
        oc!.TopAbs_ShapeEnum.TopAbs_FACE,
        oc!.TopAbs_ShapeEnum.TopAbs_SHAPE
      )
      let idx = 0
      while (explorer.More()) {
        if (idx === faceIdx) {
          const face = oc!.TopoDS.Face_1(explorer.Current())
          const isReversed = face.Orientation_1() === oc!.TopAbs_Orientation.TopAbs_REVERSED
          const adaptor = new oc!.BRepAdaptor_Surface_2(face, true)

          // Get the surface normal at mid-UV point
          const uMin = adaptor.FirstUParameter()
          const uMax = adaptor.LastUParameter()
          const vMin = adaptor.FirstVParameter()
          const vMax = adaptor.LastVParameter()
          const uMid = (uMin + uMax) / 2
          const vMid = (vMin + vMax) / 2

          const pnt = new oc!.gp_Pnt_1()
          const d1u = new oc!.gp_Vec_1()
          const d1v = new oc!.gp_Vec_1()
          adaptor.D1(uMid, vMid, pnt, d1u, d1v)

          // Normal = d1u × d1v
          const normal = d1u.Crossed(d1v)
          let nx = normal.X(), ny = normal.Y(), nz = normal.Z()
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
          if (len > 1e-10) { nx /= len; ny /= len; nz /= len }

          if (isReversed) { nx = -nx; ny = -ny; nz = -nz }

          pnt.delete(); d1u.delete(); d1v.delete(); normal.delete()
          adaptor.delete()
          explorer.delete()
          return { nx, ny, nz }
        }
        idx++
        explorer.Next()
      }
      explorer.delete()
      throw new Error(`Face index ${faceIdx} not found in shape "${shapeId}"`)
    }

    const n1 = getFaceNormal(faceIndex1)
    const n2 = getFaceNormal(faceIndex2)

    const dir1 = new oc.gp_Dir_4(n1.nx, n1.ny, n1.nz)
    const dir2 = new oc.gp_Dir_4(n2.nx, n2.ny, n2.nz)
    try {
      const angleRad = dir1.Angle(dir2)
      return (angleRad * 180) / Math.PI
    } finally {
      dir1.delete()
      dir2.delete()
    }
  },

  /**
   * Get the midpoint of an edge (for annotation placement).
   * @param shapeId - Shape ID in registry
   * @param edgeIndex - 0-based edge index
   */
  getEdgeMidpoint(shapeId: string, edgeIndex: number): [number, number, number] {
    if (!oc) throw new Error('OpenCascade not initialized')

    const shape = shapeRegistry.get(shapeId)
    if (!shape) throw new Error(`Shape "${shapeId}" not found in registry`)

    const uniqueEdges = collectUniqueEdges(shape)
    if (edgeIndex < 0 || edgeIndex >= uniqueEdges.length) {
      throw new Error(`Edge index ${edgeIndex} out of range`)
    }

    const edge = oc.TopoDS.Edge_1(uniqueEdges[edgeIndex])
    const adaptor = new oc.BRepAdaptor_Curve_2(edge)
    try {
      const u0: number = adaptor.FirstParameter()
      const u1: number = adaptor.LastParameter()
      const uMid = (u0 + u1) / 2
      const pnt = adaptor.Value(uMid)
      const result: [number, number, number] = [pnt.X(), pnt.Y(), pnt.Z()]
      pnt.delete()
      return result
    } finally {
      adaptor.delete()
    }
  },

  /**
   * Get the centroid of a face (for annotation placement).
   */
  getFaceCentroid(shapeId: string, faceIndex: number): [number, number, number] {
    if (!oc) throw new Error('OpenCascade not initialized')

    const shape = shapeRegistry.get(shapeId)
    if (!shape) throw new Error(`Shape "${shapeId}" not found in registry`)

    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )
    let idx = 0
    while (explorer.More()) {
      if (idx === faceIndex) {
        const face = oc.TopoDS.Face_1(explorer.Current())
        const props = new oc.GProp_GProps_1()
        oc.BRepGProp.SurfaceProperties_1(face, props, false, false)
        const center = props.CentreOfMass()
        const result: [number, number, number] = [center.X(), center.Y(), center.Z()]
        props.delete()
        explorer.delete()
        return result
      }
      idx++
      explorer.Next()
    }
    explorer.delete()
    throw new Error(`Face index ${faceIndex} not found`)
  },

  // ─── File I/O ──────────────────────────────────────────────

  /**
   * Export the final solid as a STEP file.
   * Returns the file contents as a Uint8Array.
   */
  exportSTEP(): Uint8Array {
    if (!oc) throw new Error('OpenCascade not initialized')

    // Find the last stored shape (the final solid)
    const shape = getLastShape()
    if (!shape) throw new Error('No shape to export')

    const writer = new oc.STEPControl_Writer_1()
    const fs: EmscriptenFS = oc.FS as any
    const filename = '/tmp/export.step'

    try {
      writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange_1())
      const status = writer.Write(filename)

      // IFSelect_RetDone.value === 1 — but comparing .value is fragile across builds,
      // so just check that it matches the enum member.
      if (status.value !== oc.IFSelect_ReturnStatus.IFSelect_RetDone.value) {
        throw new Error(`STEP write failed with status ${status.value}`)
      }

      const data = fs.readFile(filename) as Uint8Array
      fs.unlink(filename)
      return Comlink.transfer(data, [data.buffer])
    } finally {
      writer.delete()
    }
  },

  /**
   * Import a STEP file and return tessellation data for rendering.
   * The imported shape is stored in the registry under the given id.
   */
  importSTEP(id: string, fileData: Uint8Array): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')

    const fs: EmscriptenFS = oc.FS as any
    const filename = '/tmp/import.step'

    try {
      fs.writeFile(filename, fileData)

      const reader = new oc.STEPControl_Reader_1()
      try {
        const readStatus = reader.ReadFile(filename)
        if (readStatus.value !== oc.IFSelect_ReturnStatus.IFSelect_RetDone.value) {
          throw new Error(`STEP read failed with status ${readStatus.value}`)
        }

        const numRoots = reader.NbRootsForTransfer()
        if (numRoots === 0) throw new Error('STEP file contains no transferable roots')

        reader.TransferRoots(new oc.Message_ProgressRange_1())
        const shape = reader.OneShape()
        if (!shape || shape.IsNull()) throw new Error('STEP import produced null shape')

        // Store in registry
        shapeRegistry.set(id, shape)

        const tess = tessellateShape(shape, id)
        return Comlink.transfer(tess, [tess.vertices.buffer, tess.normals.buffer, tess.indices.buffer])
      } finally {
        reader.delete()
      }
    } finally {
      try { fs.unlink(filename) } catch { /* ignore */ }
    }
  },

  /**
   * Export the final solid as a binary STL file.
   * Returns the file contents as a Uint8Array.
   */
  exportSTL(_ascii: boolean = false): Uint8Array {
    if (!oc) throw new Error('OpenCascade not initialized')

    const shape = getLastShape()
    if (!shape) throw new Error('No shape to export')

    const fs: EmscriptenFS = oc.FS as any
    const filename = '/tmp/export.stl'

    // Ensure mesh is up-to-date
    const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false)
    try {
      if (!mesh.IsDone()) throw new Error('Tessellation failed for STL export')

      const writer = new oc.StlAPI_Writer()
      try {
        // Note: In v2 build, SetASCIIMode is no longer available as a setter.
        // The writer defaults to binary mode. ASCII mode is not supported in this build.
        const success = writer.Write(shape, filename, new oc.Message_ProgressRange_1())
        if (!success) throw new Error('STL write failed')

        const data = fs.readFile(filename) as Uint8Array
        fs.unlink(filename)
        return Comlink.transfer(data, [data.buffer])
      } finally {
        writer.delete()
      }
    } finally {
      mesh.delete()
    }
  },
}

export type OccWorkerApi = typeof occWorkerApi

Comlink.expose(occWorkerApi)

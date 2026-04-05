/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Comlink from 'comlink'
import type { OpenCascadeInstance, TopoDSShape, TopoDSWire } from '../engine/occTypes'
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
    const triangulationHandle = oc.BRep_Tool.Triangulation(face, location)

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

  return {
    id,
    vertices: new Float32Array(allVertices),
    normals: new Float32Array(allNormals),
    indices: new Uint32Array(allIndices),
    faceRanges,
  }
}

// ─── Worker API ─────────────────────────────────────────────

/**
 * The API exposed via Comlink from this Web Worker.
 */
const occWorkerApi = {
  async init(): Promise<boolean> {
    try {
      // Dynamic import to load the WASM module
      const occModule = await import('opencascade.js')
      const initFn = occModule.default || occModule.initOpenCascade
      oc = await initFn() as OpenCascadeInstance
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

  // ─── Primitive Builders ─────────────────────────────────

  makeBox(id: string, dx: number, dy: number, dz: number): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')
    const builder = new oc.BRepPrimAPI_MakeBox_1(dx, dy, dz)
    const shape = builder.Shape()

    // Store shape in registry (delete old one if exists)
    occWorkerApi.deleteShape(id)
    shapeRegistry.set(id, shape)

    const result = tessellateShape(shape, id)
    builder.delete()
    return Comlink.transfer(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer])
  },

  makeCylinder(id: string, radius: number, height: number): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')
    const builder = new oc.BRepPrimAPI_MakeCylinder_1(radius, height)
    const shape = builder.Shape()

    occWorkerApi.deleteShape(id)
    shapeRegistry.set(id, shape)

    const result = tessellateShape(shape, id)
    builder.delete()
    return Comlink.transfer(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer])
  },

  makeSphere(id: string, radius: number): TessellationData {
    if (!oc) throw new Error('OpenCascade not initialized')
    const builder = new oc.BRepPrimAPI_MakeSphere_1(radius)
    const shape = builder.Shape()

    occWorkerApi.deleteShape(id)
    shapeRegistry.set(id, shape)

    const result = tessellateShape(shape, id)
    builder.delete()
    return Comlink.transfer(result, [result.vertices.buffer, result.normals.buffer, result.indices.buffer])
  },

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
    extrudeDistance: number
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
}

export type OccWorkerApi = typeof occWorkerApi

Comlink.expose(occWorkerApi)

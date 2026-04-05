/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal type declarations for opencascade.js v1.1.1
 * These cover only the APIs we use. The library has no built-in .d.ts.
 */

export interface OpenCascadeInstance {
  // Geometry primitives
  gp_Pnt_1: new () => GpPnt
  gp_Pnt_3: new (x: number, y: number, z: number) => GpPnt
  gp_Dir_4: new (x: number, y: number, z: number) => GpDir
  gp_Ax2_3: new (pnt: GpPnt, dir: GpDir) => GpAx2
  gp_Trsf_1: new () => GpTrsf
  gp_Vec_4: new (x: number, y: number, z: number) => GpVec

  // Primitive builders
  BRepPrimAPI_MakeBox_1: new (dx: number, dy: number, dz: number) => BRepPrimAPI_MakeBox
  BRepPrimAPI_MakeBox_2: new (ax: GpAx2, dx: number, dy: number, dz: number) => BRepPrimAPI_MakeBox
  BRepPrimAPI_MakeCylinder_1: new (r: number, h: number) => BRepPrimAPI_MakeCylinder
  BRepPrimAPI_MakeCylinder_3: new (ax: GpAx2, r: number, h: number) => BRepPrimAPI_MakeCylinder
  BRepPrimAPI_MakeSphere_1: new (r: number) => BRepPrimAPI_MakeSphere

  // Edge/Wire/Face builders (for sketch)
  // _3: (const gp_Pnt& P1, const gp_Pnt& P2)
  BRepBuilderAPI_MakeEdge_3: new (p1: GpPnt, p2: GpPnt) => BRepBuilderAPI_MakeEdge
  // _24: (const Handle<Geom_Curve>& L) — edge from full curve (respects TrimmedCurve bounds)
  BRepBuilderAPI_MakeEdge_24: new (curve: Handle_Geom_Curve) => BRepBuilderAPI_MakeEdge
  // _1: () — empty constructor
  BRepBuilderAPI_MakeWire_1: new () => BRepBuilderAPI_MakeWire
  // _2: (const TopoDS_Edge& E)
  BRepBuilderAPI_MakeWire_2: new (edge: TopoDSEdge) => BRepBuilderAPI_MakeWire
  // _15: (const TopoDS_Wire& W, Standard_Boolean OnlyPlane)
  BRepBuilderAPI_MakeFace_15: new (wire: TopoDSWire, onlyPlane: boolean) => BRepBuilderAPI_MakeFace

  // Curves
  // _4: (const gp_Pnt& P1, const gp_Pnt& P2, const gp_Pnt& P3) — arc through 3 points
  GC_MakeArcOfCircle_4: new (p1: GpPnt, p2: GpPnt, p3: GpPnt) => GC_MakeArcOfCircle
  // _2: (const gp_Ax2& A2, Standard_Real Radius)
  GC_MakeCircle_2: new (ax: GpAx2, radius: number) => GC_MakeCircle

  // Extrusion
  // _1: (const TopoDS_Shape& S, const gp_Vec& V, Standard_Boolean Copy, Standard_Boolean Canonize)
  BRepPrimAPI_MakePrism_1: new (shape: TopoDSShape, vec: GpVec, copy?: boolean, canonize?: boolean) => BRepPrimAPI_MakePrism

  // Boolean operations
  BRepAlgoAPI_Fuse_3: new (s1: TopoDSShape, s2: TopoDSShape, progress: any) => BRepAlgoAPI_Fuse
  BRepAlgoAPI_Cut_3: new (s1: TopoDSShape, s2: TopoDSShape, progress: any) => BRepAlgoAPI_Cut
  BRepAlgoAPI_Common_3: new (s1: TopoDSShape, s2: TopoDSShape, progress: any) => BRepAlgoAPI_Common

  // Filleting
  BRepFilletAPI_MakeFillet: new (s: TopoDSShape) => BRepFilletAPI_MakeFillet

  // Transform
  BRepBuilderAPI_Transform_2: new (shape: TopoDSShape, trsf: GpTrsf, copy: boolean) => BRepBuilderAPI_Transform

  // Tessellation
  BRepMesh_IncrementalMesh_2: new (shape: TopoDSShape, deflection: number, isRelative: boolean, angle: number, isInParallel: boolean) => BRepMesh_IncrementalMesh

  // Topology exploration
  TopExp_Explorer_2: new (shape: TopoDSShape, toFind: any, toAvoid: any) => TopExpExplorer
  BRep_Tool: BRepToolStatic

  // Topology enums
  TopAbs_ShapeEnum: { TopAbs_FACE: any; TopAbs_EDGE: any; TopAbs_VERTEX: any; TopAbs_SHAPE: any; TopAbs_WIRE: any }
  TopAbs_Orientation: { TopAbs_FORWARD: any; TopAbs_REVERSED: any; TopAbs_INTERNAL: any; TopAbs_EXTERNAL: any }

  // Downcasting
  TopoDS: TopoDSStatic

  // Location
  TopLoc_Location_1: new () => TopLocLocation

  // Memory management
  _WrapperFunctions?: Record<string, any>
}

export interface GpPnt {
  X(): number
  Y(): number
  Z(): number
  delete(): void
}

export interface GpDir {
  X(): number
  Y(): number
  Z(): number
  delete(): void
}

export interface GpAx2 {
  delete(): void
}

export interface GpTrsf {
  SetTranslation_1(vec: GpVec): void
  delete(): void
}

export interface GpVec {
  delete(): void
}

export interface TopoDSShape {
  IsNull(): boolean
  ShapeType(): any
  Orientation_1(): any
  delete(): void
}

export interface TopoDSFace extends TopoDSShape {}

export interface BRepPrimAPI_MakeBox {
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepPrimAPI_MakeCylinder {
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepPrimAPI_MakeSphere {
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepAlgoAPI_Fuse {
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepAlgoAPI_Cut {
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepAlgoAPI_Common {
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepFilletAPI_MakeFillet {
  Add_2(radius: number, edge: any): void
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepBuilderAPI_Transform {
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepMesh_IncrementalMesh {
  IsDone(): boolean
  delete(): void
}

export interface TopExpExplorer {
  More(): boolean
  Next(): void
  Current(): TopoDSShape
  delete(): void
}

export interface BRepToolStatic {
  Triangulation(face: TopoDSFace, loc: TopLocLocation, checkFace?: number): Handle_Poly_Triangulation | null
}

export interface TopoDSStatic {
  Face_1(shape: TopoDSShape): TopoDSFace
  Edge_1(shape: TopoDSShape): TopoDSEdge
  Wire_1(shape: TopoDSShape): TopoDSWire
}

export interface TopLocLocation {
  Transformation(): {
    TranslationPart(): GpPnt
    Value(row: number, col: number): number
  }
  delete(): void
}

export interface Handle_Poly_Triangulation {
  IsNull(): boolean
  get(): Poly_Triangulation
}

export interface Poly_Triangulation {
  NbTriangles(): number
  NbNodes(): number
  Node(index: number): GpPnt
  Triangle(index: number): Poly_Triangle
  HasUVNodes(): boolean
  HasNormals(): boolean
  Normal(index: number): GpDir
}

export interface Poly_Triangle {
  Get(n1: { current: number }, n2: { current: number }, n3: { current: number }): void
  Value(index: number): number
}

// ─── Sketch/Edge/Wire/Face types ────────────────────────────

export interface TopoDSEdge extends TopoDSShape {}

export interface TopoDSWire extends TopoDSShape {}

export interface BRepBuilderAPI_MakeEdge {
  IsDone(): boolean
  Edge(): TopoDSEdge
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepBuilderAPI_MakeWire {
  IsDone(): boolean
  Error(): any
  Add_1(edge: TopoDSEdge): void
  Add_2(wire: TopoDSWire): void
  Wire(): TopoDSWire
  Shape(): TopoDSShape
  delete(): void
}

export interface BRepBuilderAPI_MakeFace {
  IsDone(): boolean
  Face(): TopoDSFace
  Shape(): TopoDSShape
  Error(): any
  delete(): void
}

export interface Handle_Geom_Curve {
  IsNull(): boolean
  get(): any
}

export interface GC_MakeArcOfCircle {
  IsDone(): boolean
  Value(): Handle_Geom_Curve
  delete(): void
}

export interface GC_MakeCircle {
  IsDone(): boolean
  Value(): Handle_Geom_Curve
  delete(): void
}

export interface BRepPrimAPI_MakePrism {
  IsDone(): boolean
  Shape(): TopoDSShape
  delete(): void
}

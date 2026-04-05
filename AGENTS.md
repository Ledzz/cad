# Browser-Based 3D Parametric CAD — Roadmap

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  React 19 UI                     │
│  (Toolbar, Feature Tree, Property Panel, etc.)   │
├──────────────┬──────────────────┬────────────────┤
│  Three.js    │   CAD Engine     │   File I/O     │
│  Viewport    │   (TypeScript)   │   Module       │
│  (rendering, │   (sketch mgr,   │   (STEP, STL,  │
│   picking,   │    feature tree,  │    3MF export) │
│   camera)    │    history/undo)  │                │
├──────────────┴──────────────────┴────────────────┤
│           OpenCascade.js (WASM kernel)           │
│     (B-Rep operations, boolean ops, NURBS)       │
└─────────────────────────────────────────────────┘
```

## Tech Stack

| Concern | Technology |
|---|---|
| Framework | React 19 |
| 3D Rendering | Three.js + `@react-three/fiber` |
| Geometry Kernel | `opencascade.js` (WASM) |
| State Management | Zustand |
| UI Components | Radix UI (headless, accessible) |
| Styling | Tailwind CSS or CSS Modules |
| Worker Comms | Comlink (simplifies Web Worker messaging) |
| File Handling | `fflate` (for 3MF ZIP), native OCCT readers |
| Testing | Vitest + Playwright (e2e) |
| Local Storage | IndexedDB via `idb` |

---

## Phase 1 — Foundation (Weeks 1–6)

**Goal:** Render 3D geometry in the browser using OpenCascade.js + Three.js.

### 1.1 Project Infrastructure
- Set up Three.js with a resizable canvas in React
- Configure OpenCascade.js WASM loading (Web Worker for heavy operations)
- Set up state management (Zustand)
- Basic app layout: viewport (center), sidebar (left), properties panel (right)

### 1.2 3D Viewport
- Orbit/pan/zoom camera controls (Three.js OrbitControls as starting point, replace later with CAD-style controls)
- Grid plane + axis indicator (triad)
- Basic lighting setup (ambient + directional)
- Viewport gizmo for orientation (like the cube in Onshape's corner)

### 1.3 OpenCascade Integration
- Load `opencascade.js` in a Web Worker to keep the UI responsive
- Build a messaging layer between the main thread and the OCCT worker
- Implement shape tessellation: OCCT B-Rep → Three.js `BufferGeometry`
- Render a test solid (e.g., a box, a cylinder) to prove the pipeline works

### 1.4 Object Selection / Picking
- Raycasting for face/edge/vertex selection
- Visual highlighting on hover and selection
- Selection modes: single, multi (Shift+click), selection filters (face-only, edge-only, etc.)

**Milestone 0:** Render an OpenCascade-generated 3D box in a Three.js viewport inside the React app, with orbit controls.

---

## Phase 2 — Core Modeling (Weeks 7–16)

**Goal:** Enable basic parametric solid modeling (sketch → extrude workflow).

### 2.1 2D Sketch System
- Enter/exit sketch mode on a selected plane or face
- Sketch entities: line, arc, circle, rectangle, point
- Real-time constraint solver (geometric constraints: coincident, parallel, perpendicular, tangent, equal, horizontal, vertical)
- Dimensional constraints (distance, angle, radius)
- Sketch validation: fully constrained (black), under-constrained (blue), over-constrained (red)
- Snap and construction geometry

### 2.2 Basic 3D Features
- **Extrude** (blind, through-all, up-to-face, mid-plane)
- **Revolve** (full, partial angle)
- **Fillet** and **Chamfer** on edges
- **Boolean operations** (union, subtract, intersect) via OCCT
- **Cut extrude** (pocket/hole)

### 2.3 Feature Tree / History
- Parametric feature tree (sidebar panel)
- Each feature stores its parameters and can be edited
- Rebuild chain: editing an early feature cascades to later features
- Feature suppression (temporarily disable a feature)
- Feature reordering (drag to reorder in the tree)

### 2.4 Undo/Redo
- Command pattern for all operations
- Full undo/redo stack with parameter snapshots

---

## Phase 3 — Advanced Modeling (Weeks 17–28)

**Goal:** Feature parity with basic operations of professional CAD tools.

### 3.1 Additional 3D Features
- **Loft** (guide curves)
- **Sweep** (along path)
- **Shell** (hollow out a solid)
- **Draft** (tapered faces for molding)
- **Pattern** (linear, circular)
- **Mirror** (across a plane)
- **Hole wizard** (counterbore, countersink, through, blind)

### 3.2 Reference Geometry
- Reference planes (offset, angle, through points)
- Reference axes
- Reference points
- Mate connectors

### 3.3 Advanced Sketch
- Splines (B-spline, bezier)
- Offset curves
- Trim/extend/split
- Sketch projections (project edges onto sketch plane)
- Sketch patterns

### 3.4 Part Properties
- Mass properties (volume, surface area, center of mass, moments of inertia — all from OCCT)
- Material assignment (density for mass calc, visual appearance)
- Physical units system (mm, inch, etc.)

---

## Phase 4 — Assemblies (Weeks 29–40)

**Goal:** Support multi-part assemblies with mates/constraints.

### 4.1 Assembly Structure
- Part studio (modeling environment) vs. Assembly (positioning environment)
- Insert parts into assemblies
- Assembly feature tree (parts + mates)
- Component visibility toggling

### 4.2 Mates / Constraints
- Fastened (fixed relative position)
- Revolute (rotation about axis)
- Slider (translation along axis)
- Planar (contact between planes)
- Cylindrical
- Ball joint
- Mate solver (position parts based on constraints)

### 4.3 Assembly Visualization
- Exploded views
- Section views (clipping planes)
- Transparency per-component
- Interference detection

---

## Phase 5 — File I/O & Export (Weeks 25–32, parallel with Phase 3)

**Goal:** Import and export industry-standard formats.

### 5.1 STEP (.step / .stp)
- Import via OCCT's `STEPControl_Reader`
- Export via `STEPControl_Writer`
- Preserve topology (faces, edges, shells) on import

### 5.2 STL (.stl)
- Export tessellated mesh (ASCII and binary STL)
- Configurable tessellation quality (chord deviation, angle deviation)
- Per-part and full-assembly export

### 5.3 3MF (.3mf)
- Export mesh + color/material data
- 3MF is a ZIP-based XML format — can be assembled in the browser

### 5.4 Native Project Format
- JSON-based parametric project file (feature tree + parameters)
- Versioned schema for forward compatibility
- Save/load to IndexedDB for local persistence
- Save/download as `.json` or `.zip` file

---

## Phase 6 — UX Polish (Weeks 33–44)

**Goal:** Make it feel like a professional tool.

### 6.1 UI Framework
- Command palette (Ctrl+K / Cmd+K)
- Context menus (right-click on faces, edges, features)
- Keyboard shortcuts system (configurable)
- Toolbar with icon buttons + tooltips
- Status bar (selection info, coordinates, units)
- Dimension input dialog (type exact values during operations)

### 6.2 Viewport Enhancements
- CAD-style mouse controls (middle-click pan, right-click orbit — or configurable)
- Smooth camera transitions (fly-to-face, zoom-to-fit)
- Named views (Front, Back, Top, Bottom, Left, Right, Isometric)
- Multiple viewports (split screen)
- Edge rendering (visible edges, hidden lines)

### 6.3 Measurement Tools
- Point-to-point distance
- Edge length
- Angle between faces/edges
- Surface area of selected faces

### 6.4 Visual Styles
- Shaded, shaded with edges, wireframe, hidden-line removal
- Dark/light theme
- Custom material appearances (metallic, plastic, glass — PBR materials)

---

## Phase 7 — Performance (Ongoing, focused in Weeks 40–48)

### 7.1 Web Worker Architecture
- All OCCT operations in a dedicated worker
- Tessellation in a worker (potentially multiple workers for assembly parts)
- Progress reporting for long operations
- Operation cancellation

### 7.2 Rendering Optimization
- Level-of-detail (LOD) for complex models
- Frustum culling (Three.js handles basic, but assembly-level culling needed)
- Instanced rendering for patterns
- GPU picking (color-based) instead of CPU raycasting for large models

### 7.3 Memory Management
- OCCT WASM memory management (shapes can be large)
- Tessellation caching
- Lazy tessellation (only tessellate visible parts)

---

## Phase 8 — Collaboration & Cloud (Weeks 48+)

### 8.1 Backend
- User authentication
- Cloud storage for projects
- Version history

### 8.2 Real-time Collaboration
- CRDT or OT-based sync for feature tree edits
- Presence (cursors, active selections)
- Conflict resolution for parametric features

import { create } from 'zustand'
import type * as THREE from 'three'

export interface SelectionState {
  selectedIds: string[]
  hoveredId: string | null
}

export interface AppState {
  // Selection
  selection: SelectionState
  setSelection: (ids: string[]) => void
  setHovered: (id: string | null) => void

  // Scene objects (tessellated meshes from OCCT)
  sceneObjects: Map<string, THREE.BufferGeometry>
  addSceneObject: (id: string, geometry: THREE.BufferGeometry) => void
  removeSceneObject: (id: string) => void
  clearSceneObjects: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Selection
  selection: {
    selectedIds: [],
    hoveredId: null,
  },
  setSelection: (ids) =>
    set((state) => ({ selection: { ...state.selection, selectedIds: ids } })),
  setHovered: (id) =>
    set((state) => ({ selection: { ...state.selection, hoveredId: id } })),

  // Scene objects
  sceneObjects: new Map(),
  addSceneObject: (id, geometry) =>
    set((state) => {
      const next = new Map(state.sceneObjects)
      next.set(id, geometry)
      return { sceneObjects: next }
    }),
  removeSceneObject: (id) =>
    set((state) => {
      const next = new Map(state.sceneObjects)
      next.delete(id)
      return { sceneObjects: next }
    }),
  clearSceneObjects: () => set({ sceneObjects: new Map() }),
}))

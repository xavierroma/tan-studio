import { create } from "zustand"

type WorkspaceState = {
  selectedRoastIds: string[]
  density: "comfortable" | "compact"
  liveNote: string
  addToComparison: (id: string) => void
  clearComparison: () => void
  setDensity: (density: WorkspaceState["density"]) => void
  setLiveNote: (note: string) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedRoastIds: [],
  density: "comfortable",
  liveNote: "",
  addToComparison: (id) =>
    set((state) => {
      if (state.selectedRoastIds.includes(id)) {
        return {
          selectedRoastIds: state.selectedRoastIds.filter(
            (candidate) => candidate !== id
          ),
        }
      }
      if (state.selectedRoastIds.length >= 4) {
        return { selectedRoastIds: [...state.selectedRoastIds.slice(1), id] }
      }
      return { selectedRoastIds: [...state.selectedRoastIds, id] }
    }),
  clearComparison: () => set({ selectedRoastIds: [] }),
  setDensity: (density) => set({ density }),
  setLiveNote: (liveNote) => set({ liveNote }),
}))

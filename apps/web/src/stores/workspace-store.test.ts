import { beforeEach, describe, expect, it } from "vitest"

import { useWorkspaceStore } from "@/stores/workspace-store"

describe("workspace comparison selection", () => {
  beforeEach(() => useWorkspaceStore.getState().clearComparison())

  it("toggles selection and keeps the most recent four roasts", () => {
    const { addToComparison } = useWorkspaceStore.getState()
    for (const id of ["a", "b", "c", "d", "e"]) addToComparison(id)

    expect(useWorkspaceStore.getState().selectedRoastIds).toEqual([
      "b",
      "c",
      "d",
      "e",
    ])
    addToComparison("c")
    expect(useWorkspaceStore.getState().selectedRoastIds).toEqual([
      "b",
      "d",
      "e",
    ])
  })
})

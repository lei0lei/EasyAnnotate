import { describe, expect, it } from "vitest"
import {
  remapIndexAfterDelete,
  remapIndexAfterReorder,
  reorderItemsByIndex,
  resolveReorderTargetIndex,
} from "./shape-ops"

describe("shape-ops", () => {
  it("resolveReorderTargetIndex should respect mode boundaries", () => {
    expect(resolveReorderTargetIndex(0, 5, "backward")).toBe(0)
    expect(resolveReorderTargetIndex(0, 5, "forward")).toBe(1)
    expect(resolveReorderTargetIndex(3, 5, "front")).toBe(4)
    expect(resolveReorderTargetIndex(3, 5, "back")).toBe(0)
  })

  it("reorderItemsByIndex should move item to target", () => {
    expect(reorderItemsByIndex(["a", "b", "c", "d"], 1, 3)).toEqual(["a", "c", "d", "b"])
    expect(reorderItemsByIndex(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"])
  })

  it("remapIndexAfterReorder should map indices correctly", () => {
    // move 1 -> 3
    expect(remapIndexAfterReorder(1, 1, 3)).toBe(3)
    expect(remapIndexAfterReorder(2, 1, 3)).toBe(1)
    expect(remapIndexAfterReorder(3, 1, 3)).toBe(2)
    expect(remapIndexAfterReorder(0, 1, 3)).toBe(0)
  })

  it("remapIndexAfterDelete should remove or shift indexes", () => {
    expect(remapIndexAfterDelete(2, 2)).toBeNull()
    expect(remapIndexAfterDelete(3, 2)).toBe(2)
    expect(remapIndexAfterDelete(1, 2)).toBe(1)
  })
})

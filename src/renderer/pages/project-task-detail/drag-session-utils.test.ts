import { describe, expect, it } from "vitest"
import { isDragSessionActive, shouldPersistAfterDrag } from "./drag-session-utils"

describe("drag-session-utils", () => {
  it("detects active drag session when any action exists", () => {
    expect(
      isDragSessionActive({
        shapeDragAction: null,
        polygonDragAction: null,
        polygonVertexDragAction: null,
        rotationDragAction: null,
        rotationTransformAction: null,
      }),
    ).toBe(false)

    expect(
      isDragSessionActive({
        shapeDragAction: { kind: "move" },
        polygonDragAction: null,
        polygonVertexDragAction: null,
        rotationDragAction: null,
        rotationTransformAction: null,
      }),
    ).toBe(true)
  })

  it("only persists when drag transitions from active to inactive", () => {
    expect(shouldPersistAfterDrag(false, false)).toBe(false)
    expect(shouldPersistAfterDrag(false, true)).toBe(false)
    expect(shouldPersistAfterDrag(true, true)).toBe(false)
    expect(shouldPersistAfterDrag(true, false)).toBe(true)
  })
})

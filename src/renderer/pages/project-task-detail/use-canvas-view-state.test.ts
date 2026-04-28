import { describe, expect, it } from "vitest"
import { canPanAndZoomFromState } from "./use-canvas-view-state"

describe("use-canvas-view-state helpers", () => {
  it("returns true when select mode and image ready", () => {
    expect(
      canPanAndZoomFromState({
        rightToolMode: "select",
        imageObjectUrl: "blob:ok",
        isImageLoading: false,
        imageLoadError: false,
        shapeDragAction: null,
        rotationDragAction: null,
        rotationTransformAction: null,
      }),
    ).toBe(true)
  })

  it("returns false when any blocking state exists", () => {
    expect(
      canPanAndZoomFromState({
        rightToolMode: "rect",
        imageObjectUrl: "blob:ok",
        isImageLoading: false,
        imageLoadError: false,
        shapeDragAction: null,
        rotationDragAction: null,
        rotationTransformAction: null,
      }),
    ).toBe(false)
    expect(
      canPanAndZoomFromState({
        rightToolMode: "select",
        imageObjectUrl: "",
        isImageLoading: false,
        imageLoadError: false,
        shapeDragAction: null,
        rotationDragAction: null,
        rotationTransformAction: null,
      }),
    ).toBe(false)
  })
})

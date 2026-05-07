import { describe, expect, it } from "vitest"
import { eraseMaskPointsByStroke } from "./mask-draw-ops"

describe("eraseMaskPointsByStroke", () => {
  it("removes samples whose center lies under eraser circle (path between sparse vertices)", () => {
    const brushSize = 20
    const eraserRadius = 10
    const kept = eraseMaskPointsByStroke({
      points: [
        [10, 0],
        [20, 0],
      ],
      brushSize,
      eraserStroke: [
        { x: 15, y: -30 },
        { x: 15, y: 30 },
      ],
      eraserRadius,
    })
    expect(kept.length).toBe(0)
  })

  it("keeps mask when farther than maskRadius + eraserRadius from eraser stroke", () => {
    const brushSize = 20
    const eraserRadius = 10
    const kept = eraseMaskPointsByStroke({
      points: [[0, 0]],
      brushSize,
      eraserStroke: [
        { x: 40, y: 0 },
        { x: 40, y: 10 },
      ],
      eraserRadius,
    })
    expect(kept).toEqual([[0, 0]])
  })

  it("removes sample when center is within eraserRadius of eraser segment", () => {
    const brushSize = 20
    const eraserRadius = 10
    const kept = eraseMaskPointsByStroke({
      points: [[14, 0]],
      brushSize,
      eraserStroke: [
        { x: 15, y: 0 },
        { x: 15, y: 5 },
      ],
      eraserRadius,
    })
    expect(kept.length).toBe(0)
  })

  it("handles single-point eraser stroke", () => {
    const brushSize = 20
    const eraserRadius = 10
    const kept = eraseMaskPointsByStroke({
      points: [[14, 0]],
      brushSize,
      eraserStroke: [{ x: 15, y: 0 }],
      eraserRadius,
    })
    expect(kept.length).toBe(0)
  })
})

import { describe, expect, it } from "vitest"
import {
  computeRectangleDragPoints,
  computeRotationCenterAndStartAngle,
  computeRotationDragPoints,
  computeRotationTransformPoints,
} from "./interaction-ops"
import type { RotationDragAction, RotationTransformAction, ShapeDragAction } from "./types"

describe("interaction ops", () => {
  it("computeRectangleDragPoints should move rectangle and clamp bounds", () => {
    const action: ShapeDragAction = {
      kind: "move",
      shapeIndex: 0,
      start: { x: 10, y: 10 },
      originalPoints: [
        [2, 2],
        [6, 2],
        [6, 6],
        [2, 6],
      ],
    }
    const next = computeRectangleDragPoints(action, { x: -10, y: 5 }, { width: 20, height: 20 })
    expect(next).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
  })

  it("computeRectangleDragPoints should resize from nw with min size", () => {
    const action: ShapeDragAction = {
      kind: "resize",
      handle: "nw",
      shapeIndex: 0,
      start: { x: 0, y: 0 },
      originalPoints: [
        [10, 10],
        [14, 10],
        [14, 14],
        [10, 14],
      ],
    }
    const next = computeRectangleDragPoints(action, { x: 20, y: 20 }, { width: 50, height: 50 })
    expect(next).toEqual([
      [13, 13],
      [14, 13],
      [14, 14],
      [13, 14],
    ])
  })

  it("computeRotationDragPoints should rotate points by pointer angle delta", () => {
    const action: RotationDragAction = {
      shapeIndex: 0,
      center: { x: 0, y: 0 },
      startAngle: 0,
      originalPoints: [
        [1, 0],
        [0, 1],
      ],
    }
    const next = computeRotationDragPoints(action, { x: 0, y: 1 })
    expect(next[0][0]).toBeCloseTo(0, 6)
    expect(next[0][1]).toBeCloseTo(1, 6)
    expect(next[1][0]).toBeCloseTo(-1, 6)
    expect(next[1][1]).toBeCloseTo(0, 6)
  })

  it("computeRotationTransformPoints should move rotation points", () => {
    const action: RotationTransformAction = {
      kind: "move",
      shapeIndex: 0,
      start: { x: 3, y: 3 },
      originalPoints: [
        [1, 1],
        [5, 1],
      ],
    }
    const next = computeRotationTransformPoints(action, { x: 5, y: 8 })
    expect(next).toEqual([
      [3, 6],
      [7, 6],
    ])
  })

  it("computeRotationTransformPoints should resize around center with axes", () => {
    const action: RotationTransformAction = {
      kind: "resize",
      shapeIndex: 0,
      handle: "ne",
      center: { x: 0, y: 0 },
      axisU: { x: 1, y: 0 },
      axisV: { x: 0, y: 1 },
    }
    const next = computeRotationTransformPoints(action, { x: 4, y: 2 })
    expect(next).toEqual([
      [-4, -2],
      [4, -2],
      [4, 2],
      [-4, 2],
    ])
  })

  it("computeRotationCenterAndStartAngle should calculate center and angle", () => {
    const originalPoints = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ]
    const result = computeRotationCenterAndStartAngle({ x: 4, y: 1 }, originalPoints)
    expect(result.center).toEqual({ x: 2, y: 1 })
    expect(result.startAngle).toBeCloseTo(0, 6)
  })
})

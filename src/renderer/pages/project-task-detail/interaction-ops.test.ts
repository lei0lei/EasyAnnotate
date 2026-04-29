import { describe, expect, it } from "vitest"
import {
  computeCuboidHandleDragPoints,
  computePolygonDragPoints,
  computeRectangleDragPoints,
  computeRotationCenterAndStartAngle,
  computeRotationDragPoints,
  computeRotationTransformPoints,
} from "./interaction-ops"
import type { PolygonVertexDragAction, RotationDragAction, RotationTransformAction, ShapeDragAction } from "./types"

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
      [4, 0],
      [4, 4],
      [0, 4],
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

  it("computeCuboidHandleDragPoints corner keeps front–back translation from snapshot", () => {
    const snap = [
      [0, 20],
      [20, 20],
      [20, 0],
      [0, 0],
      [5, 22],
      [25, 22],
      [25, 2],
      [5, 2],
    ]
    const action: PolygonVertexDragAction = { shapeIndex: 0, vertexIndex: 1, cuboidVertexStartSnapshot: snap }
    const next = computeCuboidHandleDragPoints(action, { x: 30, y: 20 }, snap, { width: 100, height: 100 })
    expect(next?.length).toBe(8)
    const tx = snap[4]![0] - snap[0]![0]
    const ty = snap[4]![1] - snap[0]![1]
    for (let i = 0; i < 4; i++) {
      expect(next![4 + i]![0] - next![i]![0]).toBeCloseTo(tx)
      expect(next![4 + i]![1] - next![i]![1]).toBeCloseTo(ty)
    }
  })

  it("computeCuboidHandleDragPoints front bottom edge mid adjusts maxY", () => {
    const snap = [
      [0, 20],
      [20, 20],
      [20, 0],
      [0, 0],
      [0, 20],
      [20, 20],
      [20, 0],
      [0, 0],
    ]
    const action: PolygonVertexDragAction = { shapeIndex: 0, vertexIndex: 4, cuboidVertexStartSnapshot: snap }
    const next = computeCuboidHandleDragPoints(action, { x: 10, y: 25 }, snap, { width: 100, height: 100 })
    expect(next?.[0]?.[1]).toBe(25)
    expect(next?.[1]?.[1]).toBe(25)
  })

  it("computeCuboidHandleDragPoints back trio translates only back face", () => {
    const snap = [
      [0, 20],
      [20, 20],
      [20, 0],
      [0, 0],
      [5, 10],
      [15, 10],
      [15, 0],
      [5, 0],
    ]
    const action: PolygonVertexDragAction = {
      shapeIndex: 0,
      vertexIndex: 8,
      cuboidVertexStartSnapshot: snap,
      cuboidPointerStart: { x: 10, y: 10 },
    }
    const next = computeCuboidHandleDragPoints(action, { x: 12, y: 11 }, snap, { width: 100, height: 100 })
    expect(next?.slice(0, 4)).toEqual(snap.slice(0, 4))
    expect(next![4]![0]).toBeCloseTo(snap[4]![0] + 2)
    expect(next![4]![1]).toBeCloseTo(snap[4]![1] + 1)
  })

  it("computePolygonDragPoints cuboid back subset moves only rear four points", () => {
    const orig = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [1, 1],
      [11, 1],
      [11, 11],
      [1, 11],
    ]
    const action = {
      shapeIndex: 0,
      start: { x: 0, y: 0 },
      originalPoints: orig,
      cuboidDragSubset: "back" as const,
    }
    const next = computePolygonDragPoints(action, { x: 2, y: 3 }, { width: 100, height: 100 })
    expect(next?.slice(0, 4)).toEqual(orig.slice(0, 4))
    expect(next![4]![0]).toBe(3)
    expect(next![4]![1]).toBe(4)
  })

  it("computePolygonDragPoints cuboid back subset clamps from original back bounds not shifted bounds", () => {
    const orig = [
      [0, 20],
      [20, 20],
      [20, 0],
      [0, 0],
      [40, 20],
      [60, 20],
      [60, 0],
      [40, 0],
    ]
    const action = {
      shapeIndex: 0,
      start: { x: 0, y: 0 },
      originalPoints: orig,
      cuboidDragSubset: "back" as const,
    }
    const next = computePolygonDragPoints(action, { x: 50, y: 0 }, { width: 200, height: 200 })
    expect(next?.slice(0, 4)).toEqual(orig.slice(0, 4))
    expect(next![4]![0]).toBe(90)
    expect(next![5]![0]).toBe(110)
  })
})

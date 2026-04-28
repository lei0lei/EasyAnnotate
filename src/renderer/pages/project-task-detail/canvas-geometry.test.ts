import { describe, expect, it } from "vitest"
import {
  buildImageGeometry,
  imageToStagePoint,
  stageToImagePoint,
  stageToImagePointStrict,
} from "./canvas-geometry"

describe("canvas geometry", () => {
  it("buildImageGeometry should center image by fit scale", () => {
    const geometry = buildImageGeometry({ width: 100, height: 50 }, { width: 400, height: 300 })
    expect(geometry).not.toBeNull()
    expect(geometry?.fitScale).toBe(4)
    expect(geometry?.baseWidth).toBe(400)
    expect(geometry?.baseHeight).toBe(200)
    expect(geometry?.baseLeft).toBe(0)
    expect(geometry?.baseTop).toBe(50)
  })

  it("should convert between image and stage coordinates", () => {
    const geometry = buildImageGeometry({ width: 100, height: 50 }, { width: 400, height: 300 })
    if (!geometry) throw new Error("geometry should exist")
    const transform = { scale: 1, offset: { x: 0, y: 0 } }
    const stage = imageToStagePoint({ x: 10, y: 5 }, geometry, transform)
    expect(stage).toEqual({ x: 40, y: 70 })
    const image = stageToImagePoint(stage, geometry, transform, { width: 100, height: 50 })
    expect(image.x).toBeCloseTo(10, 6)
    expect(image.y).toBeCloseTo(5, 6)
  })

  it("stageToImagePointStrict should return null outside image bounds", () => {
    const geometry = buildImageGeometry({ width: 100, height: 100 }, { width: 200, height: 200 })
    if (!geometry) throw new Error("geometry should exist")
    const strict = stageToImagePointStrict({ x: -100, y: -100 }, geometry, { scale: 1, offset: { x: 0, y: 0 } }, { width: 100, height: 100 })
    expect(strict).toBeNull()
  })
})

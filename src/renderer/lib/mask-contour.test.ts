import { describe, expect, it } from "vitest"
import { binaryMaskOuterContour, contourForYoloExport, minimumAreaBoundingBoxCornersFromPoints, obbCornersFromMaskBinary } from "./mask-contour"

function fillRect(data: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      data[y * w + x] = 1
    }
  }
}

describe("mask-contour", () => {
  it("traces a 3x3 solid block with closed chain", () => {
    const w = 8
    const h = 8
    const data = new Uint8Array(w * h)
    fillRect(data, w, 2, 2, 4, 4)
    const c = binaryMaskOuterContour(data, w, h)
    expect(c.length).toBeGreaterThanOrEqual(8)
    const xs = c.map((p) => p[0])
    const ys = c.map((p) => p[1])
    expect(Math.min(...xs)).toBe(2)
    expect(Math.max(...xs)).toBe(4)
    expect(Math.min(...ys)).toBe(2)
    expect(Math.max(...ys)).toBe(4)
  })

  it("obbCornersFromMaskBinary gives axis-aligned rect for solid block", () => {
    const w = 8
    const h = 8
    const data = new Uint8Array(w * h)
    fillRect(data, w, 2, 2, 4, 4)
    const obb = obbCornersFromMaskBinary(data, w, h)
    expect(obb).not.toBeNull()
    expect(obb!.length).toBe(4)
    const xs = obb!.map((p) => p[0]!)
    const ys = obb!.map((p) => p[1]!)
    expect(Math.min(...xs)).toBeCloseTo(2, 5)
    expect(Math.max(...xs)).toBeCloseTo(4, 5)
    expect(Math.min(...ys)).toBeCloseTo(2, 5)
    expect(Math.max(...ys)).toBeCloseTo(4, 5)
  })

  it("minimumAreaBoundingBoxCornersFromPoints on diagonal segment", () => {
    const obb = minimumAreaBoundingBoxCornersFromPoints([
      { x: 0, y: 0 },
      { x: 4, y: 4 },
    ])
    expect(obb).not.toBeNull()
    expect(obb!.length).toBe(4)
  })

  it("contourForYoloExport returns at least 3 points for L-shape", () => {
    const w = 12
    const h = 12
    const data = new Uint8Array(w * h)
    fillRect(data, w, 1, 1, 3, 1)
    fillRect(data, w, 1, 1, 1, 3)
    const c = contourForYoloExport(data, w, h)
    expect(c.length).toBeGreaterThanOrEqual(3)
  })
})

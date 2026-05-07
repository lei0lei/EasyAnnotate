import { describe, expect, it } from "vitest"
import {
  decodeRowMajorRleToBinary,
  encodeBinaryToRowMajorRle,
  foregroundBBoxInclusive,
  maskBinaryHasForeground,
  stampBrushPolyline,
  translateBinaryMask,
} from "./mask-raster-rle"

describe("mask-raster-rle", () => {
  it("roundtrips empty and full row-major RLE (COCO-style)", () => {
    const w = 4
    const h = 3
    const total = w * h
    const zeros = new Uint8Array(total)
    const e0 = encodeBinaryToRowMajorRle(zeros)
    expect(decodeRowMajorRleToBinary(e0, total).every((v) => v === 0)).toBe(true)

    const ones = new Uint8Array(total)
    ones.fill(1)
    const e1 = encodeBinaryToRowMajorRle(ones)
    expect(decodeRowMajorRleToBinary(e1, total).every((v) => v === 1)).toBe(true)
  })

  it("roundtrips a sparse mask", () => {
    const w = 5
    const h = 5
    const total = w * h
    const buf = new Uint8Array(total)
    buf[2 * w + 2] = 1
    buf[2 * w + 3] = 1
    const enc = encodeBinaryToRowMajorRle(buf)
    const dec = decodeRowMajorRleToBinary(enc, total)
    expect(dec[2 * w + 2]).toBe(1)
    expect(dec[2 * w + 3]).toBe(1)
    expect(foregroundBBoxInclusive(dec, w, h)).toEqual({ minX: 2, minY: 2, maxX: 3, maxY: 2 })
  })

  it("stamps brush and erases to zero", () => {
    const w = 20
    const h = 20
    const buf = new Uint8Array(w * h)
    buf.fill(1)
    expect(maskBinaryHasForeground(buf)).toBe(true)
    stampBrushPolyline(buf, w, h, [{ x: 10, y: 10 }], 22, 0, 8)
    expect(maskBinaryHasForeground(buf)).toBe(false)
  })

  it("translates binary mask", () => {
    const w = 8
    const h = 8
    const buf = new Uint8Array(w * h)
    buf[1 * w + 1] = 1
    const moved = translateBinaryMask(buf, w, h, 2, 1)
    expect(moved[2 * w + 3]).toBe(1)
    expect(maskBinaryHasForeground(moved)).toBe(true)
  })
})

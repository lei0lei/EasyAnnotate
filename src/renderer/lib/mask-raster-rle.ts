/**
 * CVAT/COCO 风格：行主序（row-major）二值 mask 的未压缩 RLE。
 * 第一段为「背景 0」的游程长度；若首像素为 1，则第一段长度为 0。
 */
import type { Point } from "@/pages/project-task-detail/types"

export const MASK_RLE_COUNTS_KEY = "maskRleCounts"
export const MASK_RLE_W_KEY = "maskRleWidth"
export const MASK_RLE_H_KEY = "maskRleHeight"

export function decodeRowMajorRleToBinary(counts: number[], totalPixels: number): Uint8Array {
  const out = new Uint8Array(totalPixels)
  let idx = 0
  let v = 0
  for (const run of counts) {
    const n = Math.max(0, Math.floor(Number(run)))
    for (let k = 0; k < n && idx < totalPixels; k += 1) {
      out[idx] = v
      idx += 1
    }
    v = v === 0 ? 1 : 0
  }
  return out
}

export function encodeBinaryToRowMajorRle(flat: Uint8Array): number[] {
  const n = flat.length
  if (n === 0) return []
  const counts: number[] = []
  let i = 0
  let val = 0
  if (flat[0] !== 0) {
    counts.push(0)
    val = 1
  }
  while (i < n) {
    let run = 0
    while (i < n && (flat[i] ? 1 : 0) === val) {
      run += 1
      i += 1
    }
    counts.push(run)
    val = val === 0 ? 1 : 0
  }
  return counts
}

export function readMaskRle(attrs: Record<string, unknown> | null | undefined): { counts: number[]; w: number; h: number } | null {
  if (!attrs || typeof attrs !== "object") return null
  const raw = attrs[MASK_RLE_COUNTS_KEY]
  if (!Array.isArray(raw) || raw.length === 0) return null
  const counts = raw.map((x) => Math.max(0, Math.floor(Number(x))))
  if (counts.some((c) => !Number.isFinite(c))) return null
  const w = Math.floor(Number(attrs[MASK_RLE_W_KEY]))
  const h = Math.floor(Number(attrs[MASK_RLE_H_KEY]))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { counts, w, h }
}

export function maskBinaryHasForeground(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i += 1) {
    if (data[i]) return true
  }
  return false
}

export function foregroundPixelCount(data: Uint8Array): number {
  let n = 0
  for (let i = 0; i < data.length; i += 1) {
    if (data[i]) n += 1
  }
  return n
}

export function foregroundBBoxInclusive(
  data: Uint8Array,
  w: number,
  h: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    for (let x = 0; x < w; x += 1) {
      if (data[row + x]) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { minX, minY, maxX, maxY }
}

export function stampDisk(buffer: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number, value: 0 | 1): void {
  if (radius <= 0) return
  const r2 = radius * radius
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(w - 1, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(h - 1, Math.ceil(cy + radius))
  for (let y = y0; y <= y1; y += 1) {
    const row = y * w
    const dy = y + 0.5 - cy
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx
      if (dx * dx + dy * dy <= r2) {
        buffer[row + x] = value
      }
    }
  }
}

function interpolateStrokePoints(from: Point, to: Point, brushSize: number): Point[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance <= 0.001) return []
  const spacing = Math.max(0.5, Math.min(6, brushSize * 0.2))
  const steps = Math.max(1, Math.ceil(distance / spacing))
  const points: Point[] = []
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    points.push({ x: from.x + dx * t, y: from.y + dy * t })
  }
  return points
}

/** 沿折线以圆盘 stamp；端点与插值点均覆盖。 */
export function stampBrushPolyline(
  buffer: Uint8Array,
  w: number,
  h: number,
  stroke: Point[],
  radius: number,
  value: 0 | 1,
  brushSizeHint: number,
): void {
  if (stroke.length === 0 || radius <= 0) return
  const first = stroke[0]
  if (!first) return
  stampDisk(buffer, w, h, first.x, first.y, radius, value)
  for (let i = 1; i < stroke.length; i += 1) {
    const a = stroke[i - 1]
    const b = stroke[i]
    if (!a || !b) continue
    const mid = interpolateStrokePoints(a, b, brushSizeHint)
    for (const p of mid) {
      stampDisk(buffer, w, h, p.x, p.y, radius, value)
    }
    stampDisk(buffer, w, h, b.x, b.y, radius, value)
  }
}

export function translateBinaryMask(src: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    const sy = y - dy
    if (sy < 0 || sy >= h) continue
    const dRow = y * w
    const sRow = sy * w
    for (let x = 0; x < w; x += 1) {
      const sx = x - dx
      if (sx >= 0 && sx < w) {
        out[dRow + x] = src[sRow + sx]
      }
    }
  }
  return out
}

export function loadMaskBinaryFromShape(
  shape: { shape_type: string; points: number[][]; attributes: Record<string, unknown> },
  imageW: number,
  imageH: number,
  fallbackBrushSize: number,
): Uint8Array {
  const total = imageW * imageH
  const rle = readMaskRle(shape.attributes)
  if (rle && rle.w === imageW && rle.h === imageH) {
    return decodeRowMajorRleToBinary(rle.counts, total)
  }
  const brushRaw =
    typeof shape.attributes?.brushSize === "number"
      ? Number(shape.attributes.brushSize)
      : typeof shape.attributes?.maskBrushSize === "number"
        ? Number(shape.attributes.maskBrushSize)
        : fallbackBrushSize
  const brushSize = Math.max(1, Number(brushRaw) || fallbackBrushSize)
  const radius = brushSize / 2
  const buf = new Uint8Array(total)
  if (shape.shape_type === "mask" && shape.points.length > 0) {
    const pts = shape.points.map((p) => ({ x: Number(p[0] ?? 0), y: Number(p[1] ?? 0) }))
    stampBrushPolyline(buf, imageW, imageH, pts, radius, 1, brushSize)
  }
  return buf
}

export function writeMaskRleAttributes(
  attrs: Record<string, unknown>,
  payload: { counts: number[]; w: number; h: number; brushSize: number },
): Record<string, unknown> {
  return {
    ...attrs,
    [MASK_RLE_COUNTS_KEY]: payload.counts,
    [MASK_RLE_W_KEY]: payload.w,
    [MASK_RLE_H_KEY]: payload.h,
    brushSize: payload.brushSize,
  }
}

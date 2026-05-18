/**
 * 扩散式标注：在浏览器端对 DINOv2 patch 特征做相似搜索（后端仅提供特征张量）。
 */
import { decodeBase64ToUint8Array } from "@/lib/base64-binary"
import type { Dinov2LetterboxMeta, Dinov2PatchFeaturesResponse } from "@/lib/dinov2-patch-features-api"
import { decodeRowMajorRleToBinary } from "@/lib/mask-raster-rle"

export type DiffusionSimilarityCandidate = {
  bbox: [number, number, number, number]
  score: number
  peak_x: number
  peak_y: number
}

export type DiffusionSimilaritySearchOptions = {
  seedBbox: [number, number, number, number]
  seedMaskRle?: { counts: number[]; w: number; h: number }
  similarityThreshold?: number
  maxInstances?: number
  nmsIou?: number
  minPeakDistance?: number
}

function unpackPatchGrid(resp: Dinov2PatchFeaturesResponse): Float32Array {
  const pf = resp.patch_features
  const bytes = decodeBase64ToUint8Array(pf.data_base64)
  const expected = resp.grid_h * resp.grid_w * resp.dim
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  if (floats.length < expected) {
    throw new Error(`patch_features size mismatch: got ${floats.length}, expected ${expected}`)
  }
  return floats
}

function patchWeightsFromSeed(
  meta: Dinov2LetterboxMeta,
  gh: number,
  gw: number,
  seedBbox: [number, number, number, number],
  seedMask: Uint8Array | null,
  maskW: number,
  maskH: number,
): Float32Array {
  const weights = new Float32Array(gh * gw)
  const [x1, y1, x2, y2] = seedBbox
  const patchPx = meta.img_size / Math.max(gh, 1)

  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const cxL = (gx + 0.5) * patchPx
      const cyL = (gy + 0.5) * patchPx
      const fx = (cxL - meta.pad_x) / meta.scale
      const fy = (cyL - meta.pad_y) / meta.scale
      if (fx < 0 || fy < 0 || fx >= meta.orig_w || fy >= meta.orig_h) continue
      if (seedMask) {
        const ix = Math.min(meta.orig_w - 1, Math.max(0, Math.floor(fx)))
        const iy = Math.min(meta.orig_h - 1, Math.max(0, Math.floor(fy)))
        if (ix < maskW && iy < maskH) {
          weights[gy * gw + gx] = seedMask[iy * maskW + ix]! ? 1 : 0
        }
      } else if (fx >= x1 && fx <= x2 && fy >= y1 && fy <= y2) {
        weights[gy * gw + gx] = 1
      }
    }
  }
  return weights
}

function bboxIou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ix1 = Math.max(a[0], b[0])
  const iy1 = Math.max(a[1], b[1])
  const ix2 = Math.min(a[2], b[2])
  const iy2 = Math.min(a[3], b[3])
  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)
  const inter = iw * ih
  if (inter <= 0) return 0
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1])
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}

function nmsBoxes(
  boxes: [number, number, number, number][],
  scores: number[],
  iouThr: number,
): number[] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
  const keep: number[] = []
  for (const i of order) {
    if (keep.some((j) => bboxIou(boxes[i]!, boxes[j]!) >= iouThr)) continue
    keep.push(i)
  }
  return keep
}

function patchIndexFromFullXY(
  x: number,
  y: number,
  meta: Dinov2LetterboxMeta,
  gh: number,
  gw: number,
): { gy: number; gx: number } | null {
  const lx = x * meta.scale + meta.pad_x
  const ly = y * meta.scale + meta.pad_y
  if (lx < 0 || ly < 0 || lx >= meta.img_size || ly >= meta.img_size) return null
  const patch = meta.img_size / Math.max(gh, 1)
  const gx = Math.min(gw - 1, Math.max(0, Math.floor(lx / patch)))
  const gy = Math.min(gh - 1, Math.max(0, Math.floor(ly / patch)))
  return { gy, gx }
}

/** 在已解码的 patch 特征上做全图相似搜索，返回候选 bbox 列表。 */
export function searchSimilarFromPatchFeatures(
  features: Dinov2PatchFeaturesResponse,
  options: DiffusionSimilaritySearchOptions,
): DiffusionSimilarityCandidate[] {
  const meta = features.letterbox
  const gh = features.grid_h
  const gw = features.grid_w
  const dim = features.dim
  const grid = unpackPatchGrid(features)

  const ow = meta.orig_w
  const oh = meta.orig_h
  let [x1, y1, x2, y2] = options.seedBbox
  x1 = Math.max(0, Math.min(x1, ow - 1))
  y1 = Math.max(0, Math.min(y1, oh - 1))
  x2 = Math.max(0, Math.min(x2, ow - 1))
  y2 = Math.max(0, Math.min(y2, oh - 1))
  if (x2 < x1) {
    const t = x1
    x1 = x2
    x2 = t
  }
  if (y2 < y1) {
    const t = y1
    y1 = y2
    y2 = t
  }
  const normBbox: [number, number, number, number] = [x1, y1, x2, y2]

  let seedMask: Uint8Array | null = null
  let maskW = 0
  let maskH = 0
  const rle = options.seedMaskRle
  if (rle && rle.w === ow && rle.h === oh) {
    seedMask = decodeRowMajorRleToBinary(rle.counts, rle.w * rle.h)
    maskW = rle.w
    maskH = rle.h
  }

  const weights = patchWeightsFromSeed(meta, gh, gw, normBbox, seedMask, maskW, maskH)
  let wSum = 0
  for (let i = 0; i < weights.length; i += 1) wSum += weights[i]!
  if (wSum < 1e-6) {
    const cx = (x1 + x2) * 0.5
    const cy = (y1 + y2) * 0.5
    const hit = patchIndexFromFullXY(cx, cy, meta, gh, gw)
    if (hit) {
      weights[hit.gy * gw + hit.gx] = 1
      wSum = 1
    } else {
      throw new Error("种子区域为空，请调整种子框")
    }
  }

  const proto = new Float32Array(dim)
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const w = weights[gy * gw + gx]!
      if (w <= 0) continue
      const base = (gy * gw + gx) * dim
      for (let d = 0; d < dim; d += 1) {
        proto[d] = (proto[d] ?? 0) + grid[base + d]! * w
      }
    }
  }
  for (let d = 0; d < dim; d += 1) proto[d] = proto[d]! / wSum
  let pNorm = 0
  for (let d = 0; d < dim; d += 1) pNorm += proto[d]! * proto[d]!
  pNorm = Math.sqrt(pNorm)
  if (pNorm < 1e-8) throw new Error("无法从种子构建 DINOv2 原型向量")
  for (let d = 0; d < dim; d += 1) proto[d] = proto[d]! / pNorm

  const scores = new Float32Array(gh * gw)
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let dot = 0
      let vNorm = 0
      const base = (gy * gw + gx) * dim
      for (let d = 0; d < dim; d += 1) {
        const v = grid[base + d]!
        dot += v * proto[d]!
        vNorm += v * v
      }
      scores[gy * gw + gx] = vNorm > 1e-8 ? dot / Math.sqrt(vNorm) : 0
    }
  }

  const seedHit = patchIndexFromFullXY((x1 + x2) * 0.5, (y1 + y2) * 0.5, meta, gh, gw)
  if (seedHit) scores[seedHit.gy * gw + seedHit.gx] = -1

  const similarityThreshold = Math.max(0, Math.min(1, options.similarityThreshold ?? 0.45))
  const maxInstances = Math.max(1, Math.min(32, options.maxInstances ?? 32))
  const nmsIou = options.nmsIou ?? 0.5
  const minPeakDistance = options.minPeakDistance ?? 0.35

  const bw = Math.max(4, x2 - x1)
  const bh = Math.max(4, y2 - y1)
  const patchPx = meta.img_size / Math.max(gh, 1)
  const minDistPatches = Math.max(1, (minPeakDistance * Math.max(bw, bh)) / patchPx * meta.scale)

  const order = Array.from({ length: gh * gw }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
  const peaks: { gy: number; gx: number; score: number }[] = []
  for (const idx of order) {
    const score = scores[idx]!
    if (score < similarityThreshold) break
    const gy = Math.floor(idx / gw)
    const gx = idx % gw
    if (peaks.some((p) => (gy - p.gy) ** 2 + (gx - p.gx) ** 2 < minDistPatches ** 2)) continue
    peaks.push({ gy, gx, score })
    if (peaks.length >= maxInstances * 3) break
  }

  const boxes: [number, number, number, number][] = []
  const peakScores: number[] = []
  const peakXy: [number, number][] = []
  const halfW = bw * 0.5
  const halfH = bh * 0.5

  for (const { gy, gx, score } of peaks) {
    const cxL = (gx + 0.5) * patchPx
    const cyL = (gy + 0.5) * patchPx
    const cx = (cxL - meta.pad_x) / meta.scale
    const cy = (cyL - meta.pad_y) / meta.scale
    boxes.push([
      Math.max(0, cx - halfW),
      Math.max(0, cy - halfH),
      Math.min(ow - 1, cx + halfW),
      Math.min(oh - 1, cy + halfH),
    ])
    peakScores.push(score)
    peakXy.push([cx, cy])
  }

  const keep = nmsBoxes(boxes, peakScores, nmsIou).slice(0, maxInstances)
  return keep.map((i) => {
    const b = boxes[i]!
    const [px, py] = peakXy[i]!
    return {
      bbox: [Math.round(b[0] * 100) / 100, Math.round(b[1] * 100) / 100, Math.round(b[2] * 100) / 100, Math.round(b[3] * 100) / 100] as [
        number,
        number,
        number,
        number,
      ],
      score: Math.round(peakScores[i]! * 10000) / 10000,
      peak_x: Math.round(px * 100) / 100,
      peak_y: Math.round(py * 100) / 100,
    }
  })
}

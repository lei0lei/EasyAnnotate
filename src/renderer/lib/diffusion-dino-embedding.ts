/**
 * 扩散标注：DINOv2 patch 网格上的种子原型与 mask 区域 embedding（供检索与 SAM 后过滤）。
 */
import { decodeBase64ToUint8Array } from "@/lib/base64-binary"
import type { Dinov2LetterboxMeta, Dinov2PatchFeaturesResponse } from "@/lib/dinov2-patch-features-api"
import { decodeRowMajorRleToBinary } from "@/lib/mask-raster-rle"

export type DiffusionDinoGrid = {
  grid: Float32Array
  meta: Dinov2LetterboxMeta
  gh: number
  gw: number
  dim: number
}

export function unpackDinoPatchGrid(resp: Dinov2PatchFeaturesResponse): DiffusionDinoGrid {
  const pf = resp.patch_features
  const bytes = decodeBase64ToUint8Array(pf.data_base64)
  const gh = resp.grid_h
  const gw = resp.grid_w
  const dim = resp.dim
  const expected = gh * gw * dim
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  if (floats.length < expected) {
    throw new Error(`patch_features size mismatch: got ${floats.length}, expected ${expected}`)
  }
  return { grid: floats, meta: resp.letterbox, gh, gw, dim }
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

function patchWeightsFromMask(
  meta: Dinov2LetterboxMeta,
  gh: number,
  gw: number,
  mask: Uint8Array,
  maskW: number,
  maskH: number,
): Float32Array {
  const weights = new Float32Array(gh * gw)
  const patchPx = meta.img_size / Math.max(gh, 1)
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const cxL = (gx + 0.5) * patchPx
      const cyL = (gy + 0.5) * patchPx
      const fx = (cxL - meta.pad_x) / meta.scale
      const fy = (cyL - meta.pad_y) / meta.scale
      if (fx < 0 || fy < 0 || fx >= meta.orig_w || fy >= meta.orig_h) continue
      const ix = Math.min(maskW - 1, Math.max(0, Math.floor(fx)))
      const iy = Math.min(maskH - 1, Math.max(0, Math.floor(fy)))
      if (mask[iy * maskW + ix]!) weights[gy * gw + gx] = 1
    }
  }
  return weights
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

function weightedPrototypeFromPatchWeights(
  grid: Float32Array,
  weights: Float32Array,
  gh: number,
  gw: number,
  dim: number,
  fallbackCenter?: { x: number; y: number },
  meta?: Dinov2LetterboxMeta,
): Float32Array {
  let wSum = 0
  for (let i = 0; i < weights.length; i += 1) wSum += weights[i]!
  if (wSum < 1e-6 && fallbackCenter && meta) {
    const hit = patchIndexFromFullXY(fallbackCenter.x, fallbackCenter.y, meta, gh, gw)
    if (hit) {
      weights[hit.gy * gw + hit.gx] = 1
      wSum = 1
    }
  }
  if (wSum < 1e-6) {
    throw new Error("区域为空，无法构建 DINOv2 特征向量")
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
  return normalizeVector(proto)
}

export function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let d = 0; d < v.length; d += 1) norm += v[d]! * v[d]!
  norm = Math.sqrt(norm)
  if (norm < 1e-8) throw new Error("无法构建有效的 DINOv2 特征向量")
  for (let d = 0; d < v.length; d += 1) v[d] = v[d]! / norm
  return v
}

export function cosineSimilarityNormalized(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let d = 0; d < a.length; d += 1) dot += a[d]! * b[d]!
  return dot
}

export type BuildSeedDinoPrototypeOptions = {
  seedBbox: [number, number, number, number]
  seedMaskRle?: { counts: number[]; w: number; h: number }
}

/** 与相似搜索一致：种子区域加权平均 patch 特征 → L2 归一化原型。 */
export function buildSeedDinoPrototype(
  features: Dinov2PatchFeaturesResponse,
  options: BuildSeedDinoPrototypeOptions,
): { proto: Float32Array; gridPack: DiffusionDinoGrid } {
  const gridPack = unpackDinoPatchGrid(features)
  const { grid, meta, gh, gw, dim } = gridPack
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
  const proto = weightedPrototypeFromPatchWeights(grid, weights, gh, gw, dim, {
    x: (x1 + x2) * 0.5,
    y: (y1 + y2) * 0.5,
  }, meta)
  return { proto, gridPack }
}

/** 从 SAM mask（全图 RLE）构建区域 embedding，与种子原型做余弦相似度。 */
export function dinoEmbeddingFromMaskRle(
  gridPack: DiffusionDinoGrid,
  maskRle: { counts: number[]; w: number; h: number },
): Float32Array | null {
  const { grid, meta, gh, gw, dim } = gridPack
  if (maskRle.w !== meta.orig_w || maskRle.h !== meta.orig_h) return null
  const mask = decodeRowMajorRleToBinary(maskRle.counts, maskRle.w * maskRle.h)
  let any = false
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      any = true
      break
    }
  }
  if (!any) return null
  const weights = patchWeightsFromMask(meta, gh, gw, mask, maskRle.w, maskRle.h)
  try {
    return weightedPrototypeFromPatchWeights(grid, weights, gh, gw, dim)
  } catch {
    return null
  }
}

export function dinoSimilarityMaskToPrototype(
  gridPack: DiffusionDinoGrid,
  seedProto: Float32Array,
  maskRle: { counts: number[]; w: number; h: number },
): number | null {
  const emb = dinoEmbeddingFromMaskRle(gridPack, maskRle)
  if (!emb) return null
  return cosineSimilarityNormalized(seedProto, emb)
}

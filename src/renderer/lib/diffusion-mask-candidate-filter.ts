/**
 * 扩散 SAM 精化后：按 mask DINO 相似度与 mask IoU 过滤候选。
 */
import type { DiffusionDinoGrid } from "@/lib/diffusion-dino-embedding"
import { dinoSimilarityMaskToPrototype } from "@/lib/diffusion-dino-embedding"
import { decodeRowMajorRleToBinary } from "@/lib/mask-raster-rle"

export type DiffusionRefinedForFilter = {
  id: string
  bbox: { x1: number; y1: number; x2: number; y2: number }
  score: number
  rle: { counts: number[]; w: number; h: number } | null
  selected: boolean
}

export type FilterDiffusionRefinedOptions = {
  seedProto: Float32Array
  gridPack: DiffusionDinoGrid
  /** 与相似搜索阈值一致，低于此值的 mask 丢弃 */
  minDinoSimilarity?: number
  /** 重叠 mask IoU ≥ 此值时只保留 DINO 相似度更高者 */
  maskNmsIou?: number
}

function maskIouBinary(a: Uint8Array, b: Uint8Array, w: number, h: number): number {
  const n = w * h
  if (a.length < n || b.length < n) return 0
  let inter = 0
  let unionA = 0
  let unionB = 0
  for (let i = 0; i < n; i += 1) {
    const fa = a[i]! > 0
    const fb = b[i]! > 0
    if (fa) unionA += 1
    if (fb) unionB += 1
    if (fa && fb) inter += 1
  }
  const union = unionA + unionB - inter
  return union > 0 ? inter / union : 0
}

/**
 * 1) 去掉无 mask 或 DINO 与种子相似度过低的项；
 * 2) 按 DINO 相似度降序，mask IoU NMS 保留高分。
 */
export function filterDiffusionRefinedByDinoAndMaskIou(
  items: DiffusionRefinedForFilter[],
  options: FilterDiffusionRefinedOptions,
): { kept: DiffusionRefinedForFilter[]; dinoRejected: number; nmsRejected: number } {
  const minSim = Math.max(0, Math.min(1, options.minDinoSimilarity ?? 0.45))
  const iouThr = Math.max(0, Math.min(1, options.maskNmsIou ?? 0.5))

  type Scored = DiffusionRefinedForFilter & { dinoScore: number; bin: Uint8Array }
  const scored: Scored[] = []
  let dinoRejected = 0

  for (const item of items) {
    if (!item.rle) {
      dinoRejected += 1
      continue
    }
    const sim = dinoSimilarityMaskToPrototype(options.gridPack, options.seedProto, item.rle)
    if (sim === null || sim < minSim) {
      dinoRejected += 1
      continue
    }
    const bin = decodeRowMajorRleToBinary(item.rle.counts, item.rle.w * item.rle.h)
    scored.push({ ...item, dinoScore: sim, score: sim, bin })
  }

  scored.sort((a, b) => b.dinoScore - a.dinoScore)
  const kept: DiffusionRefinedForFilter[] = []
  const keptBins: Uint8Array[] = []
  let nmsRejected = 0
  const w = options.gridPack.meta.orig_w
  const h = options.gridPack.meta.orig_h

  for (const item of scored) {
    const overlaps = keptBins.some((kb) => maskIouBinary(item.bin, kb, w, h) >= iouThr)
    if (overlaps) {
      nmsRejected += 1
      continue
    }
    keptBins.push(item.bin)
    const { bin: _bin, dinoScore: _d, ...rest } = item
    kept.push(rest)
  }

  return { kept, dinoRejected, nmsRejected }
}

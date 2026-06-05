/**
 * 扩散式标注：候选框检索与 SAM 后处理的可切换策略（类型与 UI 文案）。
 */
import type { Dinov2PatchFeaturesResponse } from "@/lib/dinov2-patch-features-api"
import type { DiffusionDinoGrid } from "@/lib/diffusion-dino-embedding"

export type DiffusionSeedBbox = { x1: number; y1: number; x2: number; y2: number }

export type DiffusionCandidateResult = {
  id: string
  bbox: DiffusionSeedBbox
  score: number
  mask: { maskBinary: Uint8Array; w: number; h: number } | null
  selected: boolean
}
import { filterDiffusionRefinedByDinoAndMaskIou } from "@/lib/diffusion-mask-candidate-filter"
import { decodeSamBboxOnSession, decodeSamCenterPointOnSession } from "@/lib/diffusion-sam-decode"
import {
  searchSimilarFromPatchFeatures,
  type DiffusionSimilarityCandidate,
  type DiffusionSimilaritySearchOptions,
} from "@/lib/diffusion-similarity"
import type { SamSessionCache } from "@/lib/sam2-session-api"
import {
  foregroundBBoxInclusive,
} from "@/lib/mask-raster-rle"

import type { DiffusionCandidateBoxStrategy } from "@/lib/diffusion-similarity"

export type { DiffusionCandidateBoxStrategy } from "@/lib/diffusion-similarity"

/** SAM 精化 + 可选 DINO / IoU 后处理 */
export type DiffusionRefinePostStrategy =
  | "center_point_dino_mask_iou"
  | "center_point_only"
  | "bbox_sam_only"

export const DIFFUSION_CANDIDATE_BOX_STRATEGIES: readonly DiffusionCandidateBoxStrategy[] = [
  "peak_score_extent",
  "score_connected",
  "peak_fixed_seed",
]

export const DIFFUSION_REFINE_POST_STRATEGIES: readonly DiffusionRefinePostStrategy[] = [
  "center_point_dino_mask_iou",
  "center_point_only",
  "bbox_sam_only",
]

export const DIFFUSION_CANDIDATE_BOX_LABELS: Record<DiffusionCandidateBoxStrategy, string> = {
  peak_score_extent: "峰值 + 局部相似区域（自适应大小）",
  score_connected: "相似度连通域（少重复框）",
  peak_fixed_seed: "峰值 + 固定种子尺寸框",
}

export const DIFFUSION_REFINE_POST_LABELS: Record<DiffusionRefinePostStrategy, string> = {
  center_point_dino_mask_iou: "中心点 SAM + DINO + Mask IoU",
  center_point_only: "中心点 SAM（无后处理）",
  bbox_sam_only: "矩形框 SAM（无后处理）",
}

export type SearchDiffusionSimilarCandidatesOptions = DiffusionSimilaritySearchOptions & {
  boxStrategy?: DiffusionCandidateBoxStrategy
}

export function searchDiffusionSimilarCandidates(
  features: Dinov2PatchFeaturesResponse,
  options: SearchDiffusionSimilarCandidatesOptions,
): DiffusionSimilarityCandidate[] {
  return searchSimilarFromPatchFeatures(features, options)
}

function bboxFromMask(mask: { maskBinary: Uint8Array; w: number; h: number }): DiffusionSeedBbox | null {
  const fb = foregroundBBoxInclusive(mask.maskBinary, mask.w, mask.h)
  if (!fb) return null
  return { x1: fb.minX, y1: fb.minY, x2: fb.maxX + 1, y2: fb.maxY + 1 }
}

function newCandidateId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `dc-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

export type RefineDiffusionCandidatesParams = {
  sessionCache: SamSessionCache
  similarityCandidates: DiffusionSimilarityCandidate[]
  postStrategy: DiffusionRefinePostStrategy
  seedDinoProto: Float32Array
  gridPack: DiffusionDinoGrid
  similarityThreshold?: number
  nmsIou?: number
  refineConcurrency?: number
  onProgress?: (message: string) => void
}

export type RefineDiffusionCandidatesResult = {
  candidates: DiffusionCandidateResult[]
  refinedSuccessCount: number
  refinedFailedCount: number
  dinoFilteredCount: number
  maskNmsFilteredCount: number
}

export async function refineDiffusionCandidates(
  params: RefineDiffusionCandidatesParams,
): Promise<RefineDiffusionCandidatesResult> {
  const total = params.similarityCandidates.length
  if (total === 0) {
    return {
      candidates: [],
      refinedSuccessCount: 0,
      refinedFailedCount: 0,
      dinoFilteredCount: 0,
      maskNmsFilteredCount: 0,
    }
  }

  const useCenterPoint =
    params.postStrategy === "center_point_dino_mask_iou" || params.postStrategy === "center_point_only"
  const applyDinoMaskFilter = params.postStrategy === "center_point_dino_mask_iou"

  const concurrency = Math.max(1, Math.min(6, Math.floor(params.refineConcurrency ?? 4)))
  let nextIndex = 0
  let done = 0
  let refinedSuccessCount = 0
  let refinedFailedCount = 0
  const rawRefined: DiffusionCandidateResult[] = new Array(total)
  const promptLabel = useCenterPoint ? "中心点" : "矩形框"
  params.onProgress?.(`SAM 精化 0/${total}（${promptLabel}，并发 ${Math.min(concurrency, total)}）…`)

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex
      nextIndex += 1
      if (i >= total) return
      const c = params.similarityCandidates[i]!
      const [x1, y1, x2, y2] = c.bbox
      const bbox = { x1, y1, x2, y2 }
      let mask: { maskBinary: Uint8Array; w: number; h: number } | null = null
      try {
        mask = useCenterPoint
          ? await decodeSamCenterPointOnSession(params.sessionCache, bbox)
          : await decodeSamBboxOnSession(params.sessionCache, bbox)
      } catch {
        mask = null
      }
      if (mask) refinedSuccessCount += 1
      else refinedFailedCount += 1
      const refinedBbox = mask ? (bboxFromMask(mask) ?? bbox) : bbox
      rawRefined[i] = {
        id: newCandidateId(),
        bbox: refinedBbox,
        score: c.score,
        mask,
        selected: true,
      }
      done += 1
      params.onProgress?.(`SAM 精化 ${done}/${total}…`)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()))

  if (!applyDinoMaskFilter) {
    const candidates = rawRefined.filter((x): x is DiffusionCandidateResult => x != null)
    return {
      candidates,
      refinedSuccessCount,
      refinedFailedCount,
      dinoFilteredCount: 0,
      maskNmsFilteredCount: 0,
    }
  }

  params.onProgress?.("DINO 相似度与 mask IoU 过滤…")
  const filterResult = filterDiffusionRefinedByDinoAndMaskIou(
    rawRefined.filter((x): x is DiffusionCandidateResult => x != null),
    {
      seedProto: params.seedDinoProto,
      gridPack: params.gridPack,
      minDinoSimilarity: params.similarityThreshold,
      maskNmsIou: params.nmsIou,
    },
  )
  return {
    candidates: filterResult.kept,
    refinedSuccessCount,
    refinedFailedCount,
    dinoFilteredCount: filterResult.dinoRejected,
    maskNmsFilteredCount: filterResult.nmsRejected,
  }
}

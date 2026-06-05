/**
 * 扩散式标注编排：SAM session prepare 一次 → 种子 decode → DINOv2 特征 → 前端相似搜索 → 批量 SAM decode。
 */
import { fetchDinov2PatchFeatures } from "@/lib/dinov2-patch-features-api"
import { buildSeedDinoPrototype } from "@/lib/diffusion-dino-embedding"
import {
  refineDiffusionCandidates,
  searchDiffusionSimilarCandidates,
  type DiffusionCandidateBoxStrategy,
  type DiffusionCandidateResult,
  type DiffusionRefinePostStrategy,
  type DiffusionSeedBbox,
} from "@/lib/diffusion-pipeline-strategies"
import {
  refinePostStrategyUsesDinoMaskFilter,
  type DiffusionPipelineVisualStep,
} from "@/lib/diffusion-process-visual"
import type { DiffusionSimilarityCandidate } from "@/lib/diffusion-similarity"
import { decodeSamBboxOnSession } from "@/lib/diffusion-sam-decode"
import { foregroundBBoxInclusive } from "@/lib/mask-raster-rle"
import { ensureSamSessionCache, type SamSessionCache } from "@/lib/sam2-session-api"

export type { DiffusionCandidateResult, DiffusionSeedBbox } from "@/lib/diffusion-pipeline-strategies"
export type {
  DiffusionCandidateBoxStrategy,
  DiffusionRefinePostStrategy,
} from "@/lib/diffusion-pipeline-strategies"

export type RunDiffusionPipelineParams = {
  imagePath: string
  samModelId: string
  dinov2ModelId: string
  inferScale: number
  seedBbox: DiffusionSeedBbox
  /** 种子引导策略：仅框 / 仅掩码 / 框+掩码 */
  seedGuideMode?: "bbox" | "mask" | "bbox_and_mask"
  sessionCache: SamSessionCache | null
  similarityThreshold?: number
  maxInstances?: number
  nmsIou?: number
  /** 候选 SAM 精化并发数（默认 4，建议 1~6；服务端仍全局排队） */
  refineConcurrency?: number
  /** 相似峰 → 候选框算法 */
  candidateBoxStrategy?: DiffusionCandidateBoxStrategy
  /** SAM 精化与后处理算法 */
  refinePostStrategy?: DiffusionRefinePostStrategy
  /** 为 true 时通过 onVisualStep 推送中间候选框叠加（需配合对话框开关） */
  animateProcess?: boolean
  onVisualStep?: (step: DiffusionPipelineVisualStep) => void | Promise<void>
  onProgress?: (message: string) => void
}

export type { DiffusionPipelineVisualStep } from "@/lib/diffusion-process-visual"

export type RunDiffusionPipelineResult = {
  sessionCache: SamSessionCache
  seedMask: { maskBinary: Uint8Array; w: number; h: number } | null
  candidates: DiffusionCandidateResult[]
  similarityCandidates: DiffusionSimilarityCandidate[]
  refinedSuccessCount: number
  refinedFailedCount: number
  /** SAM 有 mask 但被 DINO 相似度过滤掉的数量 */
  dinoFilteredCount: number
  /** DINO 通过但被 mask IoU NMS 去掉的数量 */
  maskNmsFilteredCount: number
}

function bboxFromMask(mask: { maskBinary: Uint8Array; w: number; h: number }): DiffusionSeedBbox | null {
  const fb = foregroundBBoxInclusive(mask.maskBinary, mask.w, mask.h)
  if (!fb) return null
  return { x1: fb.minX, y1: fb.minY, x2: fb.maxX + 1, y2: fb.maxY + 1 }
}

export async function runDiffusionPipeline(params: RunDiffusionPipelineParams): Promise<RunDiffusionPipelineResult> {
  const path = params.imagePath.trim()
  const { samModelId, dinov2ModelId, inferScale, seedBbox } = params
  const onProgress = params.onProgress
  const seedGuideMode = params.seedGuideMode ?? "bbox_and_mask"

  onProgress?.("SAM 图像编码…")
  const sessionCache = await ensureSamSessionCache(path, samModelId, inferScale, params.sessionCache)

  onProgress?.("SAM 精化种子…")
  const seedMask = await decodeSamBboxOnSession(sessionCache, seedBbox)
  const refinedSeedBbox = seedMask ? (bboxFromMask(seedMask) ?? seedBbox) : seedBbox

  let querySeedBbox: [number, number, number, number] = [
    refinedSeedBbox.x1,
    refinedSeedBbox.y1,
    refinedSeedBbox.x2,
    refinedSeedBbox.y2,
  ]
  let querySeedMask: { maskBinary: Uint8Array; w: number; h: number } | undefined = undefined
  if (seedGuideMode === "mask") {
    querySeedMask = seedMask ?? undefined
  } else if (seedGuideMode === "bbox_and_mask") {
    querySeedMask = seedMask ?? undefined
  }

  onProgress?.("DINOv2 提取 patch 特征…")
  const patchFeatures = await fetchDinov2PatchFeatures(dinov2ModelId, path)

  const { proto: seedDinoProto, gridPack } = buildSeedDinoPrototype(patchFeatures, {
    seedBbox: querySeedBbox,
    seedMask: querySeedMask,
  })

  onProgress?.("前端相似搜索…")
  const similarityCandidates = searchDiffusionSimilarCandidates(patchFeatures, {
    seedBbox: querySeedBbox,
    seedMask: querySeedMask,
    similarityThreshold: params.similarityThreshold,
    maxInstances: params.maxInstances,
    nmsIou: params.nmsIou,
    boxStrategy: params.candidateBoxStrategy ?? "peak_score_extent",
  })

  const refinePostStrategy = params.refinePostStrategy ?? "center_point_dino_mask_iou"
  if (params.animateProcess && params.onVisualStep) {
    await params.onVisualStep({ kind: "similarity_boxes", similarityCandidates })
  }

  const refineResult = await refineDiffusionCandidates({
    sessionCache,
    similarityCandidates,
    postStrategy: refinePostStrategy,
    seedDinoProto,
    gridPack,
    similarityThreshold: params.similarityThreshold,
    nmsIou: params.nmsIou,
    refineConcurrency: params.refineConcurrency,
    onProgress,
  })

  const {
    candidates,
    refinedSuccessCount,
    refinedFailedCount,
    dinoFilteredCount,
    maskNmsFilteredCount,
  } = refineResult

  if (params.animateProcess && params.onVisualStep) {
    await params.onVisualStep({ kind: "clear" })
    if (refinePostStrategyUsesDinoMaskFilter(refinePostStrategy) && candidates.length > 0) {
      await params.onVisualStep({ kind: "refined_boxes", candidates })
      await params.onVisualStep({ kind: "clear" })
    }
  }

  return {
    sessionCache,
    seedMask,
    candidates,
    similarityCandidates,
    refinedSuccessCount,
    refinedFailedCount,
    dinoFilteredCount,
    maskNmsFilteredCount,
  }
}

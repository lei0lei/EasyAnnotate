/**
 * 扩散式标注编排：SAM encode 一次 → 种子 decode → DINOv2 特征 → 前端相似搜索 → 批量 SAM decode。
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
import { decodeSamBboxOnEncodeCache } from "@/lib/diffusion-sam-decode"
import {
  decodeRowMajorRleToBinary,
  foregroundBBoxInclusive,
} from "@/lib/mask-raster-rle"
import { fetchSamImageEmbeddings, type Sam2EmbedCache } from "@/lib/sam2-encode-api"
import { isSamCvatsFeatureLayout, loadSamDecoderSession } from "@/lib/sam2-cvat-onnx"

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
  embedCache: Sam2EmbedCache | null
  similarityThreshold?: number
  maxInstances?: number
  nmsIou?: number
  /** 候选 SAM 精化并发数（默认 4，建议 1~6） */
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
  embedCache: Sam2EmbedCache
  seedMaskRle: { counts: number[]; w: number; h: number } | null
  candidates: DiffusionCandidateResult[]
  similarityCandidates: DiffusionSimilarityCandidate[]
  refinedSuccessCount: number
  refinedFailedCount: number
  /** SAM 有 mask 但被 DINO 相似度过滤掉的数量 */
  dinoFilteredCount: number
  /** DINO 通过但被 mask IoU NMS 去掉的数量 */
  maskNmsFilteredCount: number
}

function bboxFromMaskRle(rle: { counts: number[]; w: number; h: number }): DiffusionSeedBbox | null {
  const bin = decodeRowMajorRleToBinary(rle.counts, rle.w * rle.h)
  const fb = foregroundBBoxInclusive(bin, rle.w, rle.h)
  if (!fb) return null
  return { x1: fb.minX, y1: fb.minY, x2: fb.maxX + 1, y2: fb.maxY + 1 }
}

export async function ensureSamEmbedCache(
  imagePath: string,
  samModelId: string,
  inferScale: number,
  existing: Sam2EmbedCache | null,
): Promise<Sam2EmbedCache> {
  if (
    existing &&
    existing.imagePath === imagePath.trim() &&
    (existing.inferScale ?? 1) === inferScale &&
    existing.response.model_id === samModelId
  ) {
    return existing
  }
  const response = await fetchSamImageEmbeddings(samModelId, imagePath, { inferScale })
  if (!isSamCvatsFeatureLayout(response.feature_layout)) {
    throw new Error("当前 SAM 模型不支持浏览器 decoder；请使用 SAM 2.1 或 MobileSAM")
  }
  await loadSamDecoderSession(response.model_id)
  return { imagePath: imagePath.trim(), inferScale, response }
}

export async function runDiffusionPipeline(params: RunDiffusionPipelineParams): Promise<RunDiffusionPipelineResult> {
  const path = params.imagePath.trim()
  const { samModelId, dinov2ModelId, inferScale, seedBbox } = params
  const onProgress = params.onProgress
  const seedGuideMode = params.seedGuideMode ?? "bbox_and_mask"

  onProgress?.("SAM 图像编码…")
  const embedCache = await ensureSamEmbedCache(path, samModelId, inferScale, params.embedCache)

  onProgress?.("SAM 精化种子…")
  const seedRle = await decodeSamBboxOnEncodeCache(embedCache.response, seedBbox)
  const refinedSeedBbox = seedRle ? (bboxFromMaskRle(seedRle) ?? seedBbox) : seedBbox

  let querySeedBbox: [number, number, number, number] = [
    refinedSeedBbox.x1,
    refinedSeedBbox.y1,
    refinedSeedBbox.x2,
    refinedSeedBbox.y2,
  ]
  let querySeedMaskRle: { counts: number[]; w: number; h: number } | undefined = undefined
  if (seedGuideMode === "mask") {
    querySeedMaskRle = seedRle ?? undefined
  } else if (seedGuideMode === "bbox_and_mask") {
    querySeedMaskRle = seedRle ?? undefined
  }

  onProgress?.("DINOv2 提取 patch 特征…")
  const patchFeatures = await fetchDinov2PatchFeatures(dinov2ModelId, path)

  const { proto: seedDinoProto, gridPack } = buildSeedDinoPrototype(patchFeatures, {
    seedBbox: querySeedBbox,
    seedMaskRle: querySeedMaskRle,
  })

  onProgress?.("前端相似搜索…")
  const similarityCandidates = searchDiffusionSimilarCandidates(patchFeatures, {
    seedBbox: querySeedBbox,
    seedMaskRle: querySeedMaskRle,
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
    encodeResponse: embedCache.response,
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
    embedCache,
    seedMaskRle: seedRle,
    candidates,
    similarityCandidates,
    refinedSuccessCount,
    refinedFailedCount,
    dinoFilteredCount,
    maskNmsFilteredCount,
  }
}

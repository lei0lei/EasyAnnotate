/**
 * 扩散式标注编排：SAM encode 一次 → 种子 decode → DINOv2 特征 → 前端相似搜索 → 批量 SAM decode。
 */
import { fetchDinov2PatchFeatures } from "@/lib/dinov2-patch-features-api"
import { decodeSamBboxOnEncodeCache } from "@/lib/diffusion-sam-decode"
import {
  searchSimilarFromPatchFeatures,
  type DiffusionSimilarityCandidate,
} from "@/lib/diffusion-similarity"
import {
  decodeRowMajorRleToBinary,
  foregroundBBoxInclusive,
} from "@/lib/mask-raster-rle"
import { fetchSamImageEmbeddings, type Sam2EmbedCache } from "@/lib/sam2-encode-api"
import { isSamCvatsFeatureLayout, loadSamDecoderSession } from "@/lib/sam2-cvat-onnx"

export type DiffusionSeedBbox = { x1: number; y1: number; x2: number; y2: number }

export type DiffusionCandidateResult = {
  id: string
  bbox: DiffusionSeedBbox
  score: number
  rle: { counts: number[]; w: number; h: number } | null
  selected: boolean
}

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
  onProgress?: (message: string) => void
}

export type RunDiffusionPipelineResult = {
  embedCache: Sam2EmbedCache
  seedMaskRle: { counts: number[]; w: number; h: number } | null
  candidates: DiffusionCandidateResult[]
  similarityCandidates: DiffusionSimilarityCandidate[]
  refinedSuccessCount: number
  refinedFailedCount: number
}

function bboxFromMaskRle(rle: { counts: number[]; w: number; h: number }): DiffusionSeedBbox | null {
  const bin = decodeRowMajorRleToBinary(rle.counts, rle.w * rle.h)
  const fb = foregroundBBoxInclusive(bin, rle.w, rle.h)
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

  onProgress?.("前端相似搜索…")
  const similarityCandidates = searchSimilarFromPatchFeatures(patchFeatures, {
    seedBbox: querySeedBbox,
    seedMaskRle: querySeedMaskRle,
    similarityThreshold: params.similarityThreshold,
    maxInstances: params.maxInstances,
    nmsIou: params.nmsIou,
  })

  const total = similarityCandidates.length
  const candidates: DiffusionCandidateResult[] = new Array(total)
  if (total > 0) {
    const concurrency = Math.max(1, Math.min(6, Math.floor(params.refineConcurrency ?? 4)))
    let nextIndex = 0
    let done = 0
    let refinedSuccessCount = 0
    let refinedFailedCount = 0
    onProgress?.(`SAM 精化候选 0/${total}（并发 ${Math.min(concurrency, total)}）…`)

    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex
        nextIndex += 1
        if (i >= total) return
        const c = similarityCandidates[i]!
        const [x1, y1, x2, y2] = c.bbox
        const bbox = { x1, y1, x2, y2 }
        let rle: { counts: number[]; w: number; h: number } | null = null
        try {
          rle = await decodeSamBboxOnEncodeCache(embedCache.response, bbox)
        } catch {
          rle = null
        }
        if (rle) refinedSuccessCount += 1
        else refinedFailedCount += 1
        const refinedBbox = rle ? (bboxFromMaskRle(rle) ?? bbox) : bbox
        candidates[i] = {
          id: newCandidateId(),
          bbox: refinedBbox,
          score: c.score,
          rle,
          selected: true,
        }
        done += 1
        onProgress?.(`SAM 精化候选 ${done}/${total}…`)
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker())
    await Promise.all(workers)
    return {
      embedCache,
      seedMaskRle: seedRle,
      candidates,
      similarityCandidates,
      refinedSuccessCount,
      refinedFailedCount,
    }
  }

  return {
    embedCache,
    seedMaskRle: seedRle,
    candidates,
    similarityCandidates,
    refinedSuccessCount: 0,
    refinedFailedCount: 0,
  }
}

/**
 * 扩散搜索过程动画：中间候选框叠加与步骤间隔。
 */
import type { DiffusionCandidateResult } from "@/lib/diffusion-pipeline-strategies"
import type { DiffusionRefinePostStrategy } from "@/lib/diffusion-pipeline-strategies"
import type { DiffusionSimilarityCandidate } from "@/lib/diffusion-similarity"

export const DIFFUSION_PROCESS_ANIM_MS = 900

export const DIFFUSION_PROCESS_SIMILARITY_COLOR = "#06b6d4"
export const DIFFUSION_PROCESS_REFINED_COLOR = "#a855f7"

export type DiffusionProcessOverlayStage = "similarity" | "refined"

export type DiffusionProcessOverlayItem = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
}

export type DiffusionProcessOverlay = {
  stage: DiffusionProcessOverlayStage
  items: DiffusionProcessOverlayItem[]
}

export type DiffusionPipelineVisualStep =
  | { kind: "similarity_boxes"; similarityCandidates: DiffusionSimilarityCandidate[] }
  | { kind: "refined_boxes"; candidates: DiffusionCandidateResult[] }
  | { kind: "clear" }

export function refinePostStrategyUsesDinoMaskFilter(strategy: DiffusionRefinePostStrategy): boolean {
  return strategy === "center_point_dino_mask_iou"
}

export function buildSimilarityProcessOverlay(
  similarityCandidates: DiffusionSimilarityCandidate[],
): DiffusionProcessOverlay {
  return {
    stage: "similarity",
    items: similarityCandidates.map((c, i) => {
      const [x1, y1, x2, y2] = c.bbox
      return {
        id: `sim-${i}`,
        x1,
        y1,
        x2,
        y2,
        color: DIFFUSION_PROCESS_SIMILARITY_COLOR,
      }
    }),
  }
}

export function buildRefinedProcessOverlay(candidates: DiffusionCandidateResult[]): DiffusionProcessOverlay {
  return {
    stage: "refined",
    items: candidates.map((c) => ({
      id: c.id,
      x1: c.bbox.x1,
      y1: c.bbox.y1,
      x2: c.bbox.x2,
      y2: c.bbox.y2,
      color: DIFFUSION_PROCESS_REFINED_COLOR,
    })),
  }
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export type DiffusionProcessStageRect = {
  id: string
  stage: DiffusionProcessOverlayStage
  left: number
  top: number
  width: number
  height: number
  color: string
  clippedLeft: boolean
  clippedTop: boolean
  clippedRight: boolean
  clippedBottom: boolean
}

type Point = { x: number; y: number }

type ImageGeometryLike = {
  stageWidth?: number
  stageHeight?: number
}

function imageBboxToStageRect(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  stage: DiffusionProcessOverlayStage,
  imageGeometry: ImageGeometryLike,
  imageToStage: (point: Point) => Point | null,
): DiffusionProcessStageRect | null {
  const p1 = imageToStage({ x: x1, y: y1 })
  const p2 = imageToStage({ x: x2, y: y2 })
  if (!p1 || !p2) return null
  const left = Math.min(p1.x, p2.x)
  const top = Math.min(p1.y, p2.y)
  const width = Math.abs(p1.x - p2.x)
  const height = Math.abs(p1.y - p2.y)
  const stageW = imageGeometry.stageWidth ?? 0
  const stageH = imageGeometry.stageHeight ?? 0
  const right = left + width
  const bottom = top + height
  const clippedLeft = stageW > 0 ? Math.max(0, left) : left
  const clippedTop = stageH > 0 ? Math.max(0, top) : top
  const clippedRight = stageW > 0 ? Math.min(stageW, right) : right
  const clippedBottom = stageH > 0 ? Math.min(stageH, bottom) : bottom
  if (clippedRight - clippedLeft < 1 || clippedBottom - clippedTop < 1) return null
  return {
    id,
    stage,
    color,
    left: clippedLeft,
    top: clippedTop,
    width: Math.max(0, clippedRight - clippedLeft),
    height: Math.max(0, clippedBottom - clippedTop),
    clippedLeft: clippedLeft > left,
    clippedTop: clippedTop > top,
    clippedRight: clippedRight < right,
    clippedBottom: clippedBottom < bottom,
  }
}

export function diffusionProcessOverlayToStageRects(
  overlay: DiffusionProcessOverlay | null,
  imageGeometry: ImageGeometryLike | null,
  imageToStage: ((point: Point) => Point | null) | null,
): DiffusionProcessStageRect[] {
  if (!overlay || !imageGeometry || !imageToStage) return []
  const out: DiffusionProcessStageRect[] = []
  for (const item of overlay.items) {
    const r = imageBboxToStageRect(
      item.id,
      item.x1,
      item.y1,
      item.x2,
      item.y2,
      item.color,
      overlay.stage,
      imageGeometry,
      imageToStage,
    )
    if (r) out.push(r)
  }
  return out
}

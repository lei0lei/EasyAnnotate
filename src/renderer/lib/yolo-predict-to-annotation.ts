import {
  MASK_RLE_COUNTS_KEY,
  MASK_RLE_H_KEY,
  MASK_RLE_W_KEY,
  encodeBinaryToRowMajorRle,
} from "@/lib/mask-raster-rle"
import type { ProjectTag } from "@/lib/projects-api"
import type { XAnyLabelShape } from "@/lib/xanylabeling-format"

export type YoloBatchDetection = {
  class_id: number
  class_name?: string | null
  confidence: number
  shape_type: string
  points: number[][]
  group_id?: number
  keypoint_index?: number
  mask_rle?: { counts: number[]; w: number; h: number }
}

export type YoloBatchPredictResult = {
  model_slug: string
  task: string
  results: Array<{
    names?: Record<number, string>
    shape?: [number, number] | null
    detections: YoloBatchDetection[]
  }>
}

function tagKind(t: ProjectTag): "plain" | "skeleton" {
  return t.kind === "skeleton" ? "skeleton" : "plain"
}

/** 项目可接受的类别名（仅普通标签，不含骨架模板类）。 */
export function buildAllowedProjectLabelSet(tags: ProjectTag[]): Set<string> {
  const out = new Set<string>()
  for (const t of tags) {
    if (tagKind(t) === "skeleton") continue
    const name = t.name.trim()
    if (name) out.add(name)
  }
  return out
}

function resolveLabel(className: string | null | undefined, allowed: Set<string>): string | null {
  const raw = (className ?? "").trim()
  if (!raw) return null
  if (allowed.has(raw)) return raw
  return null
}

const MAX_POLYGON_VERTS = 256

function downsamplePolygon(points: number[][]): number[][] {
  if (points.length <= MAX_POLYGON_VERTS) return points
  const step = Math.max(1, Math.floor(points.length / MAX_POLYGON_VERTS))
  return points.filter((_, idx) => idx % step === 0).slice(0, MAX_POLYGON_VERTS)
}

function clampPoints(points: number[][], imageW: number, imageH: number): number[][] {
  const w = Math.max(1, imageW)
  const h = Math.max(1, imageH)
  return points
    .map((p) => {
      const x = Math.max(0, Math.min(w - 1, Math.round(Number(p[0] ?? 0))))
      const y = Math.max(0, Math.min(h - 1, Math.round(Number(p[1] ?? 0))))
      return [x, y]
    })
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
}

function baseShape(
  label: string,
  score: number,
  shape_type: XAnyLabelShape["shape_type"],
  points: number[][],
  attributes: Record<string, unknown> = {},
  group_id: number | null = null,
): XAnyLabelShape {
  return {
    label,
    score,
    points,
    group_id,
    description: null,
    difficult: false,
    shape_type,
    flags: null,
    attributes,
    kie_linking: [],
  }
}

export function yoloDetectionsToShapes(
  detections: YoloBatchDetection[],
  allowedLabels: Set<string>,
  imageW: number,
  imageH: number,
): XAnyLabelShape[] {
  const shapes: XAnyLabelShape[] = []
  for (const det of detections) {
    const label = resolveLabel(det.class_name, allowedLabels)
    if (!label) continue
    const score = Number.isFinite(det.confidence) ? det.confidence : null
    const shapeType = (det.shape_type || "rectangle").trim() as XAnyLabelShape["shape_type"]
    let points = clampPoints(det.points ?? [], imageW, imageH)

    if (shapeType === "rectangle" && points.length >= 4) {
      const xs = points.map((p) => p[0]!)
      const ys = points.map((p) => p[1]!)
      points = [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
        [Math.min(...xs), Math.max(...ys)],
      ]
    }

    if (shapeType === "polygon") {
      points = downsamplePolygon(points)
    }

    if (shapeType === "point" && points.length < 1) continue
    if (shapeType === "polygon" && points.length < 3) continue
    if ((shapeType === "rectangle" || shapeType === "rotation") && points.length < 4) continue

    const groupId =
      typeof det.group_id === "number" && Number.isFinite(det.group_id) ? Math.floor(det.group_id) : null

    if (det.mask_rle && det.mask_rle.w > 0 && det.mask_rle.h > 0) {
      shapes.push(
        baseShape(label, score, "mask", [], {
          [MASK_RLE_COUNTS_KEY]: det.mask_rle.counts,
          [MASK_RLE_W_KEY]: det.mask_rle.w,
          [MASK_RLE_H_KEY]: det.mask_rle.h,
          brushSize: 1,
        }),
      )
      continue
    }

    shapes.push(baseShape(label, score, shapeType, points, {}, groupId))
  }
  return shapes
}

export function yoloPredictResultToShapes(
  predict: YoloBatchPredictResult,
  allowedLabels: Set<string>,
  imageW: number,
  imageH: number,
): XAnyLabelShape[] {
  const block = predict.results?.[0]
  if (!block?.detections?.length) return []
  return yoloDetectionsToShapes(block.detections, allowedLabels, imageW, imageH)
}

/** 将二值 mask（行主序）编码为 shape（用于后续扩展 segment RLE 上传）。 */
export function maskBinaryToShape(
  label: string,
  score: number,
  flat: Uint8Array,
  w: number,
  h: number,
): XAnyLabelShape {
  return baseShape(label, score, "mask", [], {
    [MASK_RLE_COUNTS_KEY]: encodeBinaryToRowMajorRle(flat),
    [MASK_RLE_W_KEY]: w,
    [MASK_RLE_H_KEY]: h,
    brushSize: 1,
  })
}

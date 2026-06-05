/** 主进程/子进程：YOLO predict JSON → X-AnyLabeling shapes */

export type YoloBatchDetection = {
  class_id: number
  class_name?: string | null
  confidence: number
  shape_type: string
  points: number[][]
  group_id?: number
  keypoint_index?: number
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

type XAnyLabelShape = {
  label: string
  score: number | null
  points: number[][]
  group_id: number | null
  description: string | null
  difficult: boolean
  shape_type: string
  flags: Record<string, unknown> | null
  attributes: Record<string, unknown>
  kie_linking: unknown[]
}

function resolveLabel(className: string | null | undefined, allowed: Set<string>): string | null {
  const raw = (className ?? "").trim()
  if (!raw) return null
  if (allowed.has(raw)) return raw
  return null
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
  score: number | null,
  shape_type: string,
  points: number[][],
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
    attributes: {},
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
    const shapeType = (det.shape_type || "rectangle").trim()
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

    if (shapeType === "point" && points.length < 1) continue
    if (shapeType === "polygon" && points.length < 3) continue
    if ((shapeType === "rectangle" || shapeType === "rotation") && points.length < 4) continue

    const groupId =
      typeof det.group_id === "number" && Number.isFinite(det.group_id) ? Math.floor(det.group_id) : null

    shapes.push(baseShape(label, score, shapeType, points, groupId))
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

export function detectionDebugSummary(predict: YoloBatchPredictResult): string {
  const detections = predict.results?.[0]?.detections ?? []
  if (detections.length <= 0) return "detections=0"
  const sample = detections
    .slice(0, 6)
    .map((det) => {
      const name = (det.class_name ?? "").trim()
      return `${det.class_id}:${name || "<empty>"}`
    })
    .join(", ")
  return `detections=${detections.length}; sample=[${sample}]`
}

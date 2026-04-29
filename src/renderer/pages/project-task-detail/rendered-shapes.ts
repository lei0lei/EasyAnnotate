/**
 * 模块：project-task-detail/rendered-shapes
 * 职责：将标注文档转换为画布渲染结构（矩形、旋转框、多边形、Mask）。
 * 边界：只负责渲染数据投影，不负责修改原始标注。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { splitMaskPointSegments } from "@/pages/project-task-detail/annotateTools/mask-draw-ops"
import { getShapeStableId } from "@/pages/project-task-detail/shape-identity"
import type {
  Point,
  RenderedCuboid2d,
  RenderedMask,
  RenderedPoint,
  RenderedPolygon,
  RenderedRectangle,
  RenderedRotationRect,
  RenderedSkeleton,
} from "@/pages/project-task-detail/types"

type ImageToStageFn = (point: Point) => Point | null

type RenderShapeContext = {
  annotationDoc: XAnyLabelFile | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  labelColorMap: Map<string, string>
  imageToStage: ImageToStageFn
}

export function buildRenderedRectangles(context: RenderShapeContext & { stageWidth: number; stageHeight: number }): RenderedRectangle[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, stageWidth, stageHeight } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "rectangle" || shape.points.length < 4) return null
      const stagePoints = shape.points.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
      if (stagePoints.length < 4) return null
      const xs = stagePoints.map((item) => item.x)
      const ys = stagePoints.map((item) => item.y)
      const left = Math.min(...xs)
      const right = Math.max(...xs)
      const top = Math.min(...ys)
      const bottom = Math.max(...ys)
      const clippedLeft = stageWidth > 0 ? Math.max(0, left) : left
      const clippedTop = stageHeight > 0 ? Math.max(0, top) : top
      const clippedRight = stageWidth > 0 ? Math.min(stageWidth, right) : right
      const clippedBottom = stageHeight > 0 ? Math.min(stageHeight, bottom) : bottom
      if (clippedRight - clippedLeft < 1 || clippedBottom - clippedTop < 1) return null
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        left: clippedLeft,
        top: clippedTop,
        width: Math.max(1, clippedRight - clippedLeft),
        height: Math.max(1, clippedBottom - clippedTop),
        clippedLeft: clippedLeft > left,
        clippedTop: clippedTop > top,
        clippedRight: clippedRight < right,
        clippedBottom: clippedBottom < bottom,
      }
    })
    .filter((item): item is RenderedRectangle => !!item)
}

export function buildRenderedRotationRects(context: RenderShapeContext): RenderedRotationRect[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "rotation" || shape.points.length < 4) return null
      const imagePts = shape.points
        .slice(0, 4)
        .map((pt) => ({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) })) as [Point, Point, Point, Point]
      const centerImage = {
        x: (imagePts[0].x + imagePts[1].x + imagePts[2].x + imagePts[3].x) / 4,
        y: (imagePts[0].y + imagePts[1].y + imagePts[2].y + imagePts[3].y) / 4,
      }
      const ux = imagePts[1].x - imagePts[0].x
      const uy = imagePts[1].y - imagePts[0].y
      const vx = imagePts[3].x - imagePts[0].x
      const vy = imagePts[3].y - imagePts[0].y
      const uLen = Math.hypot(ux, uy) || 1
      const vLen = Math.hypot(vx, vy) || 1
      const axisUImage = { x: ux / uLen, y: uy / uLen }
      const axisVImage = { x: vx / vLen, y: vy / vLen }
      const stagePts = imagePts.map((pt) => imageToStage(pt)).filter((item): item is Point => !!item)
      if (stagePts.length < 4) return null
      const p = stagePts as [Point, Point, Point, Point]
      const center = {
        x: (p[0].x + p[1].x + p[2].x + p[3].x) / 4,
        y: (p[0].y + p[1].y + p[2].y + p[3].y) / 4,
      }
      const topMid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }
      const handleVecX = topMid.x - center.x
      const handleVecY = topMid.y - center.y
      const len = Math.hypot(handleVecX, handleVecY) || 1
      const rotateHandle = {
        x: topMid.x + (handleVecX / len) * 26,
        y: topMid.y + (handleVecY / len) * 26,
      }
      const xs = p.map((item) => item.x)
      const ys = p.map((item) => item.y)
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        imagePoints: imagePts,
        stagePoints: p,
        centerImage,
        axisUImage,
        axisVImage,
        center,
        topMid,
        rotateHandle,
        boundLeft: Math.min(...xs),
        boundTop: Math.min(...ys),
        boundRight: Math.max(...xs),
        boundBottom: Math.max(...ys),
      }
    })
    .filter((item): item is RenderedRotationRect => !!item)
}

export function buildRenderedPolygons(context: RenderShapeContext): RenderedPolygon[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "polygon" || shape.points.length < 3) return null
      const stagePoints = shape.points.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
      if (stagePoints.length < 3) return null
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        stagePoints,
      }
    })
    .filter((item): item is RenderedPolygon => !!item)
}

function readSkeletonEdgeIndexPairs(shape: { attributes?: Record<string, unknown> }): [number, number][] {
  const raw = shape.attributes?.skeleton as { edges?: unknown } | undefined
  if (!raw || !Array.isArray(raw.edges)) return []
  const out: [number, number][] = []
  for (const item of raw.edges) {
    if (Array.isArray(item) && item.length >= 2) {
      const a = Number(item[0])
      const b = Number(item[1])
      if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b])
    }
  }
  return out
}

function readSkeletonPointLabels(shape: { attributes?: Record<string, unknown> }): string[] {
  const raw = shape.attributes?.skeleton as { pointIds?: unknown } | undefined
  if (!raw || !Array.isArray(raw.pointIds)) return []
  return raw.pointIds.map((id) => (typeof id === "string" && id.trim() ? id : "?"))
}

export function buildRenderedSkeletons(context: RenderShapeContext): RenderedSkeleton[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "skeleton" || shape.points.length < 1) return null
      const stagePoints = shape.points.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
      if (stagePoints.length < 1) return null
      const edgeIndexPairs = readSkeletonEdgeIndexPairs(shape)
      const pointLabels = readSkeletonPointLabels(shape)
      while (pointLabels.length < stagePoints.length) {
        pointLabels.push(`p${pointLabels.length + 1}`)
      }
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        stagePoints,
        edgeIndexPairs,
        pointLabels: pointLabels.slice(0, stagePoints.length),
      }
    })
    .filter((item): item is RenderedSkeleton => !!item)
}

export function buildRenderedPoints(context: RenderShapeContext): RenderedPoint[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "point" || shape.points.length < 1) return null
      const p0 = shape.points[0]
      if (!p0) return null
      const stagePoint = imageToStage({ x: Number(p0[0] ?? 0), y: Number(p0[1] ?? 0) })
      if (!stagePoint) return null
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        stagePoint,
      }
    })
    .filter((item): item is RenderedPoint => !!item)
}

export function buildRenderedMasks(context: RenderShapeContext & { stageScale: number }): RenderedMask[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, stageScale } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "mask" || shape.points.length < 1) return null
      const brushSizeRaw =
        typeof shape.attributes?.brushSize === "number"
          ? shape.attributes.brushSize
          : typeof shape.attributes?.maskBrushSize === "number"
            ? shape.attributes.maskBrushSize
            : 16
      const brushSize = Math.max(1, Number(brushSizeRaw) || 16)
      const stagePoints = shape.points.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
      if (stagePoints.length < 1) return null
      const stageSegments = splitMaskPointSegments(shape.points, brushSize)
        .map((segment) =>
          segment
            .map((pt) => imageToStage({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
            .filter((item): item is Point => !!item),
        )
        .filter((segment) => segment.length > 0)
      const xs = stagePoints.map((item) => item.x)
      const ys = stagePoints.map((item) => item.y)
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const right = Math.max(...xs)
      const bottom = Math.max(...ys)
      const stageBrushSize = Math.max(1, brushSize * Math.max(0.01, stageScale))
      const halfBrush = stageBrushSize / 2
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        stagePoints,
        stageSegments,
        brushSize,
        left: left - halfBrush,
        top: top - halfBrush,
        width: Math.max(stageBrushSize, right - left + stageBrushSize),
        height: Math.max(stageBrushSize, bottom - top + stageBrushSize),
      }
    })
    .filter((item): item is RenderedMask => !!item)
}

function readCuboid2dHeightPx(shape: { attributes?: Record<string, unknown> }): number {
  const raw = shape.attributes?.height_px ?? shape.attributes?.heightPx
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function buildRenderedCuboids2d(context: RenderShapeContext): RenderedCuboid2d[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "cuboid2d" || shape.points.length < 4) return null
      const usesExplicitQuadPair = shape.points.length >= 8
      let baseStagePoints: Point[]
      let topStagePoints: Point[]
      let heightPx: number
      if (usesExplicitQuadPair) {
        const baseImage = shape.points.slice(0, 4).map((pt) => ({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
        const topImage = shape.points.slice(4, 8).map((pt) => ({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
        baseStagePoints = baseImage.map((p) => imageToStage(p)).filter((p): p is Point => !!p)
        topStagePoints = topImage.map((p) => imageToStage(p)).filter((p): p is Point => !!p)
        if (baseStagePoints.length < 4 || topStagePoints.length < 4) return null
        heightPx = readCuboid2dHeightPx(shape)
      } else {
        heightPx = readCuboid2dHeightPx(shape)
        if (heightPx < 1) return null
        const baseImage = shape.points.slice(0, 4).map((pt) => ({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
        baseStagePoints = baseImage.map((p) => imageToStage(p)).filter((p): p is Point => !!p)
        if (baseStagePoints.length < 4) return null
        const topImage = baseImage.map((p) => ({ x: p.x, y: p.y - heightPx }))
        topStagePoints = topImage.map((p) => imageToStage(p)).filter((p): p is Point => !!p)
        if (topStagePoints.length < 4) return null
      }
      const all = [...baseStagePoints, ...topStagePoints]
      const xs = all.map((p) => p.x)
      const ys = all.map((p) => p.y)
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const right = Math.max(...xs)
      const bottom = Math.max(...ys)
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        heightPx,
        usesExplicitQuadPair,
        baseStagePoints,
        topStagePoints,
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      }
    })
    .filter((item): item is RenderedCuboid2d => !!item)
}

/**
 * 模块：project-task-detail/rendered-shapes
 * 职责：将标注文档转换为画布渲染结构（矩形、旋转框、多边形、Mask）。
 * 边界：只负责渲染数据投影，不负责修改原始标注。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { ProjectTag } from "@/lib/projects-api"
import {
  decodeRowMajorRleToBinary,
  foregroundBBoxInclusive,
  maskBinaryHasForeground,
  readMaskRle,
} from "@/lib/mask-raster-rle"
import {
  resolveSkeletonTemplateForClassName,
  skeletonJointDisplayLabelsFromTemplate,
} from "@/lib/skeleton-template"
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

/** 拖拽中仅覆盖画布展示用的点位，不写回文档，避免每帧整份 doc 克隆 */
export type DragLivePointsOverride = { shapeIndex: number; points: number[][] }

/** 单顶点拖拽预览（polygon / skeleton / cuboid 顶点），避免触发其它类型 rendered* 整表重算 */
export type DragVertexLiveOverride = { shapeIndex: number; vertexIndex: number; imageX: number; imageY: number }

/** 拖拽中覆盖 RLE 栅格 mask 的展示数据 */
export type DragLiveMaskRleOverride = { shapeIndex: number; counts: number[]; w: number; h: number; brushSize: number }

/** SAM2 会话中尚未按 N 提交的整图 RLE 预览（非文档内形状） */
export type Sam2DraftMaskRle = { counts: number[]; w: number; h: number; label: string; color: string }

type RenderShapeContext = {
  annotationDoc: XAnyLabelFile | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  labelColorMap: Map<string, string>
  imageToStage: ImageToStageFn
  /** 用于骨架关节显示名与项目模板对齐 */
  projectTags?: ProjectTag[]
  dragLivePoints?: DragLivePointsOverride | null
  dragLiveMaskRle?: DragLiveMaskRleOverride | null
  /** SAM2：当前轮次 ONNX 预览 mask，叠在文档 mask 之上 */
  sam2DraftMaskRle?: Sam2DraftMaskRle | null
}

function shapePointsWithLiveOverride(
  index: number,
  shape: { points: number[][] },
  dragLivePoints: DragLivePointsOverride | null | undefined,
): number[][] {
  if (dragLivePoints && dragLivePoints.shapeIndex === index) return dragLivePoints.points
  return shape.points
}

function shapePointsWithVertexOrLiveOverride(
  index: number,
  shape: { points: number[][] },
  dragLivePoints: DragLivePointsOverride | null | undefined,
  dragVertexLive: DragVertexLiveOverride | null | undefined,
): number[][] {
  if (dragLivePoints && dragLivePoints.shapeIndex === index) return dragLivePoints.points
  if (dragVertexLive && dragVertexLive.shapeIndex === index) {
    const { vertexIndex, imageX, imageY } = dragVertexLive
    const pts = shape.points
    if (vertexIndex < 0 || vertexIndex >= pts.length) return pts
    return pts.map((row, i) => {
      if (i !== vertexIndex) return row
      const next = [...row]
      next[0] = imageX
      next[1] = imageY
      return next
    })
  }
  return shape.points
}

/** cuboid2d 拖拽预览单独通道，避免每帧触发其它 rendered* 的 useMemo 全量重算 */
function shapePointsForCuboid2d(
  index: number,
  shape: { points: number[][] },
  dragCuboidLivePoints: DragLivePointsOverride | null | undefined,
  dragLivePoints: DragLivePointsOverride | null | undefined,
  dragVertexLive: DragVertexLiveOverride | null | undefined,
): number[][] {
  if (dragCuboidLivePoints && dragCuboidLivePoints.shapeIndex === index) return dragCuboidLivePoints.points
  return shapePointsWithVertexOrLiveOverride(index, shape, dragLivePoints, dragVertexLive)
}

export function buildRenderedRectangles(context: RenderShapeContext & { stageWidth: number; stageHeight: number }): RenderedRectangle[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, stageWidth, stageHeight, dragLivePoints } =
    context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      const pts = shapePointsWithLiveOverride(index, shape, dragLivePoints)
      if (shape.shape_type !== "rectangle" || pts.length < 4) return null
      const stagePoints = pts.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
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
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, dragLivePoints } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      const pts = shapePointsWithLiveOverride(index, shape, dragLivePoints)
      if (shape.shape_type !== "rotation" || pts.length < 4) return null
      const imagePts = pts
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

export function buildRenderedPolygons(
  context: RenderShapeContext & { dragVertexLive?: DragVertexLiveOverride | null },
): RenderedPolygon[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, dragLivePoints, dragVertexLive } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      const pts = shapePointsWithVertexOrLiveOverride(index, shape, dragLivePoints, dragVertexLive)
      if (shape.shape_type !== "polygon" || pts.length < 3) return null
      const stagePoints = pts.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
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

function readSkeletonPointIds(shape: { attributes?: Record<string, unknown> }): string[] {
  const raw = shape.attributes?.skeleton as { pointIds?: unknown } | undefined
  if (!raw || !Array.isArray(raw.pointIds)) return []
  return raw.pointIds.map((id) => (typeof id === "string" && id.trim() ? id.trim() : ""))
}

export function buildRenderedSkeletons(
  context: RenderShapeContext & { dragVertexLive?: DragVertexLiveOverride | null },
): RenderedSkeleton[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, projectTags, dragLivePoints, dragVertexLive } =
    context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      const pts = shapePointsWithVertexOrLiveOverride(index, shape, dragLivePoints, dragVertexLive)
      if (shape.shape_type !== "skeleton" || pts.length < 1) return null
      const stagePoints = pts.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
      if (stagePoints.length < 1) return null
      const edgeIndexPairs = readSkeletonEdgeIndexPairs(shape)
      const pointIds = readSkeletonPointIds(shape)
      const template = resolveSkeletonTemplateForClassName(projectTags, shape.label)
      const pointLabels = template
        ? skeletonJointDisplayLabelsFromTemplate(template, pointIds, stagePoints.length)
        : stagePoints.map((_, i) => `p${i + 1}`)
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        stagePoints,
        edgeIndexPairs,
        pointLabels,
      }
    })
    .filter((item): item is RenderedSkeleton => !!item)
}

export function buildRenderedPoints(context: RenderShapeContext): RenderedPoint[] {
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, dragLivePoints } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      const pts = shapePointsWithLiveOverride(index, shape, dragLivePoints)
      if (shape.shape_type !== "point" || pts.length < 1) return null
      const p0 = pts[0]
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
  const { annotationDoc, hiddenShapeIndexes, hiddenClassLabels, labelColorMap, imageToStage, dragLiveMaskRle, dragLivePoints, sam2DraftMaskRle } =
    context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  const docIw = annotationDoc.imageWidth
  const docIh = annotationDoc.imageHeight
  const list = annotationDoc.shapes
    .map((shape, index): RenderedMask | null => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      if (shape.shape_type !== "mask") return null
      const brushSizeRaw =
        typeof shape.attributes?.brushSize === "number"
          ? shape.attributes.brushSize
          : typeof shape.attributes?.maskBrushSize === "number"
            ? shape.attributes.maskBrushSize
            : 16
      const brushSize = Math.max(1, Number(brushSizeRaw) || 16)

      const rleFromDoc = readMaskRle(shape.attributes)
      const rle =
        dragLiveMaskRle && dragLiveMaskRle.shapeIndex === index
          ? { counts: dragLiveMaskRle.counts, w: dragLiveMaskRle.w, h: dragLiveMaskRle.h }
          : rleFromDoc
      const brushSizeForRaster =
        dragLiveMaskRle && dragLiveMaskRle.shapeIndex === index ? dragLiveMaskRle.brushSize : brushSize
      if (rle && rle.w === docIw && rle.h === docIh) {
        const total = docIw * docIh
        const bin = decodeRowMajorRleToBinary(rle.counts, total)
        if (!maskBinaryHasForeground(bin)) return null
        const bbox = foregroundBBoxInclusive(bin, docIw, docIh)
        if (!bbox) return null
        /** 外接框与前景像素格对齐，不再按笔刷半径外扩 */
        const tightCorners: Point[] = [
          { x: bbox.minX, y: bbox.minY },
          { x: bbox.maxX + 1, y: bbox.minY },
          { x: bbox.maxX + 1, y: bbox.maxY + 1 },
          { x: bbox.minX, y: bbox.maxY + 1 },
        ]
        const stageTight = tightCorners.map((p) => imageToStage(p)).filter((item): item is Point => !!item)
        if (stageTight.length < 1) return null
        const xs = stageTight.map((item) => item.x)
        const ys = stageTight.map((item) => item.y)
        const left = Math.min(...xs)
        const top = Math.min(...ys)
        const right = Math.max(...xs)
        const bottom = Math.max(...ys)
        const imageCorners: Point[] = [
          { x: 0, y: 0 },
          { x: docIw, y: 0 },
          { x: docIw, y: docIh },
          { x: 0, y: docIh },
        ]
        const stageImg = imageCorners.map((p) => imageToStage(p)).filter((item): item is Point => !!item)
        if (stageImg.length < 4) return null
        const ixs = stageImg.map((p) => p.x)
        const iys = stageImg.map((p) => p.y)
        const sil = Math.min(...ixs)
        const sit = Math.min(...iys)
        const siw = Math.max(...ixs) - sil
        const sih = Math.max(...iys) - sit
        return {
          index,
          shapeId: getShapeStableId(shape, index),
          label: shape.label,
          color: labelColorMap.get(shape.label) ?? "#f59e0b",
          stagePoints: [],
          stageSegments: [],
          brushSize: brushSizeForRaster,
          left,
          top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
          raster: { counts: rle.counts, imageWidth: docIw, imageHeight: docIh },
          stageImageRect: { left: sil, top: sit, width: Math.max(1, siw), height: Math.max(1, sih) },
        }
      }

      const ptsVec = shapePointsWithLiveOverride(index, shape, dragLivePoints)
      if (ptsVec.length < 1) return null
      const stagePoints = ptsVec.map((pt) => imageToStage({ x: pt[0], y: pt[1] })).filter((item): item is Point => !!item)
      if (stagePoints.length < 1) return null
      const stageSegments = splitMaskPointSegments(ptsVec, brushSize)
        .map((segment) =>
          segment
            .map((pt) => imageToStage({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
            .filter((item): item is Point => !!item),
        )
        .filter((segment) => segment.length > 0)
      /** 在图像坐标下用笔刷半径包络中心线，再投到 stage，避免 stage 上二次加粗选框 */
      const r = brushSize / 2
      let minIX = Infinity
      let minIY = Infinity
      let maxIX = -Infinity
      let maxIY = -Infinity
      for (const pt of ptsVec) {
        const x = Number(pt[0] ?? 0)
        const y = Number(pt[1] ?? 0)
        minIX = Math.min(minIX, x - r)
        maxIX = Math.max(maxIX, x + r)
        minIY = Math.min(minIY, y - r)
        maxIY = Math.max(maxIY, y + r)
      }
      const legacyCorners: Point[] = [
        { x: minIX, y: minIY },
        { x: maxIX, y: minIY },
        { x: maxIX, y: maxIY },
        { x: minIX, y: maxIY },
      ]
      const stageLegacy = legacyCorners.map((p) => imageToStage(p)).filter((item): item is Point => !!item)
      if (stageLegacy.length < 1) return null
      const lxs = stageLegacy.map((item) => item.x)
      const lys = stageLegacy.map((item) => item.y)
      const left = Math.min(...lxs)
      const top = Math.min(...lys)
      const right = Math.max(...lxs)
      const bottom = Math.max(...lys)
      return {
        index,
        shapeId: getShapeStableId(shape, index),
        label: shape.label,
        color: labelColorMap.get(shape.label) ?? "#f59e0b",
        stagePoints,
        stageSegments,
        brushSize,
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      }
    })
    .filter((item): item is RenderedMask => !!item)

  if (!sam2DraftMaskRle || sam2DraftMaskRle.w !== docIw || sam2DraftMaskRle.h !== docIh) return list

  const total = docIw * docIh
  const bin = decodeRowMajorRleToBinary(sam2DraftMaskRle.counts, total)
  if (!maskBinaryHasForeground(bin)) return list
  const bbox = foregroundBBoxInclusive(bin, docIw, docIh)
  if (!bbox) return list
  const tightCorners: Point[] = [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX + 1, y: bbox.minY },
    { x: bbox.maxX + 1, y: bbox.maxY + 1 },
    { x: bbox.minX, y: bbox.maxY + 1 },
  ]
  const stageTight = tightCorners.map((p) => imageToStage(p)).filter((item): item is Point => !!item)
  if (stageTight.length < 1) return list
  const xs = stageTight.map((item) => item.x)
  const ys = stageTight.map((item) => item.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  const imageCorners: Point[] = [
    { x: 0, y: 0 },
    { x: docIw, y: 0 },
    { x: docIw, y: docIh },
    { x: 0, y: docIh },
  ]
  const stageImg = imageCorners.map((p) => imageToStage(p)).filter((item): item is Point => !!item)
  if (stageImg.length < 4) return list
  const ixs = stageImg.map((p) => p.x)
  const iys = stageImg.map((p) => p.y)
  const sil = Math.min(...ixs)
  const sit = Math.min(...iys)
  const siw = Math.max(...ixs) - sil
  const sih = Math.max(...iys) - sit
  const draftMask: RenderedMask = {
    index: -1,
    shapeId: "__eaSam2Draft",
    label: sam2DraftMaskRle.label,
    color: sam2DraftMaskRle.color,
    stagePoints: [],
    stageSegments: [],
    brushSize: 1,
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    raster: { counts: sam2DraftMaskRle.counts, imageWidth: docIw, imageHeight: docIh },
    stageImageRect: { left: sil, top: sit, width: Math.max(1, siw), height: Math.max(1, sih) },
  }
  return [...list, draftMask]
}

function readCuboid2dHeightPx(shape: { attributes?: Record<string, unknown> }): number {
  const raw = shape.attributes?.height_px ?? shape.attributes?.heightPx
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function buildRenderedCuboids2d(
  context: RenderShapeContext & {
    dragVertexLive?: DragVertexLiveOverride | null
    /** 与 dragLivePoints 分离：仅 cuboid 拖拽每帧更新，不触发矩形/多边形/mask 等 memo */
    dragCuboidLivePoints?: DragLivePointsOverride | null
  },
): RenderedCuboid2d[] {
  const {
    annotationDoc,
    hiddenShapeIndexes,
    hiddenClassLabels,
    labelColorMap,
    imageToStage,
    dragLivePoints,
    dragCuboidLivePoints,
    dragVertexLive,
  } = context
  if (!annotationDoc) return []
  const hiddenSet = new Set(hiddenShapeIndexes)
  const hiddenClassSet = new Set(hiddenClassLabels)
  return annotationDoc.shapes
    .map((shape, index) => {
      if (hiddenSet.has(index)) return null
      if (hiddenClassSet.has(shape.label)) return null
      const pts = shapePointsForCuboid2d(index, shape, dragCuboidLivePoints, dragLivePoints, dragVertexLive)
      if (shape.shape_type !== "cuboid2d" || pts.length < 4) return null
      const usesExplicitQuadPair = pts.length >= 8
      let baseStagePoints: Point[]
      let topStagePoints: Point[]
      let heightPx: number
      if (usesExplicitQuadPair) {
        const baseImage = pts.slice(0, 4).map((pt) => ({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
        const topImage = pts.slice(4, 8).map((pt) => ({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
        baseStagePoints = baseImage.map((p) => imageToStage(p)).filter((p): p is Point => !!p)
        topStagePoints = topImage.map((p) => imageToStage(p)).filter((p): p is Point => !!p)
        if (baseStagePoints.length < 4 || topStagePoints.length < 4) return null
        heightPx = readCuboid2dHeightPx(shape)
      } else {
        heightPx = readCuboid2dHeightPx(shape)
        if (heightPx < 1) return null
        const baseImage = pts.slice(0, 4).map((pt) => ({ x: Number(pt[0] ?? 0), y: Number(pt[1] ?? 0) }))
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

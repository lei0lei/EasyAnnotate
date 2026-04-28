import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { Point, RenderedRectangle, RenderedRotationRect } from "@/pages/project-task-detail/types"

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

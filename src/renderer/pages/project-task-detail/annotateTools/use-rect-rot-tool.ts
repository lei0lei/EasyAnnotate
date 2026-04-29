/**
 * 模块：project-task-detail/annotateTools/use-rect-rot-tool
 * 职责：处理矩形/旋转矩形绘制流程（预览、落点、提交）。
 * 边界：专注 rect/obb 工具，不处理 polygon 或 mask 流程。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { DrawShapeType } from "@/pages/project-task-detail/tool-state"
import type { CanvasShapeCreatedEvent } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import { roundPointToInt } from "@/pages/project-task-detail/utils"
import { useCallback, useMemo, type MouseEvent, type MutableRefObject } from "react"

type ToolDispatch =
  | { type: "enterPickingLabel"; mode: "rect" | "rotRect"; drawShapeType: "rectangle" | "rotation" }
  | { type: "setRectHoverPoint"; point: Point | null }
  | { type: "startRectFirstPoint"; point: Point }
  | { type: "clearRectPoints" }

type UseRectRotToolParams = {
  rightToolMode: RightToolMode
  rectDrawingEnabled: boolean
  imageGeometry: ImageGeometry | null
  activeImagePath: string
  isImageLoading: boolean
  imageLoadError: boolean
  stageRef: MutableRefObject<HTMLDivElement | null>
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageStrictWithGeometry: (point: Point, geometry: ImageGeometry) => Point | null
  imageToStage: (point: Point) => Point | null
  rectFirstPoint: Point | null
  rectHoverPoint: Point | null
  drawShapeType: DrawShapeType
  dispatchTool: (action: ToolDispatch) => void
  activeImageSize: { width: number; height: number }
  rectPendingLabel: string
  createShape: (params: {
    imagePath: string
    imageWidth: number
    imageHeight: number
    shape: XAnyLabelFile["shapes"][number]
  }) => { shapeIndex: number; shapeId: string }
  onShapeCreated?: (event: CanvasShapeCreatedEvent) => void
}

export function useRectRotTool(params: UseRectRotToolParams) {
  const canDrawRectangle =
    (params.rightToolMode === "rect" || params.rightToolMode === "rotRect") &&
    params.rectDrawingEnabled &&
    !!params.imageGeometry &&
    !!params.activeImagePath &&
    !params.isImageLoading &&
    !params.imageLoadError

  const previewRect = useMemo(() => {
    if (!canDrawRectangle || !params.rectFirstPoint || !params.rectHoverPoint) return null
    const p1 = params.imageToStage(params.rectFirstPoint)
    const p2 = params.imageToStage(params.rectHoverPoint)
    if (!p1 || !p2) return null
    const left = Math.min(p1.x, p2.x)
    const top = Math.min(p1.y, p2.y)
    const width = Math.abs(p1.x - p2.x)
    const height = Math.abs(p1.y - p2.y)
    const stageW = params.imageGeometry?.stageWidth ?? 0
    const stageH = params.imageGeometry?.stageHeight ?? 0
    const right = left + width
    const bottom = top + height
    const clippedLeft = stageW > 0 ? Math.max(0, left) : left
    const clippedTop = stageH > 0 ? Math.max(0, top) : top
    const clippedRight = stageW > 0 ? Math.min(stageW, right) : right
    const clippedBottom = stageH > 0 ? Math.min(stageH, bottom) : bottom
    return {
      left: clippedLeft,
      top: clippedTop,
      width: Math.max(0, clippedRight - clippedLeft),
      height: Math.max(0, clippedBottom - clippedTop),
      clippedLeft: clippedLeft > left,
      clippedTop: clippedTop > top,
      clippedRight: clippedRight < right,
      clippedBottom: clippedBottom < bottom,
    }
  }, [canDrawRectangle, params.imageGeometry, params.imageToStage, params.rectFirstPoint, params.rectHoverPoint])

  const handleStartRectTool = useCallback(() => {
    params.dispatchTool({ type: "enterPickingLabel", mode: "rect", drawShapeType: "rectangle" })
  }, [params])

  const handleStartRotRectTool = useCallback(() => {
    params.dispatchTool({ type: "enterPickingLabel", mode: "rotRect", drawShapeType: "rotation" })
  }, [params])

  const upsertRectByPoint = useCallback(
    (point: Point) => {
      if (!canDrawRectangle) return
      if (!params.rectFirstPoint) {
        params.dispatchTool({ type: "startRectFirstPoint", point: roundPointToInt(point) })
        return
      }
      const roundedCurrent = roundPointToInt(point)
      const minX = Math.min(params.rectFirstPoint.x, roundedCurrent.x)
      const maxX = Math.max(params.rectFirstPoint.x, roundedCurrent.x)
      const minY = Math.min(params.rectFirstPoint.y, roundedCurrent.y)
      const maxY = Math.max(params.rectFirstPoint.y, roundedCurrent.y)
      if (maxX - minX < 1 || maxY - minY < 1) {
        params.dispatchTool({ type: "clearRectPoints" })
        return
      }
      const created = params.createShape({
        imagePath: params.activeImagePath,
        imageWidth: params.activeImageSize.width,
        imageHeight: params.activeImageSize.height,
        shape: {
          label: params.rectPendingLabel,
          score: null,
          points: [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
          ],
          group_id: null,
          description: null,
          difficult: false,
          shape_type: params.drawShapeType === "rotation" ? "rotation" : "rectangle",
          flags: null,
          attributes: {},
          kie_linking: [],
        },
      })
      params.onShapeCreated?.({
        shapeId: created.shapeId,
        shapeType: params.drawShapeType === "rotation" ? "rotation" : "rectangle",
        source: "draw",
      })
      params.dispatchTool({ type: "clearRectPoints" })
    },
    [canDrawRectangle, params],
  )

  const handleRectDrawMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawRectangle || !params.stageRef.current) return
      const rect = params.stageRef.current.getBoundingClientRect()
      const geometry = params.getCurrentImageGeometry()
      if (!geometry) return
      const pt = params.stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
      if (!pt) {
        params.dispatchTool({ type: "setRectHoverPoint", point: null })
        return
      }
      const rounded = roundPointToInt(pt)
      if (!params.rectHoverPoint || params.rectHoverPoint.x !== rounded.x || params.rectHoverPoint.y !== rounded.y) {
        params.dispatchTool({ type: "setRectHoverPoint", point: rounded })
      }
    },
    [canDrawRectangle, params],
  )

  const handleRectDrawClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawRectangle || !params.stageRef.current) return
      event.stopPropagation()
      const rect = params.stageRef.current.getBoundingClientRect()
      const geometry = params.getCurrentImageGeometry()
      if (!geometry) return
      const pt = params.stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
      if (!pt) return
      upsertRectByPoint(pt)
    },
    [canDrawRectangle, params, upsertRectByPoint],
  )

  return {
    canDrawRectangle,
    previewRect,
    handleStartRectTool,
    handleStartRotRectTool,
    handleRectDrawMove,
    handleRectDrawClick,
  }
}

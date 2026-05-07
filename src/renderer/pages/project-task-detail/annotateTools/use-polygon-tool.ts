/**
 * 模块：project-task-detail/annotateTools/use-polygon-tool
 * 职责：处理多边形绘制流程（草稿点、闭合判定、提交）。
 * 边界：专注 polygon 工具，不负责矩形和 mask 逻辑。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { CanvasShapeCreatedEvent } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import { roundPointToInt } from "@/pages/project-task-detail/utils"
import { useCallback, useMemo, type MouseEvent, type MutableRefObject } from "react"

type ToolDispatch =
  | { type: "enterPickingLabel"; mode: "polygon"; drawShapeType: "polygon" }
  | { type: "setPolygonHoverPoint"; point: Point | null }
  | { type: "appendPolygonPoint"; point: Point }
  | { type: "clearPolygonDraft" }
  | { type: "popPolygonPoint" }

type UsePolygonToolParams = {
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
  /** 用于草稿顶点悬停判定：阈值按屏幕约 8px 折算到 base stage */
  imageScale: number
  polygonDraftPoints: Point[]
  polygonHoverPoint: Point | null
  dispatchTool: (action: ToolDispatch) => void
  imageNaturalSize: { width: number; height: number }
  rectPendingLabel: string
  createShape: (params: {
    imagePath: string
    imageWidth: number
    imageHeight: number
    shape: XAnyLabelFile["shapes"][number]
  }) => { shapeIndex: number; shapeId: string }
  onShapeCreated?: (event: CanvasShapeCreatedEvent) => void
  /** 成功新建一条标注后回到选择模式 */
  onCommittedExitToSelect?: () => void
}

export function usePolygonTool(params: UsePolygonToolParams) {
  const canDrawPolygon =
    params.rightToolMode === "polygon" &&
    params.rectDrawingEnabled &&
    !!params.imageGeometry &&
    !!params.activeImagePath &&
    !params.isImageLoading &&
    !params.imageLoadError

  const polygonDraftStagePoints = useMemo(() => {
    if (!canDrawPolygon) return []
    const points = params.polygonDraftPoints
      .map((point) => params.imageToStage(point))
      .filter((point): point is Point => !!point)
    if (params.polygonHoverPoint) {
      const hoverPoint = params.imageToStage(params.polygonHoverPoint)
      if (hoverPoint) points.push(hoverPoint)
    }
    return points
  }, [
    canDrawPolygon,
    params.imageGeometry,
    params.imageToStage,
    params.polygonDraftPoints,
    params.polygonHoverPoint,
  ])

  const hoveredDraftVertexIndex = useMemo(() => {
    if (!canDrawPolygon || !params.polygonHoverPoint || params.polygonDraftPoints.length === 0) return null
    const hoverStagePoint = params.imageToStage(params.polygonHoverPoint)
    if (!hoverStagePoint) return null
    const hitR = 8 / Math.max(params.imageScale, 0.001)
    let matchedIndex: number | null = null
    let minDistance = Number.POSITIVE_INFINITY
    params.polygonDraftPoints.forEach((point, index) => {
      const stagePoint = params.imageToStage(point)
      if (!stagePoint) return
      const distance = Math.hypot(stagePoint.x - hoverStagePoint.x, stagePoint.y - hoverStagePoint.y)
      if (distance <= hitR && distance < minDistance) {
        matchedIndex = index
        minDistance = distance
      }
    })
    return matchedIndex
  }, [
    canDrawPolygon,
    params.imageGeometry,
    params.imageScale,
    params.imageToStage,
    params.polygonDraftPoints,
    params.polygonHoverPoint,
  ])

  const handleStartPolygonTool = useCallback(() => {
    params.dispatchTool({ type: "enterPickingLabel", mode: "polygon", drawShapeType: "polygon" })
  }, [params])

  const finalizePolygon = useCallback(
    (points: Point[]) => {
      if (!canDrawPolygon || points.length < 3) return
      const deduped = points.filter((point, index) => {
        if (index === 0) return true
        const prev = points[index - 1]
        return point.x !== prev.x || point.y !== prev.y
      })
      if (deduped.length >= 2) {
        const first = deduped[0]
        const last = deduped[deduped.length - 1]
        if (first.x === last.x && first.y === last.y) deduped.pop()
      }
      if (deduped.length < 3) {
        params.dispatchTool({ type: "clearPolygonDraft" })
        return
      }
      const created = params.createShape({
        imagePath: params.activeImagePath,
        imageWidth: params.imageNaturalSize.width,
        imageHeight: params.imageNaturalSize.height,
        shape: {
          label: params.rectPendingLabel,
          score: null,
          points: deduped.map((pt) => [pt.x, pt.y]),
          group_id: null,
          description: null,
          difficult: false,
          shape_type: "polygon",
          flags: null,
          attributes: {},
          kie_linking: [],
        },
      })
      params.onShapeCreated?.({
        shapeId: created.shapeId,
        shapeType: "polygon",
        source: "draw",
      })
      params.onCommittedExitToSelect?.()
    },
    [canDrawPolygon, params],
  )

  const handlePolygonDrawMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawPolygon || !params.stageRef.current) return
      const rect = params.stageRef.current.getBoundingClientRect()
      const geometry = params.getCurrentImageGeometry()
      if (!geometry) return
      const pt = params.stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
      if (!pt) {
        params.dispatchTool({ type: "setPolygonHoverPoint", point: null })
        return
      }
      const rounded = roundPointToInt(pt)
      if (!params.polygonHoverPoint || params.polygonHoverPoint.x !== rounded.x || params.polygonHoverPoint.y !== rounded.y) {
        params.dispatchTool({ type: "setPolygonHoverPoint", point: rounded })
      }
    },
    [canDrawPolygon, params],
  )

  const handlePolygonDrawClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawPolygon || !params.stageRef.current) return
      event.stopPropagation()
      const rect = params.stageRef.current.getBoundingClientRect()
      const geometry = params.getCurrentImageGeometry()
      if (!geometry) return
      const pt = params.stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
      if (!pt) return
      const rounded = roundPointToInt(pt)
      const first = params.polygonDraftPoints[0]
      if (first && params.polygonDraftPoints.length >= 3) {
        const closeDistance = Math.hypot(first.x - rounded.x, first.y - rounded.y)
        if (closeDistance <= 6) {
          finalizePolygon(params.polygonDraftPoints)
          return
        }
      }
      params.dispatchTool({ type: "appendPolygonPoint", point: rounded })
    },
    [canDrawPolygon, finalizePolygon, params],
  )

  const handlePolygonDrawDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawPolygon) return
      event.preventDefault()
      event.stopPropagation()
      if (params.polygonDraftPoints.length < 3) return
      finalizePolygon(params.polygonDraftPoints)
    },
    [canDrawPolygon, finalizePolygon, params.polygonDraftPoints],
  )

  const clearPolygonDraft = useCallback(() => {
    params.dispatchTool({ type: "clearPolygonDraft" })
  }, [params])

  const popPolygonPoint = useCallback(() => {
    params.dispatchTool({ type: "popPolygonPoint" })
  }, [params])

  return {
    canDrawPolygon,
    polygonDraftStagePoints,
    hoveredDraftVertexIndex,
    handleStartPolygonTool,
    handlePolygonDrawMove,
    handlePolygonDrawClick,
    handlePolygonDrawDoubleClick,
    clearPolygonDraft,
    popPolygonPoint,
    polygonDraftPointCount: params.polygonDraftPoints.length,
  }
}

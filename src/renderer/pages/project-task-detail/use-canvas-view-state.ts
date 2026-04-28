import { useMemo } from "react"
import type { MouseEventHandler, MutableRefObject, WheelEventHandler } from "react"
import { createXAnyLabelTemplate, type XAnyLabelFile } from "@/lib/xanylabeling-format"
import { normalizeDocPointsToInt, roundPointToInt } from "@/pages/project-task-detail/utils"
import type { Point, RightToolMode, RotationDragAction, RotationTransformAction, ShapeDragAction } from "@/pages/project-task-detail/types"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { ImageSize, RawHighlightCorner, StageElementRef } from "@/pages/project-task-detail/hook-shared"

type ToolDispatch =
  | { type: "setRectHoverPoint"; point: Point | null }
  | { type: "startRectFirstPoint"; point: Point }
  | { type: "clearRectPoints" }

type UseCanvasViewStateParams = {
  rightToolMode: RightToolMode
  imageObjectUrl: string
  isImageLoading: boolean
  imageLoadError: boolean
  shapeDragAction: ShapeDragAction | null
  rotationDragAction: RotationDragAction | null
  rotationTransformAction: RotationTransformAction | null
  drawingLayerActive: boolean
  canDrawRectangle: boolean
  isPanning: boolean
  setIsPanning: (value: boolean) => void
  panStartRef: MutableRefObject<{ x: number; y: number; originX: number; originY: number } | null>
  imageOffset: { x: number; y: number }
  setImageOffset: (value: { x: number; y: number }) => void
  setImageScale: (updater: (prev: number) => number) => void
  stageRef: StageElementRef
  stageToImage: (stagePoint: Point) => Point | null
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageStrictWithGeometry: (stagePoint: Point, geometry: ImageGeometry) => Point | null
  rectHoverPoint: Point | null
  dispatchTool: (action: ToolDispatch) => void
  rectFirstPoint: Point | null
  annotationDoc: XAnyLabelFile | null
  activeImagePath: string
  imageNaturalSize: ImageSize
  rectPendingLabel: string
  drawShapeType: "rectangle" | "rotation"
  setAnnotationDoc: (value: XAnyLabelFile | null) => void
  persistAnnotation: (nextDoc: XAnyLabelFile) => void
  setSelectedShapeIndex: (value: number | null) => void
  setHoveredShapeIndex: (value: number | null) => void
  setRawHighlightCorner: (value: RawHighlightCorner) => void
}

export function canPanAndZoomFromState(args: {
  rightToolMode: RightToolMode
  imageObjectUrl: string
  isImageLoading: boolean
  imageLoadError: boolean
  shapeDragAction: ShapeDragAction | null
  rotationDragAction: RotationDragAction | null
  rotationTransformAction: RotationTransformAction | null
}): boolean {
  return (
    args.rightToolMode === "select" &&
    !!args.imageObjectUrl &&
    !args.isImageLoading &&
    !args.imageLoadError &&
    !args.shapeDragAction &&
    !args.rotationDragAction &&
    !args.rotationTransformAction
  )
}

export function useCanvasViewState(params: UseCanvasViewStateParams) {
  const canPanAndZoom = useMemo(
    () =>
      canPanAndZoomFromState({
        rightToolMode: params.rightToolMode,
        imageObjectUrl: params.imageObjectUrl,
        isImageLoading: params.isImageLoading,
        imageLoadError: params.imageLoadError,
        shapeDragAction: params.shapeDragAction,
        rotationDragAction: params.rotationDragAction,
        rotationTransformAction: params.rotationTransformAction,
      }),
    [
      params.imageLoadError,
      params.imageObjectUrl,
      params.isImageLoading,
      params.rightToolMode,
      params.rotationDragAction,
      params.rotationTransformAction,
      params.shapeDragAction,
    ],
  )

  const handleImageWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.9 : 1.1
    params.setImageScale((prev) => Math.min(8, Math.max(0.2, prev * factor)))
  }

  const handleImageMouseDown: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    if (event.button !== 0) return
    event.preventDefault()
    params.setIsPanning(true)
    params.panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: params.imageOffset.x,
      originY: params.imageOffset.y,
    }
  }

  const upsertRectByPoint = (point: Point) => {
    if (!params.canDrawRectangle) return
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
    const workingDoc =
      params.annotationDoc ??
      createXAnyLabelTemplate({
        imagePath: params.activeImagePath,
        imageWidth: params.imageNaturalSize.width,
        imageHeight: params.imageNaturalSize.height,
      })
    const nextDoc: XAnyLabelFile = {
      ...workingDoc,
      shapes: [
        ...workingDoc.shapes,
        {
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
      ],
    }
    const normalizedDoc = normalizeDocPointsToInt(nextDoc)
    params.setAnnotationDoc(normalizedDoc)
    params.persistAnnotation(normalizedDoc)
    params.dispatchTool({ type: "clearRectPoints" })
  }

  const handleImageMouseMove: MouseEventHandler<HTMLDivElement> = (event) => {
    if (params.isPanning && params.panStartRef.current && canPanAndZoom) {
      const { x, y, originX, originY } = params.panStartRef.current
      params.setImageOffset({ x: originX + (event.clientX - x), y: originY + (event.clientY - y) })
      return
    }
    if (!params.canDrawRectangle || !params.stageRef.current) return
    const rect = params.stageRef.current.getBoundingClientRect()
    const pt = params.stageToImage({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    if (!pt) return
    const rounded = roundPointToInt(pt)
    if (!params.rectHoverPoint || params.rectHoverPoint.x !== rounded.x || params.rectHoverPoint.y !== rounded.y) {
      params.dispatchTool({ type: "setRectHoverPoint", point: rounded })
    }
  }

  const handleImageDoubleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    event.preventDefault()
    params.setImageScale(() => 1)
    params.setImageOffset({ x: 0, y: 0 })
    params.setIsPanning(false)
    params.panStartRef.current = null
  }

  const endImagePan = () => {
    params.setIsPanning(false)
    params.panStartRef.current = null
  }

  const handleDrawLayerMove: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!params.drawingLayerActive || !params.stageRef.current) return
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
  }

  const handleDrawLayerClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!params.drawingLayerActive || !params.stageRef.current) return
    event.stopPropagation()
    const rect = params.stageRef.current.getBoundingClientRect()
    const geometry = params.getCurrentImageGeometry()
    if (!geometry) return
    const pt = params.stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    if (!pt) return
    upsertRectByPoint(pt)
  }

  const handleStageClick: MouseEventHandler<HTMLDivElement> = () => {
    if (params.drawingLayerActive) return
    params.setSelectedShapeIndex(null)
    params.setHoveredShapeIndex(null)
    params.setRawHighlightCorner(null)
  }

  return {
    canPanAndZoom,
    handleImageWheel,
    handleImageMouseDown,
    handleImageMouseMove,
    handleImageDoubleClick,
    endImagePan,
    handleDrawLayerMove,
    handleDrawLayerClick,
    handleStageClick,
  }
}

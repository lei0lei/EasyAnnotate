import { useCallback } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { computeRotationCenterAndStartAngle } from "@/pages/project-task-detail/interaction-ops"
import type {
  Point,
  RenderedRotationRect,
  ResizeHandle,
  RightToolMode,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "@/pages/project-task-detail/types"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { AnnotationDocRef, StageElementRef } from "@/pages/project-task-detail/hook-shared"

type UseTaskCanvasInteractionsParams = {
  drawingLayerActive: boolean
  rightToolMode: RightToolMode
  annotationDoc: XAnyLabelFile | null
  selectedShapeIndex: number | null
  selectedRotationRect: RenderedRotationRect | null
  annotationDocRef: AnnotationDocRef
  stageRef: StageElementRef
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageWithGeometry: (stagePoint: Point, geometry: ImageGeometry) => Point
  setSelectedShapeIndex: (value: number | null) => void
  setShapeDragAction: (value: ShapeDragAction | null) => void
  setRotationTransformAction: (value: RotationTransformAction | null) => void
  setRotationDragAction: (value: RotationDragAction | null) => void
}

export function useTaskCanvasInteractions(params: UseTaskCanvasInteractionsParams) {
  const getImagePointFromMouseEvent = useCallback(
    (event: ReactMouseEvent<Element>): Point | null => {
      const geometry = params.getCurrentImageGeometry()
      const rect = params.stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return null
      return params.stageToImageWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    },
    [params],
  )

  const handleRectangleMouseDown = useCallback(
    (shapeIndex: number, event: ReactMouseEvent<HTMLDivElement>) => {
      if (params.rightToolMode !== "select" || params.drawingLayerActive) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = params.annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "rectangle") return
      params.setShapeDragAction({
        kind: "move",
        shapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [p[0], p[1]]),
      })
      params.setSelectedShapeIndex(shapeIndex)
    },
    [getImagePointFromMouseEvent, params],
  )

  const handleRotationPolygonMouseDown = useCallback(
    (shapeIndex: number, event: ReactMouseEvent<SVGPolygonElement>) => {
      if (params.drawingLayerActive || params.rightToolMode !== "select") return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = params.annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
      params.setRotationTransformAction({
        kind: "move",
        shapeIndex,
        start: point,
        originalPoints: shape.points.slice(0, 4).map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)]),
      })
      params.setSelectedShapeIndex(shapeIndex)
    },
    [getImagePointFromMouseEvent, params],
  )

  const handleRotationHandleMouseDown = useCallback(
    (event: ReactMouseEvent<SVGCircleElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      if (params.selectedShapeIndex === null) return
      const currentDoc = params.annotationDocRef.current
      if (!currentDoc) return
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const shape = currentDoc.shapes[params.selectedShapeIndex]
      if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
      const originalPoints = shape.points.slice(0, 4).map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)])
      const { center, startAngle } = computeRotationCenterAndStartAngle(point, originalPoints)
      params.setRotationDragAction({
        shapeIndex: params.selectedShapeIndex,
        center,
        startAngle,
        originalPoints,
      })
    },
    [getImagePointFromMouseEvent, params],
  )

  const handleRotationCornerMouseDown = useCallback(
    (cornerIndex: number, event: ReactMouseEvent<SVGCircleElement>) => {
      if (event.button !== 0 || !params.selectedRotationRect) return
      event.preventDefault()
      event.stopPropagation()
      const currentDoc = params.annotationDocRef.current
      const shape = currentDoc?.shapes[params.selectedRotationRect.index]
      if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
      params.setRotationTransformAction({
        kind: "resize",
        shapeIndex: params.selectedRotationRect.index,
        handle: cornerIndex === 0 ? "nw" : cornerIndex === 1 ? "ne" : cornerIndex === 2 ? "se" : "sw",
        center: params.selectedRotationRect.centerImage,
        axisU: params.selectedRotationRect.axisUImage,
        axisV: params.selectedRotationRect.axisVImage,
      })
    },
    [params],
  )

  const handleRectResizeMouseDown = useCallback(
    (handle: ResizeHandle, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !params.annotationDoc || params.selectedShapeIndex === null) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const shape = params.annotationDoc.shapes[params.selectedShapeIndex]
      if (!shape || shape.shape_type !== "rectangle") return
      params.setShapeDragAction({
        kind: "resize",
        handle,
        shapeIndex: params.selectedShapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [p[0], p[1]]),
      })
    },
    [getImagePointFromMouseEvent, params],
  )

  return {
    handleRectangleMouseDown,
    handleRotationPolygonMouseDown,
    handleRotationHandleMouseDown,
    handleRotationCornerMouseDown,
    handleRectResizeMouseDown,
  }
}

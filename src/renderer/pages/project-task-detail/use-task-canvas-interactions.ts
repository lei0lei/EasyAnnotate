/**
 * 模块：project-task-detail/use-task-canvas-interactions
 * 职责：统一画布鼠标交互入口，初始化选中与各类拖拽动作。
 * 边界：只负责交互入口，不做拖拽过程中的持续运算。
 */
import { useCallback } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { readMaskRle } from "@/lib/mask-raster-rle"
import { computeRotationCenterAndStartAngle } from "@/pages/project-task-detail/interaction-ops"
import type {
  Point,
  PolygonDragAction,
  PolygonVertexDragAction,
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
  activeShapeIndex: number | null
  selectedRotationRect: RenderedRotationRect | null
  annotationDocRef: AnnotationDocRef
  stageRef: StageElementRef
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageWithGeometry: (stagePoint: Point, geometry: ImageGeometry) => Point
  onSelectShapeIndex: (value: number | null) => void
  setShapeDragAction: (value: ShapeDragAction | null) => void
  setPolygonDragAction: (value: PolygonDragAction | null) => void
  setRotationTransformAction: (value: RotationTransformAction | null) => void
  setRotationDragAction: (value: RotationDragAction | null) => void
  setPolygonVertexDragAction: (value: PolygonVertexDragAction | null) => void
}

export function useTaskCanvasInteractions(params: UseTaskCanvasInteractionsParams) {
  const {
    drawingLayerActive,
    rightToolMode,
    annotationDoc,
    activeShapeIndex,
    selectedRotationRect,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    onSelectShapeIndex,
    setShapeDragAction,
    setPolygonDragAction,
    setRotationTransformAction,
    setRotationDragAction,
    setPolygonVertexDragAction,
  } = params
  const getImagePointFromMouseEvent = useCallback(
    (event: ReactMouseEvent<Element>): Point | null => {
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return null
      return stageToImageWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    },
    [getCurrentImageGeometry, stageRef, stageToImageWithGeometry],
  )

  const handleRectangleMouseDown = useCallback(
    (shapeIndex: number, event: ReactMouseEvent<HTMLDivElement>) => {
      if (rightToolMode !== "select" || drawingLayerActive) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "rectangle") return
      setShapeDragAction({
        kind: "move",
        shapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [p[0], p[1]]),
        shapeType: "rectangle",
      })
      onSelectShapeIndex(shapeIndex)
    },
    [annotationDocRef, drawingLayerActive, getImagePointFromMouseEvent, onSelectShapeIndex, rightToolMode, setShapeDragAction],
  )

  const handleRotationPolygonMouseDown = useCallback(
    (shapeIndex: number, event: ReactMouseEvent<SVGPolygonElement>) => {
      if (drawingLayerActive || rightToolMode !== "select") return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
      setRotationTransformAction({
        kind: "move",
        shapeIndex,
        start: point,
        originalPoints: shape.points.slice(0, 4).map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)]),
      })
      onSelectShapeIndex(shapeIndex)
    },
    [annotationDocRef, drawingLayerActive, getImagePointFromMouseEvent, onSelectShapeIndex, rightToolMode, setRotationTransformAction],
  )

  const handleRotationHandleMouseDown = useCallback(
    (event: ReactMouseEvent<SVGCircleElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      if (activeShapeIndex === null) return
      const currentDoc = annotationDocRef.current
      if (!currentDoc) return
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const shape = currentDoc.shapes[activeShapeIndex]
      if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
      const originalPoints = shape.points.slice(0, 4).map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)])
      const { center, startAngle } = computeRotationCenterAndStartAngle(point, originalPoints)
      setRotationDragAction({
        shapeIndex: activeShapeIndex,
        center,
        startAngle,
        originalPoints,
      })
    },
    [activeShapeIndex, annotationDocRef, getImagePointFromMouseEvent, setRotationDragAction],
  )

  const handleRotationCornerMouseDown = useCallback(
    (cornerIndex: number, event: ReactMouseEvent<SVGCircleElement>) => {
      if (event.button !== 0 || !selectedRotationRect) return
      event.preventDefault()
      event.stopPropagation()
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[selectedRotationRect.index]
      if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
      setRotationTransformAction({
        kind: "resize",
        shapeIndex: selectedRotationRect.index,
        handle: cornerIndex === 0 ? "nw" : cornerIndex === 1 ? "ne" : cornerIndex === 2 ? "se" : "sw",
        center: selectedRotationRect.centerImage,
        axisU: selectedRotationRect.axisUImage,
        axisV: selectedRotationRect.axisVImage,
      })
    },
    [annotationDocRef, selectedRotationRect, setRotationTransformAction],
  )

  const handleRectResizeMouseDown = useCallback(
    (handle: ResizeHandle, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !annotationDoc || activeShapeIndex === null) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const shape = annotationDoc.shapes[activeShapeIndex]
      if (!shape || shape.shape_type !== "rectangle") return
      setShapeDragAction({
        kind: "resize",
        handle,
        shapeIndex: activeShapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [p[0], p[1]]),
      })
    },
    [activeShapeIndex, annotationDoc, getImagePointFromMouseEvent, setShapeDragAction],
  )

  const handlePolygonVertexMouseDown = useCallback(
    (shapeIndex: number, vertexIndex: number, event: ReactMouseEvent<SVGCircleElement>) => {
      if (drawingLayerActive || rightToolMode !== "select") return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape) return
      const isPolygon = shape.shape_type === "polygon" && shape.points.length >= 3
      const isSkeleton = shape.shape_type === "skeleton" && shape.points.length >= 1
      const isCuboidHandles = shape.shape_type === "cuboid2d" && shape.points.length >= 8 && vertexIndex >= 0 && vertexIndex <= 10
      if (!isPolygon && !isSkeleton && !isCuboidHandles) return
      if (isPolygon && (vertexIndex < 0 || vertexIndex >= shape.points.length)) return
      if (isSkeleton && (vertexIndex < 0 || vertexIndex >= shape.points.length)) return
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      if (isCuboidHandles) {
        const snap = shape.points.map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)])
        setPolygonVertexDragAction({
          shapeIndex,
          vertexIndex,
          cuboidVertexStartSnapshot: snap,
          cuboidPointerStart: vertexIndex >= 8 && vertexIndex <= 10 ? point : undefined,
        })
      } else {
        setPolygonVertexDragAction({ shapeIndex, vertexIndex })
      }
      onSelectShapeIndex(shapeIndex)
    },
    [annotationDocRef, drawingLayerActive, getImagePointFromMouseEvent, onSelectShapeIndex, rightToolMode, setPolygonVertexDragAction],
  )

  const handlePolygonMouseDown = useCallback(
    (shapeIndex: number, event: ReactMouseEvent<SVGGraphicsElement>) => {
      if (drawingLayerActive || rightToolMode !== "select") return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape) return
      if (shape.shape_type === "cuboid2d" && shape.points.length >= 8) return
      const isPolyLike = shape.shape_type === "polygon" && shape.points.length >= 3
      const isSkeleton = shape.shape_type === "skeleton" && shape.points.length >= 1
      const isLegacyCuboid = shape.shape_type === "cuboid2d" && shape.points.length >= 4 && shape.points.length < 8
      if (!isPolyLike && !isSkeleton && !isLegacyCuboid) return
      setPolygonDragAction({
        shapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)]),
      })
      onSelectShapeIndex(shapeIndex)
    },
    [annotationDocRef, drawingLayerActive, getImagePointFromMouseEvent, onSelectShapeIndex, rightToolMode, setPolygonDragAction],
  )

  const handleCuboidFaceMouseDown = useCallback(
    (shapeIndex: number, face: "front" | "back", event: ReactMouseEvent<SVGPolygonElement>) => {
      if (drawingLayerActive || rightToolMode !== "select") return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "cuboid2d" || shape.points.length < 8) return
      setPolygonDragAction({
        shapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)]),
        cuboidDragSubset: face === "back" ? "back" : undefined,
      })
      onSelectShapeIndex(shapeIndex)
    },
    [annotationDocRef, drawingLayerActive, getImagePointFromMouseEvent, onSelectShapeIndex, rightToolMode, setPolygonDragAction],
  )

  const handleMaskMouseDown = useCallback(
    (shapeIndex: number, event: ReactMouseEvent<HTMLElement>) => {
      if (drawingLayerActive || rightToolMode !== "select") return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "mask") return
      const rle = readMaskRle(shape.attributes)
      const hasRle =
        !!currentDoc && rle !== null && rle.w === currentDoc.imageWidth && rle.h === currentDoc.imageHeight
      if (!hasRle && shape.points.length < 1) return
      setShapeDragAction({
        kind: "move",
        shapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)]),
        shapeType: "mask",
      })
      onSelectShapeIndex(shapeIndex)
    },
    [annotationDocRef, drawingLayerActive, getImagePointFromMouseEvent, onSelectShapeIndex, rightToolMode, setShapeDragAction],
  )

  const handlePointMouseDown = useCallback(
    (shapeIndex: number, event: ReactMouseEvent<Element>) => {
      if (drawingLayerActive || rightToolMode !== "select") return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const point = getImagePointFromMouseEvent(event)
      if (!point) return
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "point" || shape.points.length < 1) return
      setShapeDragAction({
        kind: "move",
        shapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)]),
        shapeType: "point",
      })
      onSelectShapeIndex(shapeIndex)
    },
    [annotationDocRef, drawingLayerActive, getImagePointFromMouseEvent, onSelectShapeIndex, rightToolMode, setShapeDragAction],
  )

  return {
    handleRectangleMouseDown,
    handleMaskMouseDown,
    handlePointMouseDown,
    handlePolygonMouseDown,
    handleCuboidFaceMouseDown,
    handleRotationPolygonMouseDown,
    handleRotationHandleMouseDown,
    handleRotationCornerMouseDown,
    handleRectResizeMouseDown,
    handlePolygonVertexMouseDown,
  }
}

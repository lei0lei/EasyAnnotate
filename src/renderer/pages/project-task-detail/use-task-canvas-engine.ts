/**
 * 模块：project-task-detail/use-task-canvas-engine
 * 职责：收敛画布交互与视图手势入口，对外暴露统一事件与处理器。
 * 边界：只编排交互 hooks，不直接持久化标注数据。
 */
import { useCallback, useEffect, useRef } from "react"
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { getShapeStableIdAtIndex } from "@/pages/project-task-detail/shape-identity"
import { useCanvasViewState } from "@/pages/project-task-detail/use-canvas-view-state"
import { useTaskCanvasInteractions } from "@/pages/project-task-detail/use-task-canvas-interactions"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { AnnotationDocRef, RawHighlightCorner, StageElementRef } from "@/pages/project-task-detail/hook-shared"
import type {
  Point,
  PolygonDragAction,
  PolygonVertexDragAction,
  RenderedRotationRect,
  RightToolMode,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "@/pages/project-task-detail/types"

export type CanvasShapeType = "rectangle" | "rotation" | "polygon" | "mask" | "cuboid2d" | "point" | "skeleton"

export type CanvasShapeCreatedEvent = {
  shapeId: string
  shapeType: CanvasShapeType
  source: "draw"
}

export type CanvasShapeUpdatedEvent = {
  shapeId: string
  source: "drag"
  reason: "drag-move" | "drag-resize" | "drag-rotate" | "drag-vertex"
}

export type ViewportChangeEvent = {
  offset: { x: number; y: number }
  scale: number
  isPanning: boolean
}

type DragSessionState = {
  shapeDragAction: ShapeDragAction | null
  polygonDragAction: PolygonDragAction | null
  polygonVertexDragAction: PolygonVertexDragAction | null
  rotationDragAction: RotationDragAction | null
  rotationTransformAction: RotationTransformAction | null
}

type DragSessionDispatch = {
  setShapeDragAction: (value: ShapeDragAction | null) => void
  setPolygonDragAction: (value: PolygonDragAction | null) => void
  setRotationTransformAction: (value: RotationTransformAction | null) => void
  setRotationDragAction: (value: RotationDragAction | null) => void
  setPolygonVertexDragAction: (value: PolygonVertexDragAction | null) => void
}

export type DragSessionController = DragSessionState & DragSessionDispatch

type UseTaskCanvasEngineParams = {
  drawingLayerActive: boolean
  rightToolMode: RightToolMode
  annotationDoc: XAnyLabelFile | null
  selectedShapeId: string | null
  resolveShapeIndexById: (shapeId: string | null) => number | null
  selectedRotationRect: RenderedRotationRect | null
  annotationDocRef: AnnotationDocRef
  stageRef: StageElementRef
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageWithGeometry: (stagePoint: Point, geometry: ImageGeometry) => Point
  dragSession: DragSessionController
  imageObjectUrl: string
  isImageLoading: boolean
  imageLoadError: boolean
  isPanning: boolean
  setIsPanning: (value: boolean) => void
  panStartRef: MutableRefObject<{ x: number; y: number; originX: number; originY: number } | null>
  imageOffset: { x: number; y: number }
  imageScale: number
  setImageOffset: (value: { x: number; y: number }) => void
  setImageScale: (updater: (prev: number) => number) => void
  setRawHighlightCorner: (value: RawHighlightCorner) => void
  onSelectionChanged: (shapeId: string | null) => void
  onHoveredShapeChanged: (shapeId: string | null | ((prev: string | null) => string | null)) => void
  onViewportChanged?: (viewport: ViewportChangeEvent) => void
}

export function useTaskCanvasEngine(params: UseTaskCanvasEngineParams) {
  const {
    onSelectionChanged,
    onHoveredShapeChanged,
    onViewportChanged,
    imageOffset,
    imageScale,
    isPanning,
    annotationDoc,
    resolveShapeIndexById,
  } = params
  const selectedShapeIndex = resolveShapeIndexById(params.selectedShapeId)
  const onViewportChangedRef = useRef(onViewportChanged)

  useEffect(() => {
    onViewportChangedRef.current = onViewportChanged
  }, [onViewportChanged])

  const setSelectedShapeWithEvent = useCallback(
    (shapeIndex: number | null) => {
      onSelectionChanged(getShapeStableIdAtIndex(annotationDoc, shapeIndex))
    },
    [annotationDoc, onSelectionChanged],
  )

  const setHoveredShapeWithEvent = useCallback(
    (shapeIndex: number | null | ((prev: number | null) => number | null)) => {
      if (typeof shapeIndex === "function") {
        onHoveredShapeChanged((prevShapeId) => {
          const prevIndex = resolveShapeIndexById(prevShapeId)
          const nextIndex = shapeIndex(prevIndex)
          return getShapeStableIdAtIndex(annotationDoc, nextIndex)
        })
        return
      }
      onHoveredShapeChanged(getShapeStableIdAtIndex(annotationDoc, shapeIndex))
    },
    [annotationDoc, onHoveredShapeChanged, resolveShapeIndexById],
  )

  const handleRectangleMouseEnterById = useCallback(
    (shapeId: string) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      setHoveredShapeWithEvent(shapeIndex)
    },
    [resolveShapeIndexById, setHoveredShapeWithEvent],
  )

  const handleRectangleMouseLeaveById = useCallback(
    (shapeId: string) => {
      setHoveredShapeWithEvent((prevIndex) => {
        const prevId = getShapeStableIdAtIndex(annotationDoc, prevIndex)
        return prevId === shapeId ? null : prevIndex
      })
    },
    [annotationDoc, setHoveredShapeWithEvent],
  )

  const handleRectangleClickById = useCallback(
    (shapeId: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation()
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      setSelectedShapeWithEvent(shapeIndex)
    },
    [resolveShapeIndexById, setSelectedShapeWithEvent],
  )

  const interactionHandlers = useTaskCanvasInteractions({
    drawingLayerActive: params.drawingLayerActive,
    rightToolMode: params.rightToolMode,
    annotationDoc: params.annotationDoc,
    activeShapeIndex: selectedShapeIndex,
    selectedRotationRect: params.selectedRotationRect,
    annotationDocRef: params.annotationDocRef,
    stageRef: params.stageRef,
    getCurrentImageGeometry: params.getCurrentImageGeometry,
    stageToImageWithGeometry: params.stageToImageWithGeometry,
    onSelectShapeIndex: setSelectedShapeWithEvent,
    setShapeDragAction: params.dragSession.setShapeDragAction,
    setPolygonDragAction: params.dragSession.setPolygonDragAction,
    setRotationTransformAction: params.dragSession.setRotationTransformAction,
    setRotationDragAction: params.dragSession.setRotationDragAction,
    setPolygonVertexDragAction: params.dragSession.setPolygonVertexDragAction,
  })

  const viewState = useCanvasViewState({
    rightToolMode: params.rightToolMode,
    imageObjectUrl: params.imageObjectUrl,
    isImageLoading: params.isImageLoading,
    imageLoadError: params.imageLoadError,
    shapeDragAction: params.dragSession.shapeDragAction,
    polygonDragAction: params.dragSession.polygonDragAction,
    polygonVertexDragAction: params.dragSession.polygonVertexDragAction,
    rotationDragAction: params.dragSession.rotationDragAction,
    rotationTransformAction: params.dragSession.rotationTransformAction,
    drawingLayerActive: params.drawingLayerActive,
    isPanning: params.isPanning,
    setIsPanning: params.setIsPanning,
    panStartRef: params.panStartRef,
    imageOffset: params.imageOffset,
    setImageOffset: params.setImageOffset,
    setImageScale: params.setImageScale,
    setSelectedShapeIndex: setSelectedShapeWithEvent,
    setHoveredShapeIndex: setHoveredShapeWithEvent,
    setRawHighlightCorner: params.setRawHighlightCorner,
  })

  const handleRectangleMouseDownById = useCallback(
    (shapeId: string, event: ReactMouseEvent<HTMLDivElement>) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      interactionHandlers.handleRectangleMouseDown(shapeIndex, event)
    },
    [interactionHandlers, resolveShapeIndexById],
  )

  const handleMaskMouseDownById = useCallback(
    (shapeId: string, event: ReactMouseEvent<HTMLElement>) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      interactionHandlers.handleMaskMouseDown(shapeIndex, event)
    },
    [interactionHandlers, resolveShapeIndexById],
  )

  const handlePointMouseDownById = useCallback(
    (shapeId: string, event: ReactMouseEvent<Element>) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      interactionHandlers.handlePointMouseDown(shapeIndex, event)
    },
    [interactionHandlers, resolveShapeIndexById],
  )

  const handlePolygonMouseDownById = useCallback(
    (shapeId: string, event: ReactMouseEvent<SVGGraphicsElement>) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      interactionHandlers.handlePolygonMouseDown(shapeIndex, event)
    },
    [interactionHandlers, resolveShapeIndexById],
  )

  const handleRotationPolygonMouseDownById = useCallback(
    (shapeId: string, event: ReactMouseEvent<SVGPolygonElement>) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      interactionHandlers.handleRotationPolygonMouseDown(shapeIndex, event)
    },
    [interactionHandlers, resolveShapeIndexById],
  )

  const handlePolygonVertexMouseDownById = useCallback(
    (shapeId: string, vertexIndex: number, event: ReactMouseEvent<SVGCircleElement>) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      interactionHandlers.handlePolygonVertexMouseDown(shapeIndex, vertexIndex, event)
    },
    [interactionHandlers, resolveShapeIndexById],
  )

  const handleCuboidFaceMouseDownById = useCallback(
    (shapeId: string, face: "front" | "back", event: ReactMouseEvent<SVGPolygonElement>) => {
      const shapeIndex = resolveShapeIndexById(shapeId)
      if (shapeIndex === null) return
      interactionHandlers.handleCuboidFaceMouseDown(shapeIndex, face, event)
    },
    [interactionHandlers, resolveShapeIndexById],
  )

  useEffect(() => {
    const notifyViewportChanged = onViewportChangedRef.current
    if (!notifyViewportChanged) return
    notifyViewportChanged({
      offset: imageOffset,
      scale: imageScale,
      isPanning,
    })
  }, [imageOffset, imageScale, isPanning])

  return {
    ...interactionHandlers,
    ...viewState,
    handleRectangleMouseDown: handleRectangleMouseDownById,
    handleMaskMouseDown: handleMaskMouseDownById,
    handlePointMouseDown: handlePointMouseDownById,
    handlePolygonMouseDown: handlePolygonMouseDownById,
    handleRotationPolygonMouseDown: handleRotationPolygonMouseDownById,
    handlePolygonVertexMouseDown: handlePolygonVertexMouseDownById,
    handleCuboidFaceMouseDown: handleCuboidFaceMouseDownById,
    handleRectangleMouseEnter: handleRectangleMouseEnterById,
    handleRectangleMouseLeave: handleRectangleMouseLeaveById,
    handleRectangleClick: handleRectangleClickById,
  }
}

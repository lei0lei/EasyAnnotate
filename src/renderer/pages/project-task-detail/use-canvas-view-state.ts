/**
 * 模块：project-task-detail/use-canvas-view-state
 * 职责：管理画布视图状态（缩放、平移、点击/滚轮手势）。
 * 边界：仅处理视图层行为，不负责标注数据写入。
 */
import { useEffect, useMemo, useRef } from "react"
import type { MouseEventHandler, WheelEventHandler, MutableRefObject } from "react"
import type {
  PolygonDragAction,
  PolygonVertexDragAction,
  RightToolMode,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "@/pages/project-task-detail/types"
import type { RawHighlightCorner } from "@/pages/project-task-detail/hook-shared"

type UseCanvasViewStateParams = {
  rightToolMode: RightToolMode
  imageObjectUrl: string
  isImageLoading: boolean
  imageLoadError: boolean
  shapeDragAction: ShapeDragAction | null
  polygonDragAction: PolygonDragAction | null
  polygonVertexDragAction: PolygonVertexDragAction | null
  rotationDragAction: RotationDragAction | null
  rotationTransformAction: RotationTransformAction | null
  drawingLayerActive: boolean
  isPanning: boolean
  setIsPanning: (value: boolean) => void
  panStartRef: MutableRefObject<{ x: number; y: number; originX: number; originY: number } | null>
  imageOffset: { x: number; y: number }
  setImageOffset: (value: { x: number; y: number }) => void
  setImageScale: (updater: (prev: number) => number) => void
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
  polygonDragAction: PolygonDragAction | null
  polygonVertexDragAction: PolygonVertexDragAction | null
  rotationDragAction: RotationDragAction | null
  rotationTransformAction: RotationTransformAction | null
}): boolean {
  return (
    args.rightToolMode === "select" &&
    !!args.imageObjectUrl &&
    !args.isImageLoading &&
    !args.imageLoadError &&
    !args.shapeDragAction &&
    !args.polygonDragAction &&
    !args.polygonVertexDragAction &&
    !args.rotationDragAction &&
    !args.rotationTransformAction
  )
}

export function useCanvasViewState(params: UseCanvasViewStateParams) {
  /** 抓手平移时合并 mousemove，每帧最多一次 setImageOffset，避免整页高频重渲染 */
  const panFlushRafRef = useRef<number | null>(null)
  const pendingPanOffsetRef = useRef<{ x: number; y: number } | null>(null)
  /** 滚轮缩放合并到每帧一次 setImageScale */
  const wheelFlushRafRef = useRef<number | null>(null)
  const pendingWheelFactorRef = useRef(1)

  const flushPendingWheel = () => {
    if (wheelFlushRafRef.current !== null) {
      cancelAnimationFrame(wheelFlushRafRef.current)
      wheelFlushRafRef.current = null
    }
    const f = pendingWheelFactorRef.current
    if (f !== 1) {
      pendingWheelFactorRef.current = 1
      params.setImageScale((prev) => Math.min(8, Math.max(0.2, prev * f)))
    }
  }

  useEffect(() => {
    return () => {
      if (panFlushRafRef.current !== null) {
        cancelAnimationFrame(panFlushRafRef.current)
        panFlushRafRef.current = null
      }
      if (wheelFlushRafRef.current !== null) {
        cancelAnimationFrame(wheelFlushRafRef.current)
        wheelFlushRafRef.current = null
      }
      pendingWheelFactorRef.current = 1
    }
  }, [])

  const canPanAndZoom = useMemo(
    () =>
      canPanAndZoomFromState({
        rightToolMode: params.rightToolMode,
        imageObjectUrl: params.imageObjectUrl,
        isImageLoading: params.isImageLoading,
        imageLoadError: params.imageLoadError,
        shapeDragAction: params.shapeDragAction,
        polygonDragAction: params.polygonDragAction,
        polygonVertexDragAction: params.polygonVertexDragAction,
        rotationDragAction: params.rotationDragAction,
        rotationTransformAction: params.rotationTransformAction,
      }),
    [
      params.imageLoadError,
      params.imageObjectUrl,
      params.isImageLoading,
      params.polygonDragAction,
      params.polygonVertexDragAction,
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
    pendingWheelFactorRef.current *= factor
    if (wheelFlushRafRef.current === null) {
      wheelFlushRafRef.current = requestAnimationFrame(() => {
        wheelFlushRafRef.current = null
        const f = pendingWheelFactorRef.current
        pendingWheelFactorRef.current = 1
        params.setImageScale((prev) => Math.min(8, Math.max(0.2, prev * f)))
      })
    }
  }

  const handleImageMouseDown: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    if (event.button !== 0) return
    event.preventDefault()
    flushPendingWheel()
    if (panFlushRafRef.current !== null) {
      cancelAnimationFrame(panFlushRafRef.current)
      panFlushRafRef.current = null
    }
    pendingPanOffsetRef.current = null
    params.setIsPanning(true)
    params.panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: params.imageOffset.x,
      originY: params.imageOffset.y,
    }
  }

  const handleImageMouseMove: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!params.isPanning || !params.panStartRef.current || !canPanAndZoom) return
    const { x, y, originX, originY } = params.panStartRef.current
    const next = { x: originX + (event.clientX - x), y: originY + (event.clientY - y) }
    pendingPanOffsetRef.current = next
    if (panFlushRafRef.current === null) {
      panFlushRafRef.current = requestAnimationFrame(() => {
        panFlushRafRef.current = null
        const pending = pendingPanOffsetRef.current
        if (pending !== null) {
          pendingPanOffsetRef.current = null
          params.setImageOffset(pending)
        }
      })
    }
  }

  const handleImageDoubleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    event.preventDefault()
    flushPendingWheel()
    if (panFlushRafRef.current !== null) {
      cancelAnimationFrame(panFlushRafRef.current)
      panFlushRafRef.current = null
    }
    pendingPanOffsetRef.current = null
    params.setImageScale(() => 1)
    params.setImageOffset({ x: 0, y: 0 })
    params.setIsPanning(false)
    params.panStartRef.current = null
  }

  const endImagePan = () => {
    flushPendingWheel()
    if (panFlushRafRef.current !== null) {
      cancelAnimationFrame(panFlushRafRef.current)
      panFlushRafRef.current = null
    }
    const pending = pendingPanOffsetRef.current
    pendingPanOffsetRef.current = null
    if (pending !== null) params.setImageOffset(pending)
    params.setIsPanning(false)
    params.panStartRef.current = null
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
    handleStageClick,
  }
}

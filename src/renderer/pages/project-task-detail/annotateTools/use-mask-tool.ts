/**
 * 模块：project-task-detail/annotateTools/use-mask-tool
 * 职责：处理 Mask 绘制流程（笔刷/橡皮、草稿轨迹、写回）。
 * 边界：专注 mask 工具，不处理其他图元绘制。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { eraseMaskPointsByStroke, interpolateMaskPoints } from "@/pages/project-task-detail/annotateTools/mask-draw-ops"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { CanvasShapeCreatedEvent } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import { useCallback, useMemo, useState, type MouseEvent, type MutableRefObject } from "react"

type UseMaskToolParams = {
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
  imageOffset: { x: number; y: number }
  imageScale: number
  annotationDoc: XAnyLabelFile | null
  applyShapePatch: (shapeIndex: number, points: number[][], options?: { persist?: boolean }) => void
  createShape: (params: {
    imagePath: string
    imageWidth: number
    imageHeight: number
    shape: XAnyLabelFile["shapes"][number]
  }) => { shapeIndex: number; shapeId: string }
  deleteShape: (shapeIndex: number) => void
  selectedShapeIndex: number | null
  setSelectedShapeIndex: (index: number | null) => void
  imageNaturalSize: { width: number; height: number }
  rectPendingLabel: string
  onShapeCreated?: (event: CanvasShapeCreatedEvent) => void
}

type UseMaskToolResult = {
  maskDrawMode: "brush" | "eraser"
  setMaskDrawMode: (mode: "brush" | "eraser") => void
  maskBrushSize: number
  setMaskBrushSize: (size: number) => void
  canDrawMask: boolean
  maskDraftStagePoints: Point[]
  maskCursorStagePoint: Point | null
  hasMaskDraft: boolean
  createMaskDraft: (event: MouseEvent<HTMLDivElement>) => void
  appendMaskDraftPoint: (event: MouseEvent<HTMLDivElement>) => void
  commitMaskStroke: () => void
  clearMaskTransientState: () => void
}

export function useMaskTool({
  rightToolMode,
  rectDrawingEnabled,
  imageGeometry,
  activeImagePath,
  isImageLoading,
  imageLoadError,
  stageRef,
  getCurrentImageGeometry,
  stageToImageStrictWithGeometry,
  imageToStage,
  imageOffset,
  imageScale,
  annotationDoc,
  applyShapePatch,
  createShape,
  deleteShape,
  selectedShapeIndex,
  setSelectedShapeIndex,
  imageNaturalSize,
  rectPendingLabel,
  onShapeCreated,
}: UseMaskToolParams): UseMaskToolResult {
  const [maskDrawMode, setMaskDrawMode] = useState<"brush" | "eraser">("brush")
  const [maskBrushSize, setMaskBrushSize] = useState(18)
  const [maskStrokeDraft, setMaskStrokeDraft] = useState<Point[]>([])
  const [maskCursorPoint, setMaskCursorPoint] = useState<Point | null>(null)

  const canDrawMask =
    rightToolMode === "mask" && rectDrawingEnabled && !!imageGeometry && !!activeImagePath && !isImageLoading && !imageLoadError

  const maskDraftStagePoints = useMemo(
    () =>
      maskStrokeDraft
        .map((point) => imageToStage(point))
        .filter((item): item is Point => !!item),
    [imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, maskStrokeDraft],
  )

  const maskCursorStagePoint = useMemo(() => {
    if (!maskCursorPoint) return null
    return imageToStage(maskCursorPoint)
  }, [imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, maskCursorPoint])

  const clearMaskTransientState = useCallback(() => {
    setMaskStrokeDraft([])
    setMaskCursorPoint(null)
  }, [])

  const createMaskDraft = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawMask || !stageRef.current) return
      if (event.button !== 0) return
      const rect = stageRef.current.getBoundingClientRect()
      const geometry = getCurrentImageGeometry()
      if (!geometry) return
      const pt = stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
      if (!pt) return
      event.preventDefault()
      event.stopPropagation()
      const startPoint = { x: pt.x, y: pt.y }
      setMaskCursorPoint(startPoint)
      setMaskStrokeDraft([startPoint])
    },
    [canDrawMask, getCurrentImageGeometry, stageRef, stageToImageStrictWithGeometry],
  )

  const appendMaskDraftPoint = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawMask || !stageRef.current) return
      const rect = stageRef.current.getBoundingClientRect()
      const geometry = getCurrentImageGeometry()
      if (!geometry) return
      const pt = stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
      if (!pt) return
      const currentPoint = { x: pt.x, y: pt.y }
      setMaskCursorPoint(currentPoint)
      if (maskStrokeDraft.length === 0) return
      setMaskStrokeDraft((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (!last) return prev
        const interpolated = interpolateMaskPoints(last, currentPoint, maskBrushSize)
        if (interpolated.length === 0) return prev
        return [...prev, ...interpolated]
      })
    },
    [canDrawMask, getCurrentImageGeometry, maskBrushSize, maskStrokeDraft.length, stageRef, stageToImageStrictWithGeometry],
  )

  const commitMaskStroke = useCallback(() => {
    if (!canDrawMask || maskStrokeDraft.length === 0) {
      setMaskStrokeDraft([])
      return
    }

    if (maskDrawMode === "eraser") {
      const currentDoc = annotationDoc
      if (!currentDoc) {
        setMaskStrokeDraft([])
        return
      }
      const targetIndex =
        selectedShapeIndex !== null && currentDoc.shapes[selectedShapeIndex]?.shape_type === "mask" ? selectedShapeIndex : null
      if (targetIndex === null) {
        setMaskStrokeDraft([])
        return
      }
      const eraseRadius = Math.max(2, maskBrushSize / 2)
      const targetShape = currentDoc.shapes[targetIndex]
      if (!targetShape || targetShape.shape_type !== "mask") {
        setMaskStrokeDraft([])
        return
      }

      const strokePoints =
        maskStrokeDraft.length > 1 ? maskStrokeDraft : ([maskStrokeDraft[0], maskStrokeDraft[0]].filter(Boolean) as Point[])
      const targetBrushSize =
        typeof targetShape.attributes?.brushSize === "number"
          ? Number(targetShape.attributes.brushSize)
          : typeof targetShape.attributes?.maskBrushSize === "number"
            ? Number(targetShape.attributes.maskBrushSize)
            : maskBrushSize
      const keptPoints = eraseMaskPointsByStroke({
        points: targetShape.points,
        brushSize: Math.max(1, targetBrushSize || maskBrushSize),
        eraserStroke: strokePoints,
        eraserRadius: eraseRadius,
      })
      if (keptPoints.length !== targetShape.points.length) {
        if (keptPoints.length > 0) {
          applyShapePatch(targetIndex, keptPoints, { persist: true })
          setSelectedShapeIndex(targetIndex)
        } else {
          deleteShape(targetIndex)
          setSelectedShapeIndex(null)
        }
      }
      setMaskStrokeDraft([])
      return
    }

    const strokePoints = maskStrokeDraft.length === 1 ? [...maskStrokeDraft, { ...maskStrokeDraft[0] }] : maskStrokeDraft
    const selectedMaskIndex =
      annotationDoc && selectedShapeIndex !== null && annotationDoc.shapes[selectedShapeIndex]?.shape_type === "mask"
        ? selectedShapeIndex
        : null
    if (annotationDoc && selectedMaskIndex !== null) {
      const targetShape = annotationDoc.shapes[selectedMaskIndex]
      if (targetShape && targetShape.shape_type === "mask") {
        const mergedPoints = [
          ...targetShape.points.map((point) => [Number(point[0] ?? 0), Number(point[1] ?? 0)] as number[]),
          ...strokePoints.map((point) => [point.x, point.y] as number[]),
        ]
        applyShapePatch(selectedMaskIndex, mergedPoints, { persist: true })
        setSelectedShapeIndex(selectedMaskIndex)
        setMaskStrokeDraft([])
        return
      }
    }

    const created = createShape({
      imagePath: activeImagePath,
      imageWidth: imageNaturalSize.width,
      imageHeight: imageNaturalSize.height,
      shape: {
        label: rectPendingLabel,
        score: null,
        points: strokePoints.map((point) => [point.x, point.y]),
        group_id: null,
        description: null,
        difficult: false,
        shape_type: "mask",
        flags: null,
        attributes: { brushSize: maskBrushSize },
        kie_linking: [],
      },
    })
    onShapeCreated?.({
      shapeId: created.shapeId,
      shapeType: "mask",
      source: "draw",
    })
    setSelectedShapeIndex(created.shapeIndex)
    setMaskStrokeDraft([])
  }, [
    activeImagePath,
    annotationDoc,
    applyShapePatch,
    canDrawMask,
    createShape,
    deleteShape,
    imageNaturalSize.height,
    imageNaturalSize.width,
    maskBrushSize,
    maskDrawMode,
    maskStrokeDraft,
    rectPendingLabel,
    selectedShapeIndex,
    setSelectedShapeIndex,
    onShapeCreated,
  ])

  return {
    maskDrawMode,
    setMaskDrawMode,
    maskBrushSize,
    setMaskBrushSize,
    canDrawMask,
    maskDraftStagePoints,
    maskCursorStagePoint,
    hasMaskDraft: maskStrokeDraft.length > 0,
    createMaskDraft,
    appendMaskDraftPoint,
    commitMaskStroke,
    clearMaskTransientState,
  }
}

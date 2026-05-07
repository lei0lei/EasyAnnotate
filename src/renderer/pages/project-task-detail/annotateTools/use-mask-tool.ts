/**
 * 模块：project-task-detail/annotateTools/use-mask-tool
 * 职责：Mask 绘制（笔刷 / 橡皮）、草稿轨迹、写回。
 * 边界：二维光栅 + CVAT 风格行主序 RLE 存盘；橡皮为像素擦除。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import {
  encodeBinaryToRowMajorRle,
  loadMaskBinaryFromShape,
  maskBinaryHasForeground,
  stampBrushPolyline,
  writeMaskRleAttributes,
} from "@/lib/mask-raster-rle"
import { interpolateMaskPoints } from "@/pages/project-task-detail/annotateTools/mask-draw-ops"
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
  annotationDoc: XAnyLabelFile | null
  applyMaskRlePatch: (
    shapeIndex: number,
    payload: { counts: number[]; w: number; h: number; brushSize: number },
    options?: { persist?: boolean },
  ) => void
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
  maskSessionLabel: string
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
  annotationDoc,
  applyMaskRlePatch,
  createShape,
  deleteShape,
  selectedShapeIndex,
  setSelectedShapeIndex,
  imageNaturalSize,
  rectPendingLabel,
  maskSessionLabel,
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
    [imageGeometry, imageToStage, maskStrokeDraft],
  )

  const maskCursorStagePoint = useMemo(() => {
    if (!maskCursorPoint) return null
    return imageToStage(maskCursorPoint)
  }, [imageGeometry, imageToStage, maskCursorPoint])

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
      setMaskStrokeDraft((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (!last) return prev
        const interpolated = interpolateMaskPoints(last, currentPoint, maskBrushSize)
        if (interpolated.length === 0) return prev
        return [...prev, ...interpolated]
      })
    },
    [canDrawMask, getCurrentImageGeometry, maskBrushSize, stageRef, stageToImageStrictWithGeometry],
  )

  const commitMaskStroke = useCallback(() => {
    if (!canDrawMask || maskStrokeDraft.length === 0) {
      setMaskStrokeDraft([])
      return
    }

    const iw = imageNaturalSize.width
    const ih = imageNaturalSize.height
    if (iw <= 0 || ih <= 0) {
      setMaskStrokeDraft([])
      return
    }

    const strokePoints = maskStrokeDraft.length === 1 ? [...maskStrokeDraft, { ...maskStrokeDraft[0]! }] : maskStrokeDraft
    const sessionLabel = maskSessionLabel.trim() || rectPendingLabel.trim()
    const brushRadius = Math.max(1, maskBrushSize / 2)

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
      const targetShape = currentDoc.shapes[targetIndex]
      if (!targetShape || targetShape.shape_type !== "mask") {
        setMaskStrokeDraft([])
        return
      }
      const eraserRadius = Math.max(2, maskBrushSize / 2)
      const targetBrushSize =
        typeof targetShape.attributes?.brushSize === "number"
          ? Number(targetShape.attributes.brushSize)
          : typeof targetShape.attributes?.maskBrushSize === "number"
            ? Number(targetShape.attributes.maskBrushSize)
            : maskBrushSize

      const buf = loadMaskBinaryFromShape(targetShape, iw, ih, maskBrushSize)
      stampBrushPolyline(buf, iw, ih, strokePoints, eraserRadius, 0, maskBrushSize)
      if (!maskBinaryHasForeground(buf)) {
        deleteShape(targetIndex)
        setSelectedShapeIndex(null)
      } else {
        const counts = encodeBinaryToRowMajorRle(buf)
        applyMaskRlePatch(
          targetIndex,
          { counts, w: iw, h: ih, brushSize: Math.max(1, targetBrushSize || maskBrushSize) },
          { persist: true },
        )
        setSelectedShapeIndex(targetIndex)
      }
      setMaskStrokeDraft([])
      return
    }

    const selectedMaskIndex =
      annotationDoc && selectedShapeIndex !== null && annotationDoc.shapes[selectedShapeIndex]?.shape_type === "mask"
        ? selectedShapeIndex
        : null
    if (annotationDoc && selectedMaskIndex !== null) {
      const targetShape = annotationDoc.shapes[selectedMaskIndex]
      if (targetShape && targetShape.shape_type === "mask" && targetShape.label.trim() === sessionLabel) {
        const buf = loadMaskBinaryFromShape(targetShape, iw, ih, maskBrushSize)
        stampBrushPolyline(buf, iw, ih, strokePoints, brushRadius, 1, maskBrushSize)
        const counts = encodeBinaryToRowMajorRle(buf)
        const storedBrush =
          typeof targetShape.attributes?.brushSize === "number"
            ? Math.max(1, Number(targetShape.attributes.brushSize))
            : typeof targetShape.attributes?.maskBrushSize === "number"
              ? Math.max(1, Number(targetShape.attributes.maskBrushSize))
              : maskBrushSize
        const mergedBrush = Math.max(maskBrushSize, storedBrush)
        applyMaskRlePatch(selectedMaskIndex, { counts, w: iw, h: ih, brushSize: mergedBrush }, { persist: true })
        setSelectedShapeIndex(selectedMaskIndex)
        setMaskStrokeDraft([])
        return
      }
    }

    const empty = new Uint8Array(iw * ih)
    stampBrushPolyline(empty, iw, ih, strokePoints, brushRadius, 1, maskBrushSize)
    const counts = encodeBinaryToRowMajorRle(empty)
    const created = createShape({
      imagePath: activeImagePath,
      imageWidth: iw,
      imageHeight: ih,
      shape: {
        label: sessionLabel,
        score: null,
        points: [],
        group_id: null,
        description: null,
        difficult: false,
        shape_type: "mask",
        flags: null,
        attributes: writeMaskRleAttributes({}, { counts, w: iw, h: ih, brushSize: maskBrushSize }),
        kie_linking: [],
      },
    })
    onShapeCreated?.({
      shapeId: created.shapeId,
      shapeType: "mask",
      source: "draw",
    })
    setMaskStrokeDraft([])
  }, [
    activeImagePath,
    annotationDoc,
    applyMaskRlePatch,
    canDrawMask,
    createShape,
    deleteShape,
    imageNaturalSize.height,
    imageNaturalSize.width,
    maskBrushSize,
    maskDrawMode,
    maskSessionLabel,
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

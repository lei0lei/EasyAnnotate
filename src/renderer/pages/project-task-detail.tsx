import { readTasks } from "@/lib/project-tasks-storage"
import {
  deleteImageAnnotation,
  deleteTaskImage,
  downloadTaskImage,
  getProject,
  getImageFileInfo,
  listTaskFiles,
  readImageAnnotation,
  readImageFile,
  writeImageAnnotation,
  type ProjectItem,
  type TaskFileItem,
} from "@/lib/projects-api"
import { createXAnyLabelTemplate, normalizeXAnyLabelDoc, type XAnyLabelFile } from "@/lib/xanylabeling-format"
import {
  RectangleOverlayItem,
  TaskCanvasLayer,
  TaskDetailHeader,
  TaskDrawHint,
  TaskLeftPanelContent,
  TaskLeftSidebarLayer,
  TaskRectLabelPicker,
  TaskToolPalette,
} from "@/pages/project-task-detail/components"
import type {
  LabelsTab,
  LeftPanelMode,
  Point,
  RenderedRectangle,
  RenderedRotationRect,
  RightToolMode,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "@/pages/project-task-detail/types"
import {
  fileNameFromPath,
  formatBytes,
  guessMimeType,
  normalizeDocPointsToInt,
  normalizeTagColor,
  resolveTaskImagePath,
  rotatePoint,
  roundPointToInt,
  roundPointsToInt,
} from "@/pages/project-task-detail/utils"
import {
  remapIndexAfterDelete,
  remapIndexAfterReorder,
  reorderItemsByIndex,
  resolveReorderTargetIndex,
} from "@/pages/project-task-detail/shape-ops"
import { cn } from "@/lib/utils"
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { useParams } from "react-router-dom"

type DrawShapeType = "rectangle" | "rotation"

type ToolState = {
  rightToolMode: RightToolMode
  rectPickerOpen: boolean
  rectDrawingEnabled: boolean
  rectFirstPoint: Point | null
  rectHoverPoint: Point | null
  drawShapeType: DrawShapeType
}

type ToolAction =
  | { type: "setRightToolMode"; mode: RightToolMode }
  | { type: "setRectHoverPoint"; point: Point | null }
  | { type: "startRectTool" }
  | { type: "startRotRectTool" }
  | { type: "confirmRectPicker" }
  | { type: "cancelRectPicker" }
  | { type: "selectTool" }
  | { type: "resetForNewFile" }
  | { type: "clearRectPoints" }
  | { type: "startRectFirstPoint"; point: Point }

const initialToolState: ToolState = {
  rightToolMode: "select",
  rectPickerOpen: false,
  rectDrawingEnabled: false,
  rectFirstPoint: null,
  rectHoverPoint: null,
  drawShapeType: "rectangle",
}

function toolReducer(state: ToolState, action: ToolAction): ToolState {
  switch (action.type) {
    case "setRightToolMode":
      return state.rightToolMode === action.mode ? state : { ...state, rightToolMode: action.mode }
    case "setRectHoverPoint":
      return state.rectHoverPoint === action.point ? state : { ...state, rectHoverPoint: action.point }
    case "startRectTool":
      return {
        ...state,
        rightToolMode: "rect",
        drawShapeType: "rectangle",
        rectPickerOpen: true,
        rectDrawingEnabled: false,
        rectFirstPoint: null,
        rectHoverPoint: null,
      }
    case "startRotRectTool":
      return {
        ...state,
        rightToolMode: "rotRect",
        drawShapeType: "rotation",
        rectPickerOpen: true,
        rectDrawingEnabled: false,
        rectFirstPoint: null,
        rectHoverPoint: null,
      }
    case "confirmRectPicker":
      return { ...state, rectPickerOpen: false, rectDrawingEnabled: true, rectFirstPoint: null, rectHoverPoint: null }
    case "cancelRectPicker":
      return { ...state, rectPickerOpen: false, rectDrawingEnabled: false }
    case "selectTool":
      return {
        ...state,
        rightToolMode: "select",
        rectPickerOpen: false,
        rectDrawingEnabled: false,
        rectFirstPoint: null,
        rectHoverPoint: null,
      }
    case "resetForNewFile":
      return { ...state, rectPickerOpen: false, rectDrawingEnabled: false, rectFirstPoint: null, rectHoverPoint: null }
    case "clearRectPoints":
      return { ...state, rectFirstPoint: null, rectHoverPoint: null }
    case "startRectFirstPoint":
      return { ...state, rectFirstPoint: action.point, rectHoverPoint: action.point }
    default:
      return state
  }
}

export default function ProjectTaskDetailPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>()
  const [files, setFiles] = useState<TaskFileItem[]>([])
  const [project, setProject] = useState<ProjectItem | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>("labels")
  const [labelsTab, setLabelsTab] = useState<LabelsTab>("layers")
  const [toolState, dispatchTool] = useReducer(toolReducer, initialToolState)
  const [imageObjectUrl, setImageObjectUrl] = useState("")
  const [activeImagePath, setActiveImagePath] = useState("")
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [imageLoadError, setImageLoadError] = useState(false)
  const [imageScale, setImageScale] = useState(1)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [annotationDoc, setAnnotationDoc] = useState<XAnyLabelFile | null>(null)
  const [panelDoc, setPanelDoc] = useState<XAnyLabelFile | null>(null)
  const [rectPendingLabel, setRectPendingLabel] = useState("")
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null)
  const [hoveredShapeIndex, setHoveredShapeIndex] = useState<number | null>(null)
  const [shapeDragAction, setShapeDragAction] = useState<ShapeDragAction | null>(null)
  const [rotationDragAction, setRotationDragAction] = useState<RotationDragAction | null>(null)
  const [rotationTransformAction, setRotationTransformAction] = useState<RotationTransformAction | null>(null)
  const [hiddenShapeIndexes, setHiddenShapeIndexes] = useState<number[]>([])
  const [hiddenClassLabels, setHiddenClassLabels] = useState<string[]>([])
  const [rawHighlightCorner, setRawHighlightCorner] = useState<{ shapeIndex: number; cornerIndex: number } | null>(null)
  const [imageFileInfo, setImageFileInfo] = useState<{
    exists: boolean
    sizeBytes: number
    format: string
    channelCount: number
    extension: string
    errorMessage: string
  }>({
    exists: false,
    sizeBytes: 0,
    format: "",
    channelCount: 0,
    extension: "",
    errorMessage: "",
  })
  const stageRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)
  const annotationDocRef = useRef<XAnyLabelFile | null>(null)
  const { rightToolMode, rectPickerOpen, rectDrawingEnabled, rectFirstPoint, rectHoverPoint, drawShapeType } = toolState

  const clearToolTransientInteractions = useCallback(() => {
    setRotationDragAction(null)
    setRotationTransformAction(null)
    setRawHighlightCorner(null)
  }, [])

  const handleSelectToolClick = useCallback(() => {
    dispatchTool({ type: "selectTool" })
    clearToolTransientInteractions()
  }, [clearToolTransientInteractions])

  const reloadTaskFiles = useCallback(async () => {
    if (!projectId || !taskId) return
    const result = await listTaskFiles({ projectId, taskId })
    if (result.errorMessage) {
      setError(result.errorMessage)
      setFiles([])
      return
    }
    setError(null)
    setFiles(result.files)
  }, [projectId, taskId])

  useEffect(() => {
    let alive = true
    if (!projectId) return
    void getProject(projectId).then((item) => {
      if (!alive) return
      setProject(item)
    })
    return () => {
      alive = false
    }
  }, [projectId])

  useEffect(() => {
    let alive = true
    if (!projectId || !taskId) return
    void listTaskFiles({ projectId, taskId }).then((result) => {
      if (!alive) return
      if (result.errorMessage) {
        setError(result.errorMessage)
        setFiles([])
        return
      }
      setError(null)
      setFiles(result.files)
    })
    return () => {
      alive = false
    }
  }, [projectId, taskId])

  useEffect(() => {
    setCurrentIndex((index) => {
      if (files.length === 0) return 0
      return Math.min(index, files.length - 1)
    })
  }, [files])

  const taskName = useMemo(() => {
    if (!projectId || !taskId) return taskId ?? "—"
    const task = readTasks(projectId).find((item) => item.id === taskId)
    return task?.name ?? taskId
  }, [projectId, taskId])

  const currentFile = files[currentIndex]
  const currentFileName = fileNameFromPath(currentFile?.filePath ?? "")
  const progressText = files.length > 0 ? `${currentIndex + 1}/${files.length}` : "0/0"
  const resolvedImagePath = resolveTaskImagePath(project, taskId, currentFile)
  const fallbackImagePath = currentFile?.filePath ?? ""
  const imagePathCandidates = useMemo(
    () => Array.from(new Set([resolvedImagePath, fallbackImagePath].map((item) => item.trim()).filter(Boolean))),
    [resolvedImagePath, fallbackImagePath],
  )

  useEffect(() => {
    let alive = true
    let objectUrl = ""

    const loadImage = async () => {
      if (imagePathCandidates.length === 0) {
        setImageObjectUrl("")
        setActiveImagePath("")
        setImageLoadError(true)
        return
      }
      setIsImageLoading(true)
      setImageLoadError(false)
      setImageObjectUrl("")

      for (const candidate of imagePathCandidates) {
        const result = await readImageFile(candidate)
        if (!alive) return
        if (result.errorMessage || !result.content || result.content.length === 0) continue
        const bytes = result.content
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: guessMimeType(candidate) }))
        setImageObjectUrl(objectUrl)
        setActiveImagePath(candidate)
        setIsImageLoading(false)
        return
      }

      setIsImageLoading(false)
      setImageLoadError(true)
      setActiveImagePath("")
    }

    void loadImage()

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imagePathCandidates])

  useEffect(() => {
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
    setIsPanning(false)
    panStartRef.current = null
    setImageNaturalSize({ width: 0, height: 0 })
    dispatchTool({ type: "clearRectPoints" })
    setSelectedShapeIndex(null)
    dispatchTool({ type: "resetForNewFile" })
    setAnnotationDoc(null)
    clearToolTransientInteractions()
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
    setLabelsTab("layers")
  }, [clearToolTransientInteractions, currentFile?.filePath])

  useEffect(() => {
    const target = stageRef.current
    if (!target) return
    const update = () => {
      const rect = target.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const annotationLabelOptions = useMemo(() => {
    const fromTags = (project?.tags ?? []).map((item) => item.name.trim()).filter(Boolean)
    return fromTags.length > 0 ? fromTags : ["default"]
  }, [project?.tags])

  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const tag of project?.tags ?? []) {
      const key = tag.name.trim()
      if (!key) continue
      map.set(key, normalizeTagColor(tag.color))
    }
    return map
  }, [project?.tags])

  useEffect(() => {
    if (!rectPendingLabel || !annotationLabelOptions.includes(rectPendingLabel)) {
      setRectPendingLabel(annotationLabelOptions[0] ?? "default")
    }
  }, [annotationLabelOptions, rectPendingLabel])

  useEffect(() => {
    let alive = true
    if (!activeImagePath || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0) return
    void readImageAnnotation(activeImagePath).then((result) => {
      if (!alive) return
      if (result.errorMessage) return
      const doc = normalizeXAnyLabelDoc({
        imagePath: activeImagePath,
        imageWidth: imageNaturalSize.width,
        imageHeight: imageNaturalSize.height,
        rawJsonText: result.exists ? result.jsonText : "",
      })
      setAnnotationDoc(normalizeDocPointsToInt(doc))
    })
    return () => {
      alive = false
    }
  }, [activeImagePath, imageNaturalSize.width, imageNaturalSize.height])

  useEffect(() => {
    annotationDocRef.current = annotationDoc
  }, [annotationDoc])

  useEffect(() => {
    if (!shapeDragAction) {
      setPanelDoc(annotationDoc)
    }
  }, [annotationDoc, shapeDragAction])

  useEffect(() => {
    let alive = true
    if (!activeImagePath) {
      setImageFileInfo({ exists: false, sizeBytes: 0, format: "", channelCount: 0, extension: "", errorMessage: "" })
      return
    }
    void getImageFileInfo(activeImagePath).then((result) => {
      if (!alive) return
      setImageFileInfo(result)
    })
    return () => {
      alive = false
    }
  }, [activeImagePath])

  const persistAnnotation = (nextDoc: XAnyLabelFile) => {
    if (!activeImagePath) return
    const normalized = normalizeDocPointsToInt(nextDoc)
    void writeImageAnnotation({
      imagePath: activeImagePath,
      jsonText: JSON.stringify(normalized, null, 2),
    })
  }

  const imageGeometry = useMemo(() => {
    const naturalW = imageNaturalSize.width
    const naturalH = imageNaturalSize.height
    const stageW = stageSize.width
    const stageH = stageSize.height
    if (naturalW <= 0 || naturalH <= 0 || stageW <= 0 || stageH <= 0) return null
    const fitScale = Math.min(stageW / naturalW, stageH / naturalH)
    const baseWidth = naturalW * fitScale
    const baseHeight = naturalH * fitScale
    const baseLeft = (stageW - baseWidth) / 2
    const baseTop = (stageH - baseHeight) / 2
    return {
      fitScale,
      baseWidth,
      baseHeight,
      baseLeft,
      baseTop,
      stageWidth: stageW,
      stageHeight: stageH,
    }
  }, [imageNaturalSize.height, imageNaturalSize.width, stageSize.height, stageSize.width])

  const getCurrentImageGeometry = () => {
    const naturalW = imageNaturalSize.width
    const naturalH = imageNaturalSize.height
    const stageRect = stageRef.current?.getBoundingClientRect()
    const stageW = stageRect?.width ?? stageSize.width
    const stageH = stageRect?.height ?? stageSize.height
    if (naturalW <= 0 || naturalH <= 0 || stageW <= 0 || stageH <= 0) return null
    const fitScale = Math.min(stageW / naturalW, stageH / naturalH)
    const baseWidth = naturalW * fitScale
    const baseHeight = naturalH * fitScale
    const baseLeft = (stageW - baseWidth) / 2
    const baseTop = (stageH - baseHeight) / 2
    return {
      fitScale,
      baseWidth,
      baseHeight,
      baseLeft,
      baseTop,
      stageWidth: stageW,
      stageHeight: stageH,
    }
  }

  const stageToImageWithGeometry = (
    stagePoint: Point,
    geometry: {
      fitScale: number
      baseWidth: number
      baseHeight: number
      baseLeft: number
      baseTop: number
      stageWidth: number
      stageHeight: number
    },
  ): Point | null => {
    const xBase =
      (stagePoint.x - geometry.baseLeft - imageOffset.x - geometry.baseWidth / 2) / imageScale + geometry.baseWidth / 2
    const yBase =
      (stagePoint.y - geometry.baseTop - imageOffset.y - geometry.baseHeight / 2) / imageScale + geometry.baseHeight / 2
    const x = xBase / geometry.fitScale
    const y = yBase / geometry.fitScale
    const clampedX = Math.min(imageNaturalSize.width, Math.max(0, x))
    const clampedY = Math.min(imageNaturalSize.height, Math.max(0, y))
    return { x: clampedX, y: clampedY }
  }

  const stageToImageStrictWithGeometry = (
    stagePoint: Point,
    geometry: {
      fitScale: number
      baseWidth: number
      baseHeight: number
      baseLeft: number
      baseTop: number
      stageWidth: number
      stageHeight: number
    },
  ): Point | null => {
    const xBase =
      (stagePoint.x - geometry.baseLeft - imageOffset.x - geometry.baseWidth / 2) / imageScale + geometry.baseWidth / 2
    const yBase =
      (stagePoint.y - geometry.baseTop - imageOffset.y - geometry.baseHeight / 2) / imageScale + geometry.baseHeight / 2
    const x = xBase / geometry.fitScale
    const y = yBase / geometry.fitScale
    if (x < 0 || x > imageNaturalSize.width || y < 0 || y > imageNaturalSize.height) return null
    return { x, y }
  }

  const imageToStage = (point: Point): Point | null => {
    if (!imageGeometry) return null
    const xBase = point.x * imageGeometry.fitScale
    const yBase = point.y * imageGeometry.fitScale
    const x =
      ((xBase - imageGeometry.baseWidth / 2) * imageScale + imageGeometry.baseWidth / 2) +
      imageGeometry.baseLeft +
      imageOffset.x
    const y =
      ((yBase - imageGeometry.baseHeight / 2) * imageScale + imageGeometry.baseHeight / 2) +
      imageGeometry.baseTop +
      imageOffset.y
    return { x, y }
  }

  const stageToImage = (stagePoint: Point): Point | null => {
    if (!imageGeometry) return null
    const xBase =
      (stagePoint.x - imageGeometry.baseLeft - imageOffset.x - imageGeometry.baseWidth / 2) / imageScale +
      imageGeometry.baseWidth / 2
    const yBase =
      (stagePoint.y - imageGeometry.baseTop - imageOffset.y - imageGeometry.baseHeight / 2) / imageScale +
      imageGeometry.baseHeight / 2
    const x = xBase / imageGeometry.fitScale
    const y = yBase / imageGeometry.fitScale
    const clampedX = Math.min(imageNaturalSize.width, Math.max(0, x))
    const clampedY = Math.min(imageNaturalSize.height, Math.max(0, y))
    return { x: clampedX, y: clampedY }
  }

  const canDrawRectangle =
    (rightToolMode === "rect" || rightToolMode === "rotRect") &&
    rectDrawingEnabled &&
    !!imageGeometry &&
    !!activeImagePath &&
    !isImageLoading &&
    !imageLoadError

  const previewRect = useMemo(() => {
    if (!canDrawRectangle || !rectFirstPoint || !rectHoverPoint) return null
    const p1 = imageToStage(rectFirstPoint)
    const p2 = imageToStage(rectHoverPoint)
    if (!p1 || !p2) return null
    const left = Math.min(p1.x, p2.x)
    const top = Math.min(p1.y, p2.y)
    const width = Math.abs(p1.x - p2.x)
    const height = Math.abs(p1.y - p2.y)
    const stageW = imageGeometry?.stageWidth ?? 0
    const stageH = imageGeometry?.stageHeight ?? 0
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
  }, [canDrawRectangle, rectFirstPoint, rectHoverPoint, imageGeometry])

  const drawingLayerActive = canDrawRectangle
  const pendingRectColor = labelColorMap.get(rectPendingLabel) ?? "#f59e0b"

  const renderedRectangles = useMemo(() => {
    if (!annotationDoc) return []
    const hiddenSet = new Set(hiddenShapeIndexes)
    const hiddenClassSet = new Set(hiddenClassLabels)
    const stageW = imageGeometry?.stageWidth ?? 0
    const stageH = imageGeometry?.stageHeight ?? 0
    return annotationDoc.shapes
      .map((shape, index) => {
        if (hiddenSet.has(index)) return null
        if (hiddenClassSet.has(shape.label)) return null
        if (shape.shape_type !== "rectangle" || shape.points.length < 4) return null
        const stagePoints = shape.points
          .map((pt) => imageToStage({ x: pt[0], y: pt[1] }))
          .filter((item): item is Point => !!item)
        if (stagePoints.length < 4) return null
        const xs = stagePoints.map((item) => item.x)
        const ys = stagePoints.map((item) => item.y)
        const left = Math.min(...xs)
        const right = Math.max(...xs)
        const top = Math.min(...ys)
        const bottom = Math.max(...ys)
        const clippedLeft = stageW > 0 ? Math.max(0, left) : left
        const clippedTop = stageH > 0 ? Math.max(0, top) : top
        const clippedRight = stageW > 0 ? Math.min(stageW, right) : right
        const clippedBottom = stageH > 0 ? Math.min(stageH, bottom) : bottom
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
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, labelColorMap])

  const renderedRotationRects = useMemo(() => {
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
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, labelColorMap])

  const selectedRect = selectedShapeIndex === null ? null : renderedRectangles.find((item) => item.index === selectedShapeIndex) ?? null
  const selectedRotationRect =
    selectedShapeIndex === null ? null : renderedRotationRects.find((item) => item.index === selectedShapeIndex) ?? null
  const panelShapes = panelDoc?.shapes ?? []

  const handleRectangleMouseEnter = useCallback((shapeIndex: number) => {
    setHoveredShapeIndex(shapeIndex)
  }, [])

  const handleRectangleMouseLeave = useCallback((shapeIndex: number) => {
    setHoveredShapeIndex((prev) => (prev === shapeIndex ? null : prev))
  }, [])

  const handleRectangleClick = useCallback((shapeIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    setSelectedShapeIndex(shapeIndex)
  }, [])

  const handleRectangleMouseDown = useCallback(
    (shapeIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
      if (rightToolMode !== "select" || drawingLayerActive) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      const currentDoc = annotationDocRef.current
      if (!geometry || !rect || !currentDoc) return
      const point = stageToImageWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
      if (!point) return
      const shape = currentDoc.shapes[shapeIndex]
      if (!shape || shape.shape_type !== "rectangle") return
      setShapeDragAction({
        kind: "move",
        shapeIndex,
        start: point,
        originalPoints: shape.points.map((p) => [p[0], p[1]]),
      })
      setSelectedShapeIndex(shapeIndex)
    },
    [
      drawingLayerActive,
      imageNaturalSize.height,
      imageNaturalSize.width,
      imageOffset.x,
      imageOffset.y,
      imageScale,
      rightToolMode,
      stageSize.height,
      stageSize.width,
    ],
  )

  const canPanAndZoom =
    rightToolMode === "select" &&
    !!imageObjectUrl &&
    !isImageLoading &&
    !imageLoadError &&
    !shapeDragAction &&
    !rotationDragAction &&
    !rotationTransformAction

  const handleImageWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    event.preventDefault()
    const delta = event.deltaY
    const factor = delta > 0 ? 0.9 : 1.1
    setImageScale((prev) => Math.min(8, Math.max(0.2, prev * factor)))
  }

  const handleImageMouseDown: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    if (event.button !== 0) return
    event.preventDefault()
    setIsPanning(true)
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: imageOffset.x,
      originY: imageOffset.y,
    }
  }

  const handleImageMouseMove: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (isPanning && panStartRef.current && canPanAndZoom) {
      const { x, y, originX, originY } = panStartRef.current
      const dx = event.clientX - x
      const dy = event.clientY - y
      setImageOffset({ x: originX + dx, y: originY + dy })
      return
    }
    if (!canDrawRectangle || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const pt = stageToImage({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    if (!pt) return
    const rounded = roundPointToInt(pt)
    if (!rectHoverPoint || rectHoverPoint.x !== rounded.x || rectHoverPoint.y !== rounded.y) {
      dispatchTool({ type: "setRectHoverPoint", point: rounded })
    }
  }

  const handleImageDoubleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!canPanAndZoom) return
    event.preventDefault()
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
    setIsPanning(false)
    panStartRef.current = null
  }

  const endImagePan = () => {
    setIsPanning(false)
    panStartRef.current = null
  }

  const handleRectToolClick = () => {
    dispatchTool({ type: "startRectTool" })
    setSelectedShapeIndex(null)
  }

  const handleRotRectToolClick = () => {
    dispatchTool({ type: "startRotRectTool" })
    setSelectedShapeIndex(null)
  }

  const handleRectPickerConfirm = () => {
    if (!rectPendingLabel) return
    dispatchTool({ type: "confirmRectPicker" })
  }

  const handleRectPickerCancel = () => {
    dispatchTool({ type: "cancelRectPicker" })
  }

  const upsertRectByPoint = (point: Point) => {
    if (!canDrawRectangle) return
    if (!point) return
    if (!rectFirstPoint) {
      const roundedPoint = roundPointToInt(point)
      dispatchTool({ type: "startRectFirstPoint", point: roundedPoint })
      return
    }
    const roundedCurrent = roundPointToInt(point)
    const minX = Math.min(rectFirstPoint.x, roundedCurrent.x)
    const maxX = Math.max(rectFirstPoint.x, roundedCurrent.x)
    const minY = Math.min(rectFirstPoint.y, roundedCurrent.y)
    const maxY = Math.max(rectFirstPoint.y, roundedCurrent.y)
    const width = maxX - minX
    const height = maxY - minY
    if (width < 1 || height < 1) {
      dispatchTool({ type: "clearRectPoints" })
      return
    }
    const workingDoc =
      annotationDoc ??
      createXAnyLabelTemplate({
        imagePath: activeImagePath,
        imageWidth: imageNaturalSize.width,
        imageHeight: imageNaturalSize.height,
      })
    const nextDoc: XAnyLabelFile = {
      ...workingDoc,
      shapes: [
        ...workingDoc.shapes,
        {
          label: rectPendingLabel,
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
          shape_type: drawShapeType === "rotation" ? "rotation" : "rectangle",
          flags: null,
          attributes: {},
          kie_linking: [],
        },
      ],
    }
    const normalizedDoc = normalizeDocPointsToInt(nextDoc)
    setAnnotationDoc(normalizedDoc)
    persistAnnotation(normalizedDoc)
    dispatchTool({ type: "clearRectPoints" })
  }

  const handleDrawLayerMove: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!drawingLayerActive || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const geometry = getCurrentImageGeometry()
    if (!geometry) return
    const pt = stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    if (!pt) {
      dispatchTool({ type: "setRectHoverPoint", point: null })
      return
    }
    const rounded = roundPointToInt(pt)
    if (!rectHoverPoint || rectHoverPoint.x !== rounded.x || rectHoverPoint.y !== rounded.y) {
      dispatchTool({ type: "setRectHoverPoint", point: rounded })
    }
  }

  const handleDrawLayerClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!drawingLayerActive || !stageRef.current) return
    event.stopPropagation()
    const rect = stageRef.current.getBoundingClientRect()
    const geometry = getCurrentImageGeometry()
    if (!geometry) return
    const pt = stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    if (!pt) return
    upsertRectByPoint(pt)
  }

  const handleStageClick: React.MouseEventHandler<HTMLDivElement> = () => {
    if (drawingLayerActive) return
    setSelectedShapeIndex(null)
    setHoveredShapeIndex(null)
    setRawHighlightCorner(null)
  }

  const deleteShape = (shapeIndex: number) => {
    if (!annotationDoc) return
    const nextShapes = annotationDoc.shapes.filter((_, index) => index !== shapeIndex)
    const nextDoc = normalizeDocPointsToInt({ ...annotationDoc, shapes: nextShapes })
    setAnnotationDoc(nextDoc)
    persistAnnotation(nextDoc)
    setHiddenShapeIndexes((prev) =>
      prev
        .map((idx) => remapIndexAfterDelete(idx, shapeIndex))
        .filter((idx): idx is number => idx !== null),
    )
    setSelectedShapeIndex(null)
    setHoveredShapeIndex((prev) => (prev === null ? prev : remapIndexAfterDelete(prev, shapeIndex)))
    setRawHighlightCorner((prev) => {
      if (!prev) return prev
      const nextIndex = remapIndexAfterDelete(prev.shapeIndex, shapeIndex)
      if (nextIndex === null) return null
      return { ...prev, shapeIndex: nextIndex }
    })
  }

  const toggleShapeVisibility = (shapeIndex: number) => {
    setHiddenShapeIndexes((prev) => {
      if (prev.includes(shapeIndex)) return prev.filter((idx) => idx !== shapeIndex)
      return [...prev, shapeIndex]
    })
    if (selectedShapeIndex === shapeIndex) setSelectedShapeIndex(null)
    if (hoveredShapeIndex === shapeIndex) setHoveredShapeIndex(null)
  }

  const toggleClassVisibility = (label: string) => {
    setHiddenClassLabels((prev) => {
      if (prev.includes(label)) return prev.filter((item) => item !== label)
      return [...prev, label]
    })
    const selectedShape = selectedShapeIndex !== null ? annotationDoc?.shapes?.[selectedShapeIndex] : null
    const hoveredShape = hoveredShapeIndex !== null ? annotationDoc?.shapes?.[hoveredShapeIndex] : null
    if (selectedShape?.label === label) setSelectedShapeIndex(null)
    if (hoveredShape?.label === label) setHoveredShapeIndex(null)
  }

  const reorderShapeLayer = (shapeIndex: number, mode: "forward" | "backward" | "front" | "back") => {
    const total = annotationDoc?.shapes.length ?? 0
    if (total <= 1) return
    const targetIndex = resolveReorderTargetIndex(shapeIndex, total, mode)
    if (targetIndex === shapeIndex) return

    let nextDocForPersist: XAnyLabelFile | null = null
    setAnnotationDoc((prev) => {
      if (!prev || !prev.shapes[shapeIndex]) return prev
      const nextShapes = reorderItemsByIndex(prev.shapes, shapeIndex, targetIndex)
      const nextDoc = normalizeDocPointsToInt({ ...prev, shapes: nextShapes })
      nextDocForPersist = nextDoc
      return nextDoc
    })
    if (nextDocForPersist) persistAnnotation(nextDocForPersist)

    setHiddenShapeIndexes((prev) => Array.from(new Set(prev.map((idx) => remapIndexAfterReorder(idx, shapeIndex, targetIndex)))))
    setSelectedShapeIndex((prev) => (prev === null ? prev : remapIndexAfterReorder(prev, shapeIndex, targetIndex)))
    setHoveredShapeIndex((prev) => (prev === null ? prev : remapIndexAfterReorder(prev, shapeIndex, targetIndex)))
    setRawHighlightCorner((prev) =>
      prev ? { ...prev, shapeIndex: remapIndexAfterReorder(prev.shapeIndex, shapeIndex, targetIndex) } : prev,
    )
  }

  const updateShapePoints = (shapeIndex: number, points: number[][], shouldPersist: boolean) => {
    const roundedPoints = roundPointsToInt(points)
    let nextDocForPersist: XAnyLabelFile | null = null
    setAnnotationDoc((prev) => {
      if (!prev) return prev
      const nextShapes = prev.shapes.map((shape, index) => (index === shapeIndex ? { ...shape, points: roundedPoints } : shape))
      const nextDoc = normalizeDocPointsToInt({ ...prev, shapes: nextShapes })
      if (shouldPersist) nextDocForPersist = nextDoc
      return nextDoc
    })
    if (shouldPersist && nextDocForPersist) persistAnnotation(nextDocForPersist)
  }

  const formatPosition = (point: number[] | undefined): string => {
    if (!point || point.length < 2) return "0,0"
    return `${Math.round(Number(point[0] ?? 0))},${Math.round(Number(point[1] ?? 0))}`
  }

  const renderPositionBox = (
    value: string,
    idx: number,
    shapeIndex: number,
    highlighted: boolean,
    onEnter?: () => void,
    onLeave?: () => void,
  ) => (
    <button
      type="button"
      key={`${shapeIndex}-pos-${idx}`}
      className={cn(
        "inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded border px-1 text-[11px]",
        highlighted
          ? "border-emerald-400 bg-emerald-500/15 text-foreground"
          : "border-border/70 bg-background text-muted-foreground",
      )}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {value}
    </button>
  )

  const clearCurrentImageShapes = () => {
    const nextDoc =
      activeImagePath && imageNaturalSize.width > 0 && imageNaturalSize.height > 0
        ? createXAnyLabelTemplate({
            imagePath: activeImagePath,
            imageWidth: imageNaturalSize.width,
            imageHeight: imageNaturalSize.height,
          })
        : null
    setAnnotationDoc(nextDoc)
    setSelectedShapeIndex(null)
    setHoveredShapeIndex(null)
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
  }

  const handleDeleteCurrentAnnotation = async () => {
    if (!activeImagePath) return
    const result = await deleteImageAnnotation(activeImagePath)
    if (result.errorMessage) {
      setError(`删除标注失败：${result.errorMessage}`)
      return
    }
    clearCurrentImageShapes()
  }

  const handleDownloadCurrentImage = async () => {
    const targetPath = activeImagePath || currentFile?.filePath || ""
    if (!targetPath) return
    const result = await downloadTaskImage(targetPath)
    if (result.errorMessage) {
      setError(`下载图片失败：${result.errorMessage}`)
    }
  }

  const handleDeleteCurrentImage = async () => {
    const targetPath = activeImagePath || currentFile?.filePath || ""
    if (!targetPath) return
    const result = await deleteTaskImage(targetPath)
    if (result.errorMessage) {
      setError(`删除图片失败：${result.errorMessage}`)
      return
    }
    clearCurrentImageShapes()
    await reloadTaskFiles()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleSelectToolClick()
        return
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return
      const targetIndex = selectedShapeIndex ?? hoveredShapeIndex
      if (targetIndex === null) return
      event.preventDefault()
      deleteShape(targetIndex)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleSelectToolClick, hoveredShapeIndex, selectedShapeIndex])

  useEffect(() => {
    if (!shapeDragAction) return
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const processDragFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const point = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      if (!point) return
      const dx = point.x - shapeDragAction.start.x
      const dy = point.y - shapeDragAction.start.y
      const original = shapeDragAction.originalPoints
      if (original.length < 4) return

      const xs = original.map((p) => p[0])
      const ys = original.map((p) => p[1])
      const minX0 = Math.min(...xs)
      const maxX0 = Math.max(...xs)
      const minY0 = Math.min(...ys)
      const maxY0 = Math.max(...ys)
      const minSize = 1

      let minX = minX0
      let maxX = maxX0
      let minY = minY0
      let maxY = maxY0

      if (shapeDragAction.kind === "move") {
        minX = minX0 + dx
        maxX = maxX0 + dx
        minY = minY0 + dy
        maxY = maxY0 + dy
      } else {
        if (shapeDragAction.handle === "nw" || shapeDragAction.handle === "sw") minX = minX0 + dx
        if (shapeDragAction.handle === "ne" || shapeDragAction.handle === "se") maxX = maxX0 + dx
        if (shapeDragAction.handle === "nw" || shapeDragAction.handle === "ne") minY = minY0 + dy
        if (shapeDragAction.handle === "sw" || shapeDragAction.handle === "se") maxY = maxY0 + dy
      }

      if (maxX - minX < minSize) {
        if (shapeDragAction.kind === "resize" && (shapeDragAction.handle === "nw" || shapeDragAction.handle === "sw")) {
          minX = maxX - minSize
        } else {
          maxX = minX + minSize
        }
      }
      if (maxY - minY < minSize) {
        if (shapeDragAction.kind === "resize" && (shapeDragAction.handle === "nw" || shapeDragAction.handle === "ne")) {
          minY = maxY - minSize
        } else {
          maxY = minY + minSize
        }
      }

      minX = Math.max(0, Math.min(imageNaturalSize.width - minSize, minX))
      maxX = Math.max(minX + minSize, Math.min(imageNaturalSize.width, maxX))
      minY = Math.max(0, Math.min(imageNaturalSize.height - minSize, minY))
      maxY = Math.max(minY + minSize, Math.min(imageNaturalSize.height, maxY))

      updateShapePoints(
        shapeDragAction.shapeIndex,
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
        ],
        false,
      )
    }

    const onMouseMove = (event: MouseEvent) => {
      latestPointer = { clientX: event.clientX, clientY: event.clientY }
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(processDragFrame)
      }
    }
    const onMouseUp = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      const doc = annotationDocRef.current
      if (!doc) {
        setShapeDragAction(null)
        return
      }
      persistAnnotation(doc)
      setShapeDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [shapeDragAction, imageNaturalSize.height, imageNaturalSize.width])

  useEffect(() => {
    if (!rotationDragAction) return
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const processRotateFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const pt = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      if (!pt) return
      const currentAngle = Math.atan2(pt.y - rotationDragAction.center.y, pt.x - rotationDragAction.center.x)
      const delta = currentAngle - rotationDragAction.startAngle
      const nextPoints = rotationDragAction.originalPoints.map((item) => {
        const rotated = rotatePoint({ x: item[0], y: item[1] }, rotationDragAction.center, delta)
        return [rotated.x, rotated.y]
      })
      updateShapePoints(rotationDragAction.shapeIndex, nextPoints, false)
    }

    const onMouseMove = (event: MouseEvent) => {
      latestPointer = { clientX: event.clientX, clientY: event.clientY }
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(processRotateFrame)
      }
    }
    const onMouseUp = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      const doc = annotationDocRef.current
      if (doc) persistAnnotation(doc)
      setRotationDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [rotationDragAction])

  useEffect(() => {
    if (!rotationTransformAction) return
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const processFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const pt = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      if (!pt) return

      if (rotationTransformAction.kind === "move") {
        const dx = pt.x - rotationTransformAction.start.x
        const dy = pt.y - rotationTransformAction.start.y
        const nextPoints = rotationTransformAction.originalPoints.map((item) => [item[0] + dx, item[1] + dy])
        updateShapePoints(rotationTransformAction.shapeIndex, nextPoints, false)
        return
      }

      const vector = {
        x: pt.x - rotationTransformAction.center.x,
        y: pt.y - rotationTransformAction.center.y,
      }
      const projU = vector.x * rotationTransformAction.axisU.x + vector.y * rotationTransformAction.axisU.y
      const projV = vector.x * rotationTransformAction.axisV.x + vector.y * rotationTransformAction.axisV.y
      const halfW = Math.max(0.5, Math.abs(projU))
      const halfH = Math.max(0.5, Math.abs(projV))
      const c = rotationTransformAction.center
      const u = rotationTransformAction.axisU
      const v = rotationTransformAction.axisV
      const nextPoints = [
        [c.x - u.x * halfW - v.x * halfH, c.y - u.y * halfW - v.y * halfH],
        [c.x + u.x * halfW - v.x * halfH, c.y + u.y * halfW - v.y * halfH],
        [c.x + u.x * halfW + v.x * halfH, c.y + u.y * halfW + v.y * halfH],
        [c.x - u.x * halfW + v.x * halfH, c.y - u.y * halfW + v.y * halfH],
      ]
      updateShapePoints(rotationTransformAction.shapeIndex, nextPoints, false)
    }

    const onMouseMove = (event: MouseEvent) => {
      latestPointer = { clientX: event.clientX, clientY: event.clientY }
      if (rafId === 0) rafId = window.requestAnimationFrame(processFrame)
    }
    const onMouseUp = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      const doc = annotationDocRef.current
      if (doc) persistAnnotation(doc)
      setRotationTransformAction(null)
      setRawHighlightCorner(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [rotationTransformAction])

  return (
    <div className="flex h-[calc(100vh-var(--ea-titlebar-height,36px))] min-h-0 w-full flex-col overflow-hidden">
      <TaskDetailHeader
        projectId={projectId}
        taskName={taskName}
        currentFileName={currentFileName}
        progressText={progressText}
        canGoPrev={currentIndex > 0}
        canGoNext={files.length > 0 && currentIndex < files.length - 1}
        onPrev={() => setCurrentIndex((v) => Math.max(0, v - 1))}
        onNext={() => setCurrentIndex((v) => Math.min(files.length - 1, v + 1))}
        onDownloadCurrentImage={() => {
          void handleDownloadCurrentImage()
        }}
        onDeleteCurrentAnnotation={() => {
          void handleDeleteCurrentAnnotation()
        }}
        onDeleteCurrentImage={() => {
          void handleDeleteCurrentImage()
        }}
      />

      <div className="relative min-h-0 flex-1 bg-background">
        <div className="flex h-full min-h-0">
          <TaskLeftSidebarLayer leftPanelMode={leftPanelMode} onPanelModeChange={setLeftPanelMode}>
            <TaskLeftPanelContent
              leftPanelMode={leftPanelMode}
              labelsTab={labelsTab}
              onLabelsTabChange={setLabelsTab}
              panelShapes={panelShapes}
              selectedShapeIndex={selectedShapeIndex}
              hoveredShapeIndex={hoveredShapeIndex}
              hiddenShapeIndexes={hiddenShapeIndexes}
              hiddenClassLabels={hiddenClassLabels}
              labelColorMap={labelColorMap}
              project={project}
              rawHighlightCorner={rawHighlightCorner}
              taskName={taskName}
              activeImagePath={activeImagePath}
              imageNaturalSize={imageNaturalSize}
              imageFileInfo={imageFileInfo}
              formatBytes={formatBytes}
              formatPosition={formatPosition}
              renderPositionBox={renderPositionBox}
              onSetHoveredShapeIndex={setHoveredShapeIndex}
              onSetSelectedShapeIndex={setSelectedShapeIndex}
              onDeleteShape={deleteShape}
              onToggleShapeVisibility={toggleShapeVisibility}
              onToggleClassVisibility={toggleClassVisibility}
              onReorderShapeLayer={reorderShapeLayer}
              onSetRawHighlightCorner={setRawHighlightCorner}
            />
          </TaskLeftSidebarLayer>

          <TaskCanvasLayer>
            {error ? <p className="text-sm text-destructive">读取失败：{error}</p> : null}
            {!error && files.length === 0 ? (
              <div className="flex h-full items-center justify-center border border-border/70 bg-background text-sm text-muted-foreground">
                当前任务暂无文件记录。
              </div>
            ) : (
              <div
                ref={stageRef}
                className="relative h-full overflow-hidden border border-border/70 bg-background"
                onWheel={handleImageWheel}
                onMouseDown={handleImageMouseDown}
                onMouseMove={handleImageMouseMove}
                onMouseUp={endImagePan}
                onMouseLeave={endImagePan}
                onDoubleClick={handleImageDoubleClick}
                onClick={handleStageClick}
              >
                {isImageLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">图片加载中...</div>
                ) : imageObjectUrl && !imageLoadError ? (
                  <div
                    className="flex h-full w-full items-center justify-center overflow-hidden"
                    style={{
                      cursor: canPanAndZoom
                        ? isPanning
                          ? "grabbing"
                          : "grab"
                        : canDrawRectangle
                          ? "crosshair"
                          : "default",
                    }}
                  >
                    <img
                      src={imageObjectUrl}
                      alt={currentFileName}
                      className="max-h-full max-w-full object-contain select-none"
                      style={{
                        transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale})`,
                        transformOrigin: "center center",
                      }}
                      onError={() => setImageLoadError(true)}
                      onLoad={(event) => {
                        const img = event.currentTarget
                        setImageNaturalSize({
                          width: img.naturalWidth || 0,
                          height: img.naturalHeight || 0,
                        })
                        if (stageRef.current) {
                          const rect = stageRef.current.getBoundingClientRect()
                          setStageSize({ width: rect.width, height: rect.height })
                        }
                      }}
                      draggable={false}
                    />
                    <div className="pointer-events-none absolute inset-0">
                      <svg className="absolute inset-0 h-full w-full overflow-visible">
                        {renderedRotationRects.map((item) => {
                          const polygonPoints = item.stagePoints.map((pt) => `${pt.x},${pt.y}`).join(" ")
                          const isSelected = selectedShapeIndex === item.index
                          const isHovered = hoveredShapeIndex === item.index
                          return (
                            <polygon
                              key={`rotation-${item.index}`}
                              points={polygonPoints}
                              fill={isSelected || isHovered ? `${item.color}33` : "transparent"}
                              stroke={item.color}
                              strokeWidth={2}
                              className={drawingLayerActive ? "pointer-events-none" : "pointer-events-auto"}
                              onMouseEnter={() => handleRectangleMouseEnter(item.index)}
                              onMouseLeave={() => handleRectangleMouseLeave(item.index)}
                              onMouseDown={(event) => {
                                if (drawingLayerActive || rightToolMode !== "select") return
                                if (event.button !== 0) return
                                event.preventDefault()
                                event.stopPropagation()
                                const geometry = getCurrentImageGeometry()
                                const rect = stageRef.current?.getBoundingClientRect()
                                if (!geometry || !rect) return
                                const point = stageToImageWithGeometry(
                                  { x: event.clientX - rect.left, y: event.clientY - rect.top },
                                  geometry,
                                )
                                if (!point) return
                                const currentDoc = annotationDocRef.current
                                const shape = currentDoc?.shapes[item.index]
                                if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
                                setRotationTransformAction({
                                  kind: "move",
                                  shapeIndex: item.index,
                                  start: point,
                                  originalPoints: shape.points.slice(0, 4).map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)]),
                                })
                                setSelectedShapeIndex(item.index)
                              }}
                              onClick={(event) => {
                                event.stopPropagation()
                                setSelectedShapeIndex(item.index)
                              }}
                            />
                          )
                        })}
                        {selectedRotationRect && !drawingLayerActive ? (
                          <>
                            <line
                              x1={selectedRotationRect.topMid.x}
                              y1={selectedRotationRect.topMid.y}
                              x2={selectedRotationRect.rotateHandle.x}
                              y2={selectedRotationRect.rotateHandle.y}
                              stroke={selectedRotationRect.color}
                              strokeWidth={2}
                            />
                            <circle
                              cx={selectedRotationRect.rotateHandle.x}
                              cy={selectedRotationRect.rotateHandle.y}
                              r={5}
                              fill={selectedRotationRect.color}
                              className="pointer-events-auto cursor-grab"
                              onMouseDown={(event) => {
                                if (event.button !== 0) return
                                event.preventDefault()
                                event.stopPropagation()
                                const geometry = getCurrentImageGeometry()
                                const rect = stageRef.current?.getBoundingClientRect()
                                if (!geometry || !rect || selectedShapeIndex === null) return
                                const currentDoc = annotationDocRef.current
                                if (!currentDoc) return
                                const point = stageToImageWithGeometry(
                                  { x: event.clientX - rect.left, y: event.clientY - rect.top },
                                  geometry,
                                )
                                if (!point) return
                                const shape = currentDoc.shapes[selectedShapeIndex]
                                if (!shape || shape.shape_type !== "rotation" || shape.points.length < 4) return
                                const originalPoints = shape.points.slice(0, 4).map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)])
                                const center = originalPoints.reduce(
                                  (acc, p) => ({ x: acc.x + p[0] / 4, y: acc.y + p[1] / 4 }),
                                  { x: 0, y: 0 },
                                )
                                const startAngle = Math.atan2(point.y - center.y, point.x - center.x)
                                setRotationDragAction({
                                  shapeIndex: selectedShapeIndex,
                                  center,
                                  startAngle,
                                  originalPoints,
                                })
                              }}
                            />
                            {selectedRotationRect.stagePoints.map((corner, cornerIndex) => (
                              <circle
                                key={`rotation-corner-${cornerIndex}`}
                                cx={corner.x}
                                cy={corner.y}
                                r={4.5}
                                fill={
                                  rawHighlightCorner?.shapeIndex === selectedRotationRect.index &&
                                  rawHighlightCorner.cornerIndex === cornerIndex
                                    ? "#34d399"
                                    : selectedRotationRect.color
                                }
                                className="pointer-events-auto cursor-nwse-resize"
                                onMouseEnter={() => setRawHighlightCorner({ shapeIndex: selectedRotationRect.index, cornerIndex })}
                                onMouseLeave={() =>
                                  setRawHighlightCorner((prev) =>
                                    prev?.shapeIndex === selectedRotationRect.index && prev.cornerIndex === cornerIndex ? null : prev,
                                  )
                                }
                                onMouseDown={(event) => {
                                  if (event.button !== 0) return
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
                                }}
                              />
                            ))}
                          </>
                        ) : null}
                      </svg>
                      {renderedRectangles.map((item) => (
                        <RectangleOverlayItem
                          key={item.index}
                          item={item}
                          drawingLayerActive={drawingLayerActive}
                          isSelected={selectedShapeIndex === item.index}
                          isHovered={hoveredShapeIndex === item.index}
                          onMouseEnter={handleRectangleMouseEnter}
                          onMouseLeave={handleRectangleMouseLeave}
                          onMouseDown={handleRectangleMouseDown}
                          onClick={handleRectangleClick}
                        />
                      ))}
                      {previewRect ? (
                        <div
                          className="absolute z-10 border-2 border-dashed"
                          style={{
                            left: previewRect.left,
                            top: previewRect.top,
                            width: previewRect.width,
                            height: previewRect.height,
                            borderColor: pendingRectColor,
                            borderLeftWidth: previewRect.clippedLeft ? 0 : 2,
                            borderTopWidth: previewRect.clippedTop ? 0 : 2,
                            borderRightWidth: previewRect.clippedRight ? 0 : 2,
                            borderBottomWidth: previewRect.clippedBottom ? 0 : 2,
                            backgroundColor: `${pendingRectColor}33`,
                          }}
                        />
                      ) : null}
                      {selectedRect && !drawingLayerActive
                        ? ([
                            { id: "nw" as const, x: selectedRect.left, y: selectedRect.top },
                            { id: "ne" as const, x: selectedRect.left + selectedRect.width, y: selectedRect.top },
                            { id: "se" as const, x: selectedRect.left + selectedRect.width, y: selectedRect.top + selectedRect.height },
                            { id: "sw" as const, x: selectedRect.left, y: selectedRect.top + selectedRect.height },
                          ]).map((handle) => (
                            <button
                              key={handle.id}
                              type="button"
                              className="pointer-events-auto absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-emerald-500"
                              style={{ left: handle.x, top: handle.y, cursor: `${handle.id}-resize` }}
                              onMouseDown={(event) => {
                                if (event.button !== 0 || !annotationDoc) return
                                event.preventDefault()
                                event.stopPropagation()
                                const geometry = getCurrentImageGeometry()
                                const rect = stageRef.current?.getBoundingClientRect()
                                if (!geometry || !rect || selectedShapeIndex === null) return
                                const point = stageToImageWithGeometry(
                                  { x: event.clientX - rect.left, y: event.clientY - rect.top },
                                  geometry,
                                )
                                if (!point) return
                                const shape = annotationDoc.shapes[selectedShapeIndex]
                                if (!shape || shape.shape_type !== "rectangle") return
                                setShapeDragAction({
                                  kind: "resize",
                                  handle: handle.id,
                                  shapeIndex: selectedShapeIndex,
                                  start: point,
                                  originalPoints: shape.points.map((p) => [p[0], p[1]]),
                                })
                              }}
                              aria-label={`调整矩形 ${handle.id}`}
                            />
                          ))
                        : null}
                    </div>
                    {drawingLayerActive ? (
                      <div
                        className="absolute inset-0 z-10 cursor-crosshair"
                        onMouseMove={handleDrawLayerMove}
                        onClick={handleDrawLayerClick}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    图片加载失败或不存在
                  </div>
                )}
              </div>
            )}

            <TaskToolPalette
              rightToolMode={rightToolMode}
              onSelectTool={handleSelectToolClick}
              onRectTool={handleRectToolClick}
              onRotRectTool={handleRotRectToolClick}
              onCircleTool={() => dispatchTool({ type: "setRightToolMode", mode: "circle" })}
              onPolygonTool={() => dispatchTool({ type: "setRightToolMode", mode: "polygon" })}
              onTextTool={() => dispatchTool({ type: "setRightToolMode", mode: "text" })}
            />
            <TaskRectLabelPicker
              rectPickerOpen={rectPickerOpen}
              drawShapeType={drawShapeType}
              rectPendingLabel={rectPendingLabel}
              annotationLabelOptions={annotationLabelOptions}
              onRectPendingLabelChange={setRectPendingLabel}
              onCancel={handleRectPickerCancel}
              onConfirm={handleRectPickerConfirm}
            />
            <TaskDrawHint
              rightToolMode={rightToolMode}
              drawShapeType={drawShapeType}
              rectDrawingEnabled={rectDrawingEnabled}
              rectFirstPoint={rectFirstPoint}
            />
          </TaskCanvasLayer>
        </div>
      </div>

    </div>
  )
}

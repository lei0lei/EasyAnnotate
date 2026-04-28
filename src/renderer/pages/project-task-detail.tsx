import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Eye,
  EyeOff,
  FileJson,
  MousePointer2,
  MoreHorizontal,
  PenLine,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
  Type,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"

type LeftPanelMode = "labels" | "attributes" | "raw"
type LabelsTab = "layers" | "classes"
type RightToolMode = "select" | "rect" | "circle" | "polygon" | "text"
type Point = { x: number; y: number }
type ResizeHandle = "nw" | "ne" | "se" | "sw"
type ShapeDragAction =
  | { kind: "move"; shapeIndex: number; start: Point; originalPoints: number[][] }
  | { kind: "resize"; shapeIndex: number; handle: ResizeHandle; start: Point; originalPoints: number[][] }

function fileNameFromPath(filePath: string): string {
  if (!filePath) return "未选择文件"
  const normalized = filePath.replace(/\\/g, "/")
  const segments = normalized.split("/")
  return segments[segments.length - 1] || "未选择文件"
}

function trimTrailingSlashes(input: string): string {
  return input.replace(/[\\/]+$/, "")
}

function dirnameOfFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx <= 0) return ""
  return normalized.slice(0, idx).replace(/\//g, "\\")
}

function sanitizeSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

function resolveTaskImagePath(project: ProjectItem | undefined, taskId: string | undefined, file: TaskFileItem | undefined): string {
  if (!file) return ""
  if (!project || !taskId) return file.filePath
  const baseRoot =
    project.storageType === "local" && project.localPath
      ? trimTrailingSlashes(project.localPath)
      : trimTrailingSlashes(dirnameOfFilePath(project.configFilePath))
  const fileName = fileNameFromPath(file.filePath)
  if (!baseRoot || !fileName) return file.filePath
  const subset = sanitizeSegment(file.subset || "default")
  return `${baseRoot}\\data\\tasks\\${sanitizeSegment(taskId)}\\${subset}\\${fileName}`
}

function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".bmp")) return "image/bmp"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  return "application/octet-stream"
}

function normalizeTagColor(input: string | undefined): string {
  if (!input) return "#f59e0b"
  const value = input.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  return "#f59e0b"
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function roundPointToInt(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function roundPointsToInt(points: number[][]): number[][] {
  return points.map((item) => [Math.round(Number(item[0] ?? 0)), Math.round(Number(item[1] ?? 0))])
}

function normalizeDocPointsToInt(doc: XAnyLabelFile): XAnyLabelFile {
  return {
    ...doc,
    shapes: doc.shapes.map((shape) => ({
      ...shape,
      points: roundPointsToInt(shape.points),
    })),
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
  const [rightToolMode, setRightToolMode] = useState<RightToolMode>("select")
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
  const [rectPickerOpen, setRectPickerOpen] = useState(false)
  const [rectPendingLabel, setRectPendingLabel] = useState("")
  const [rectDrawingEnabled, setRectDrawingEnabled] = useState(false)
  const [rectFirstPoint, setRectFirstPoint] = useState<Point | null>(null)
  const [rectHoverPoint, setRectHoverPoint] = useState<Point | null>(null)
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null)
  const [hoveredShapeIndex, setHoveredShapeIndex] = useState<number | null>(null)
  const [shapeDragAction, setShapeDragAction] = useState<ShapeDragAction | null>(null)
  const [hiddenShapeIndexes, setHiddenShapeIndexes] = useState<number[]>([])
  const [hiddenClassLabels, setHiddenClassLabels] = useState<string[]>([])
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
        objectUrl = URL.createObjectURL(new Blob([result.content], { type: guessMimeType(candidate) }))
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
    setRectFirstPoint(null)
    setRectHoverPoint(null)
    setSelectedShapeIndex(null)
    setRectDrawingEnabled(false)
    setRectPickerOpen(false)
    setAnnotationDoc(null)
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
    setLabelsTab("layers")
  }, [currentFile?.filePath])

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
    rightToolMode === "rect" &&
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
    return { left, top, width, height }
  }, [canDrawRectangle, rectFirstPoint, rectHoverPoint])

  const drawingLayerActive = canDrawRectangle
  const pendingRectColor = labelColorMap.get(rectPendingLabel) ?? "#f59e0b"

  const renderedRectangles = useMemo(() => {
    if (!annotationDoc) return []
    const hiddenSet = new Set(hiddenShapeIndexes)
    const hiddenClassSet = new Set(hiddenClassLabels)
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
        return {
          index,
          label: shape.label,
          color: labelColorMap.get(shape.label) ?? "#f59e0b",
          left,
          top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        }
      })
      .filter(
        (item): item is { index: number; label: string; color: string; left: number; top: number; width: number; height: number } =>
          !!item,
      )
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, labelColorMap])

  const selectedRect = selectedShapeIndex === null ? null : renderedRectangles.find((item) => item.index === selectedShapeIndex) ?? null
  const hoveredRect = hoveredShapeIndex === null ? null : renderedRectangles.find((item) => item.index === hoveredShapeIndex) ?? null

  const canPanAndZoom =
    rightToolMode === "select" && !!imageObjectUrl && !isImageLoading && !imageLoadError && !shapeDragAction

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
    setRectHoverPoint((prev) => (prev && prev.x === rounded.x && prev.y === rounded.y ? prev : rounded))
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
    setRightToolMode("rect")
    setRectPickerOpen(true)
    setRectFirstPoint(null)
    setRectHoverPoint(null)
    setSelectedShapeIndex(null)
    setRectDrawingEnabled(false)
  }

  const handleRectPickerConfirm = () => {
    if (!rectPendingLabel) return
    setRectPickerOpen(false)
    setRectDrawingEnabled(true)
    setRectFirstPoint(null)
    setRectHoverPoint(null)
  }

  const upsertRectByPoint = (point: Point) => {
    if (!canDrawRectangle) return
    if (!point) return
    if (!rectFirstPoint) {
      const roundedPoint = roundPointToInt(point)
      setRectFirstPoint(roundedPoint)
      setRectHoverPoint(roundedPoint)
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
      setRectFirstPoint(null)
      setRectHoverPoint(null)
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
          shape_type: "rectangle",
          flags: null,
          attributes: {},
          kie_linking: [],
        },
      ],
    }
    const normalizedDoc = normalizeDocPointsToInt(nextDoc)
    setAnnotationDoc(normalizedDoc)
    persistAnnotation(normalizedDoc)
    setRectFirstPoint(null)
    setRectHoverPoint(null)
  }

  const handleDrawLayerMove: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!drawingLayerActive || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const geometry = getCurrentImageGeometry()
    if (!geometry) return
    const pt = stageToImageWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    if (!pt) return
    const rounded = roundPointToInt(pt)
    setRectHoverPoint((prev) => (prev && prev.x === rounded.x && prev.y === rounded.y ? prev : rounded))
  }

  const handleDrawLayerClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!drawingLayerActive || !stageRef.current) return
    event.stopPropagation()
    const rect = stageRef.current.getBoundingClientRect()
    const geometry = getCurrentImageGeometry()
    if (!geometry) return
    const pt = stageToImageWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    if (!pt) return
    upsertRectByPoint(pt)
  }

  const handleStageClick: React.MouseEventHandler<HTMLDivElement> = () => {
    if (drawingLayerActive) return
    setSelectedShapeIndex(null)
    setHoveredShapeIndex(null)
  }

  const updateShapeLabel = (shapeIndex: number, label: string) => {
    if (!annotationDoc) return
    const nextShapes = annotationDoc.shapes.map((shape, index) => (index === shapeIndex ? { ...shape, label } : shape))
    const nextDoc = normalizeDocPointsToInt({ ...annotationDoc, shapes: nextShapes })
    setAnnotationDoc(nextDoc)
    persistAnnotation(nextDoc)
  }

  const deleteShape = (shapeIndex: number) => {
    if (!annotationDoc) return
    const nextShapes = annotationDoc.shapes.filter((_, index) => index !== shapeIndex)
    const nextDoc = normalizeDocPointsToInt({ ...annotationDoc, shapes: nextShapes })
    setAnnotationDoc(nextDoc)
    persistAnnotation(nextDoc)
    setHiddenShapeIndexes((prev) => prev.filter((idx) => idx !== shapeIndex).map((idx) => (idx > shapeIndex ? idx - 1 : idx)))
    setSelectedShapeIndex(null)
    setHoveredShapeIndex((prev) => (prev === shapeIndex ? null : prev !== null && prev > shapeIndex ? prev - 1 : prev))
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

  const updateRectanglePoints = (shapeIndex: number, points: number[][], shouldPersist: boolean) => {
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

  const renderPositionBox = (value: string, idx: number, shapeIndex: number) => (
    <div
      key={`${shapeIndex}-pos-${idx}`}
      className="inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded border border-border/70 bg-background px-1 text-[11px] text-muted-foreground"
    >
      {value}
    </div>
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
        setRightToolMode("select")
        setRectPickerOpen(false)
        setRectDrawingEnabled(false)
        setRectFirstPoint(null)
        setRectHoverPoint(null)
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
  }, [hoveredShapeIndex, selectedShapeIndex, annotationDoc])

  useEffect(() => {
    if (!shapeDragAction) return
    const onMouseMove = (event: MouseEvent) => {
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const point = stageToImageWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
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

      updateRectanglePoints(
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
    const onMouseUp = () => {
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
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [shapeDragAction, imageNaturalSize.height, imageNaturalSize.width])

  return (
    <div className="flex h-[calc(100vh-var(--ea-titlebar-height,36px))] min-h-0 w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/80 bg-background px-3 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="返回项目">
          <Link to={`/projects/${projectId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">任务：{taskName}</p>
          <p className="truncate text-xs text-muted-foreground">文件：{currentFileName}</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-sm">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            onClick={() => setCurrentIndex((v) => Math.max(0, v - 1))}
            disabled={currentIndex <= 0}
            aria-label="上一张"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[4rem] text-center text-xs tabular-nums text-muted-foreground">{progressText}</span>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            onClick={() => setCurrentIndex((v) => Math.min(files.length - 1, v + 1))}
            disabled={files.length === 0 || currentIndex >= files.length - 1}
            aria-label="下一张"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="图片操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-card p-1 text-sm text-card-foreground shadow-md"
              sideOffset={6}
              align="end"
            >
              <DropdownMenu.Item
                className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                onSelect={() => {
                  void handleDownloadCurrentImage()
                }}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                下载图片
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-destructive outline-hidden data-highlighted:bg-destructive/10"
                onSelect={() => {
                  void handleDeleteCurrentAnnotation()
                }}
              >
                <FileJson className="h-3.5 w-3.5" aria-hidden />
                删除标注
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-destructive outline-hidden data-highlighted:bg-destructive/10"
                onSelect={() => {
                  void handleDeleteCurrentImage()
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                删除图片
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="relative min-h-0 flex-1 bg-background">
        <div className="flex h-full min-h-0">
          <div className="flex w-12 flex-col items-center gap-2 border-r border-border/70 py-3">
            <button
              type="button"
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                leftPanelMode === "labels" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-label="显示 labels 面板"
              onClick={() => setLeftPanelMode("labels")}
            >
              <Tag className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                leftPanelMode === "attributes" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-label="显示 attributes 面板"
              onClick={() => setLeftPanelMode("attributes")}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                leftPanelMode === "raw" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              aria-label="显示 raw data 面板"
              onClick={() => setLeftPanelMode("raw")}
            >
              <FileJson className="h-4 w-4" />
            </button>
          </div>

          <div className="flex w-72 flex-col border-r border-border/70 px-3 py-2">
            {leftPanelMode === "raw" ? (
              <>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                  <div className="h-full space-y-2 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {annotationDoc?.shapes?.length ? (
                      annotationDoc.shapes.map((shape, index) => {
                        return (
                          <div
                            key={`${shape.label}-${index}`}
                            className={cn(
                              "rounded border p-2 transition-colors",
                              selectedShapeIndex === index
                                ? "border-emerald-400 bg-emerald-500/10"
                                : hoveredShapeIndex === index
                                  ? "border-emerald-300/80 bg-emerald-500/5"
                                  : "border-border/60 bg-muted/20",
                            )}
                            onMouseEnter={() => setHoveredShapeIndex(index)}
                            onMouseLeave={() => setHoveredShapeIndex((prev) => (prev === index ? null : prev))}
                            onClick={() => setSelectedShapeIndex(index)}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
                                <span className="truncate">{shape.label}</span>
                                <span className="text-muted-foreground">·</span>
                                <span className="truncate text-muted-foreground">{shape.shape_type}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                                  aria-label="删除标注"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    deleteShape(index)
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="flex gap-1">
                              {[0, 1, 2, 3].map((posIndex) =>
                                renderPositionBox(formatPosition(shape.points[posIndex]), posIndex, index),
                              )}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-xs text-muted-foreground">当前图片暂无标注。</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {leftPanelMode === "labels" ? (
                  <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
                    <div className="grid w-full grid-cols-2 rounded-md border border-border/70 bg-muted/40 p-0.5">
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded px-2 py-1 text-xs transition-colors",
                          labelsTab === "layers"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setLabelsTab("layers")}
                      >
                        layers
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded px-2 py-1 text-xs transition-colors",
                          labelsTab === "classes"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setLabelsTab("classes")}
                      >
                        classes
                      </button>
                    </div>
                    {labelsTab === "layers" ? (
                      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {annotationDoc?.shapes?.length ? (
                          annotationDoc.shapes.map((shape, index) => {
                            const isHidden = hiddenShapeIndexes.includes(index)
                            const isSelected = selectedShapeIndex === index
                            const isHovered = hoveredShapeIndex === index
                            const color = labelColorMap.get(shape.label) ?? "#f59e0b"
                            return (
                              <div
                                key={`layer-${index}`}
                                className={cn(
                                  "flex items-center gap-2 rounded border px-2 py-1.5 transition-colors",
                                  isSelected
                                    ? "border-emerald-400 bg-emerald-500/10"
                                    : isHovered
                                      ? "border-emerald-300/80 bg-emerald-500/5"
                                      : "border-border/60 bg-muted/20",
                                  isHidden && "opacity-55",
                                )}
                                onMouseEnter={() => setHoveredShapeIndex(index)}
                                onMouseLeave={() => setHoveredShapeIndex((prev) => (prev === index ? null : prev))}
                                onClick={() => {
                                  if (isHidden) return
                                  setSelectedShapeIndex(index)
                                }}
                              >
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{shape.label || "-"}</span>
                                <button
                                  type="button"
                                  className="inline-flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                                  aria-label={isHidden ? "显示标注" : "隐藏标注"}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    toggleShapeVisibility(index)
                                  }}
                                >
                                  {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                                  aria-label="删除标注"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    deleteShape(index)
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )
                          })
                        ) : (
                          <p className="text-xs text-muted-foreground">当前图片暂无标注。</p>
                        )}
                      </div>
                    ) : (
                      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {(project?.tags ?? []).length ? (
                          (project?.tags ?? []).map((tag) => {
                            const count = annotationDoc?.shapes.filter((shape) => shape.label === tag.name).length ?? 0
                            const classHidden = hiddenClassLabels.includes(tag.name)
                            return (
                              <div
                                key={`class-${tag.name}`}
                                className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5"
                              >
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: normalizeTagColor(tag.color) }} />
                                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{tag.name}</span>
                                <button
                                  type="button"
                                  className="inline-flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                                  aria-label={classHidden ? "显示该类标注" : "隐藏该类标注"}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    toggleClassVisibility(tag.name)
                                  }}
                                >
                                  {classHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                                <span className="text-[11px] text-muted-foreground">{count}</span>
                              </div>
                            )
                          })
                        ) : (
                          <p className="text-xs text-muted-foreground">当前项目暂无标签类别。</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
                    <p className="border-b border-border/70 pb-2 text-sm font-medium text-foreground">Attributes</p>
                    <div className="rounded border border-border/70 bg-background/70 p-2 text-xs text-muted-foreground">
                      <p className="truncate">
                        <span className="text-foreground">路径：</span>
                        {activeImagePath || "-"}
                      </p>
                      <p className="truncate">
                        <span className="text-foreground">项目：</span>
                        {project?.name || "-"}
                      </p>
                      <p className="truncate">
                        <span className="text-foreground">任务：</span>
                        {taskName || "-"}
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 rounded border border-border/70 bg-background/70 p-2 text-xs">
                      <div className="h-full space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <p className="text-muted-foreground">
                          <span className="text-foreground">尺寸：</span>
                          {imageNaturalSize.width > 0 && imageNaturalSize.height > 0
                            ? `${imageNaturalSize.width} x ${imageNaturalSize.height}`
                            : "-"}
                        </p>
                        <p className="text-muted-foreground">
                          <span className="text-foreground">通道：</span>
                          {imageFileInfo.channelCount > 0 ? imageFileInfo.channelCount : "-"}
                        </p>
                        <p className="text-muted-foreground">
                          <span className="text-foreground">格式：</span>
                          {imageFileInfo.format || "-"}
                        </p>
                        <p className="text-muted-foreground">
                          <span className="text-foreground">大小：</span>
                          {formatBytes(imageFileInfo.sizeBytes)}
                        </p>
                        <p className="text-muted-foreground">
                          <span className="text-foreground">存在：</span>
                          {imageFileInfo.exists ? "是" : "否"}
                        </p>
                        {imageFileInfo.errorMessage ? (
                          <p className="text-destructive">读取失败：{imageFileInfo.errorMessage}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="relative min-w-0 flex-1 bg-muted/15">
            {error ? <p className="text-sm text-destructive">读取失败：{error}</p> : null}
            {!error && files.length === 0 ? (
              <div className="flex h-full items-center justify-center border border-border/70 bg-background text-sm text-muted-foreground">
                当前任务暂无文件记录。
              </div>
            ) : (
              <div
                ref={stageRef}
                className="h-full border border-border/70 bg-background"
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
                      {renderedRectangles.map((item) => (
                        <button
                          key={item.index}
                          type="button"
                          className={cn(
                            drawingLayerActive ? "pointer-events-none" : "pointer-events-auto",
                            "absolute border-2",
                          )}
                          style={{
                            left: item.left,
                            top: item.top,
                            width: item.width,
                            height: item.height,
                            borderColor: item.color,
                            backgroundColor:
                              selectedShapeIndex === item.index || hoveredShapeIndex === item.index ? `${item.color}33` : "transparent",
                          }}
                          onMouseEnter={() => setHoveredShapeIndex(item.index)}
                          onMouseLeave={() => setHoveredShapeIndex((prev) => (prev === item.index ? null : prev))}
                          onMouseDown={(event) => {
                            if (rightToolMode !== "select" || drawingLayerActive) return
                            if (event.button !== 0) return
                            event.preventDefault()
                            event.stopPropagation()
                            const geometry = getCurrentImageGeometry()
                            const rect = stageRef.current?.getBoundingClientRect()
                            if (!geometry || !rect || !annotationDoc) return
                            const point = stageToImageWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
                            if (!point) return
                            const shape = annotationDoc.shapes[item.index]
                            if (!shape || shape.shape_type !== "rectangle") return
                            setShapeDragAction({
                              kind: "move",
                              shapeIndex: item.index,
                              start: point,
                              originalPoints: shape.points.map((p) => [p[0], p[1]]),
                            })
                            setSelectedShapeIndex(item.index)
                          }}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedShapeIndex(item.index)
                          }}
                          aria-label={`选择标注 ${item.label}`}
                        >
                          {selectedShapeIndex === item.index || hoveredShapeIndex === item.index ? (
                            <span
                              className="absolute -top-5 left-0 rounded px-1.5 py-0.5 text-[10px] leading-none text-white"
                              style={{ backgroundColor: item.color }}
                            >
                              {item.label}
                            </span>
                          ) : null}
                        </button>
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
                        className="absolute inset-0 z-20 cursor-crosshair"
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

            {selectedRect && selectedShapeIndex !== null ? (
              <div
                className="absolute z-20 flex items-center gap-2 rounded-md border border-border bg-background/95 px-2 py-1 shadow-md"
                style={{
                  left: Math.max(8, Math.min(selectedRect.left, (stageSize.width || 0) - 220)),
                  top: Math.max(8, selectedRect.top - 36),
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <select
                  className="h-7 rounded border border-border bg-background px-2 text-xs"
                  value={annotationDoc?.shapes[selectedShapeIndex]?.label ?? ""}
                  onChange={(event) => updateShapeLabel(selectedShapeIndex, event.target.value)}
                >
                  {annotationLabelOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded border border-destructive/30 px-2 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => deleteShape(selectedShapeIndex)}
                >
                  删除
                </button>
              </div>
            ) : null}

            <div className="absolute top-1/2 right-4 flex -translate-y-1/2 flex-col gap-2 rounded-md border border-border/70 bg-background/95 p-2 shadow-sm">
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md",
                  rightToolMode === "select"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-label="选中工具"
                onClick={() => {
                  setRightToolMode("select")
                  setRectPickerOpen(false)
                  setRectDrawingEnabled(false)
                  setRectFirstPoint(null)
                  setRectHoverPoint(null)
                }}
                title="选中工具（缩放/移动）"
              >
                <MousePointer2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md",
                  rightToolMode === "rect"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-label="矩形工具"
                onClick={handleRectToolClick}
              >
                <Square className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md",
                  rightToolMode === "circle"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-label="圆形工具"
                onClick={() => setRightToolMode("circle")}
              >
                <Circle className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md",
                  rightToolMode === "polygon"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-label="多边形工具"
                onClick={() => setRightToolMode("polygon")}
              >
                <PenLine className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md",
                  rightToolMode === "text"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-label="文本工具"
                onClick={() => setRightToolMode("text")}
              >
                <Type className="h-4 w-4" />
              </button>
            </div>
            {rectPickerOpen ? (
              <div className="absolute top-1/2 right-20 z-20 w-52 -translate-y-1/2 rounded-md border border-border bg-background/95 p-3 shadow-md">
                <p className="mb-2 text-xs text-muted-foreground">矩形标注标签</p>
                <select
                  className="h-8 w-full rounded border border-border bg-background px-2 text-sm"
                  value={rectPendingLabel}
                  onChange={(event) => setRectPendingLabel(event.target.value)}
                >
                  {annotationLabelOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="inline-flex h-7 items-center rounded border border-border px-2 text-xs hover:bg-accent"
                    onClick={() => {
                      setRectPickerOpen(false)
                      setRectDrawingEnabled(false)
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center rounded border border-emerald-500/40 px-2 text-xs text-emerald-600 hover:bg-emerald-500/10"
                    onClick={handleRectPickerConfirm}
                  >
                    OK
                  </button>
                </div>
              </div>
            ) : null}
            {rightToolMode === "rect" ? (
              <div className="absolute right-4 bottom-4 z-20 rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
                {rectDrawingEnabled ? (rectFirstPoint ? "矩形：已记录第一点，点击第二点完成" : "矩形：点击第一点开始绘制") : "矩形：请选择标签并点击 OK"}
              </div>
            ) : null}
          </div>
        </div>
      </div>

    </div>
  )
}

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
  RotateCw,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
  Type,
} from "lucide-react"
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"

type LeftPanelMode = "labels" | "attributes" | "raw"
type LabelsTab = "layers" | "classes"
type RightToolMode = "select" | "rect" | "rotRect" | "circle" | "polygon" | "text"
type Point = { x: number; y: number }
type ResizeHandle = "nw" | "ne" | "se" | "sw"
type ShapeDragAction =
  | { kind: "move"; shapeIndex: number; start: Point; originalPoints: number[][] }
  | { kind: "resize"; shapeIndex: number; handle: ResizeHandle; start: Point; originalPoints: number[][] }
type RenderedRectangle = {
  index: number
  label: string
  color: string
  left: number
  top: number
  width: number
  height: number
  clippedLeft: boolean
  clippedTop: boolean
  clippedRight: boolean
  clippedBottom: boolean
}
type RenderedRotationRect = {
  index: number
  label: string
  color: string
  imagePoints: [Point, Point, Point, Point]
  stagePoints: [Point, Point, Point, Point]
  centerImage: Point
  axisUImage: Point
  axisVImage: Point
  center: Point
  topMid: Point
  rotateHandle: Point
  boundLeft: number
  boundTop: number
  boundRight: number
  boundBottom: number
}
type RotationDragAction = {
  shapeIndex: number
  center: Point
  startAngle: number
  originalPoints: number[][]
}
type RotationTransformAction =
  | { kind: "move"; shapeIndex: number; start: Point; originalPoints: number[][] }
  | {
      kind: "resize"
      shapeIndex: number
      handle: ResizeHandle
      center: Point
      axisU: Point
      axisV: Point
    }

type RectangleOverlayItemProps = {
  item: RenderedRectangle
  drawingLayerActive: boolean
  isSelected: boolean
  isHovered: boolean
  onMouseEnter: (index: number) => void
  onMouseLeave: (index: number) => void
  onMouseDown: (index: number, event: React.MouseEvent<HTMLDivElement>) => void
  onClick: (index: number, event: React.MouseEvent<HTMLDivElement>) => void
}

const RectangleOverlayItem = memo(
  function RectangleOverlayItem({
    item,
    drawingLayerActive,
    isSelected,
    isHovered,
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    onClick,
  }: RectangleOverlayItemProps) {
    return (
      <div
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
          borderLeftWidth: item.clippedLeft ? 0 : 2,
          borderTopWidth: item.clippedTop ? 0 : 2,
          borderRightWidth: item.clippedRight ? 0 : 2,
          borderBottomWidth: item.clippedBottom ? 0 : 2,
          backgroundColor: isSelected || isHovered ? `${item.color}33` : "transparent",
        }}
        onMouseEnter={() => onMouseEnter(item.index)}
        onMouseLeave={() => onMouseLeave(item.index)}
        onMouseDown={(event) => onMouseDown(item.index, event)}
        onClick={(event) => onClick(item.index, event)}
        aria-label={`选择标注 ${item.label}`}
        role="button"
      >
      {null}
      </div>
    )
  },
  (prev, next) =>
    prev.onMouseEnter === next.onMouseEnter &&
    prev.onMouseLeave === next.onMouseLeave &&
    prev.onMouseDown === next.onMouseDown &&
    prev.onClick === next.onClick &&
    prev.drawingLayerActive === next.drawingLayerActive &&
    prev.isSelected === next.isSelected &&
    prev.isHovered === next.isHovered &&
    prev.item.index === next.item.index &&
    prev.item.label === next.item.label &&
    prev.item.color === next.item.color &&
    prev.item.left === next.item.left &&
    prev.item.top === next.item.top &&
    prev.item.width === next.item.width &&
    prev.item.height === next.item.height &&
    prev.item.clippedLeft === next.item.clippedLeft &&
    prev.item.clippedTop === next.item.clippedTop &&
    prev.item.clippedRight === next.item.clippedRight &&
    prev.item.clippedBottom === next.item.clippedBottom,
)

const TaskLeftSidebarLayer = memo(function TaskLeftSidebarLayer({
  leftPanelMode,
  onPanelModeChange,
  children,
}: {
  leftPanelMode: LeftPanelMode
  onPanelModeChange: (mode: LeftPanelMode) => void
  children: ReactNode
}) {
  return (
    <>
      <div className="flex w-12 flex-col items-center gap-2 border-r border-border/70 py-3">
        <button
          type="button"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            leftPanelMode === "labels" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          aria-label="显示 labels 面板"
          onClick={() => onPanelModeChange("labels")}
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
          onClick={() => onPanelModeChange("attributes")}
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
          onClick={() => onPanelModeChange("raw")}
        >
          <FileJson className="h-4 w-4" />
        </button>
      </div>
      <div className="flex w-72 flex-col border-r border-border/70 px-3 py-2">{children}</div>
    </>
  )
})

const TaskCanvasLayer = memo(function TaskCanvasLayer({ children }: { children: ReactNode }) {
  return <div className="relative min-w-0 flex-1 bg-muted/15">{children}</div>
})

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

function rotatePoint(point: Point, center: Point, radians: number): Point {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const tx = point.x - center.x
  const ty = point.y - center.y
  return {
    x: center.x + tx * cos - ty * sin,
    y: center.y + tx * sin + ty * cos,
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
  const [panelDoc, setPanelDoc] = useState<XAnyLabelFile | null>(null)
  const [rectPickerOpen, setRectPickerOpen] = useState(false)
  const [rectPendingLabel, setRectPendingLabel] = useState("")
  const [rectDrawingEnabled, setRectDrawingEnabled] = useState(false)
  const [rectFirstPoint, setRectFirstPoint] = useState<Point | null>(null)
  const [rectHoverPoint, setRectHoverPoint] = useState<Point | null>(null)
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null)
  const [hoveredShapeIndex, setHoveredShapeIndex] = useState<number | null>(null)
  const [shapeDragAction, setShapeDragAction] = useState<ShapeDragAction | null>(null)
  const [rotationDragAction, setRotationDragAction] = useState<RotationDragAction | null>(null)
  const [rotationTransformAction, setRotationTransformAction] = useState<RotationTransformAction | null>(null)
  const [hiddenShapeIndexes, setHiddenShapeIndexes] = useState<number[]>([])
  const [hiddenClassLabels, setHiddenClassLabels] = useState<string[]>([])
  const [drawShapeType, setDrawShapeType] = useState<"rectangle" | "rotation">("rectangle")
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
    setRectFirstPoint(null)
    setRectHoverPoint(null)
    setSelectedShapeIndex(null)
    setRectDrawingEnabled(false)
    setRectPickerOpen(false)
    setAnnotationDoc(null)
    setRotationDragAction(null)
    setRotationTransformAction(null)
    setRawHighlightCorner(null)
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
    setDrawShapeType("rectangle")
    setRectPickerOpen(true)
    setRectFirstPoint(null)
    setRectHoverPoint(null)
    setSelectedShapeIndex(null)
    setRectDrawingEnabled(false)
  }

  const handleRotRectToolClick = () => {
    setRightToolMode("rotRect")
    setDrawShapeType("rotation")
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
    setRectFirstPoint(null)
    setRectHoverPoint(null)
  }

  const handleDrawLayerMove: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!drawingLayerActive || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const geometry = getCurrentImageGeometry()
    if (!geometry) return
    const pt = stageToImageStrictWithGeometry({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
    if (!pt) {
      setRectHoverPoint(null)
      return
    }
    const rounded = roundPointToInt(pt)
    setRectHoverPoint((prev) => (prev && prev.x === rounded.x && prev.y === rounded.y ? prev : rounded))
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
    setRawHighlightCorner((prev) => {
      if (!prev) return prev
      if (prev.shapeIndex === shapeIndex) return null
      if (prev.shapeIndex > shapeIndex) return { ...prev, shapeIndex: prev.shapeIndex - 1 }
      return prev
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
    let targetIndex = shapeIndex
    if (mode === "forward") targetIndex = Math.min(total - 1, shapeIndex + 1)
    if (mode === "backward") targetIndex = Math.max(0, shapeIndex - 1)
    if (mode === "front") targetIndex = total - 1
    if (mode === "back") targetIndex = 0
    if (targetIndex === shapeIndex) return

    const remapIndex = (index: number): number => {
      if (shapeIndex < targetIndex) {
        if (index === shapeIndex) return targetIndex
        if (index > shapeIndex && index <= targetIndex) return index - 1
        return index
      }
      if (index === shapeIndex) return targetIndex
      if (index >= targetIndex && index < shapeIndex) return index + 1
      return index
    }

    let nextDocForPersist: XAnyLabelFile | null = null
    setAnnotationDoc((prev) => {
      if (!prev || !prev.shapes[shapeIndex]) return prev
      const nextShapes = [...prev.shapes]
      const [moved] = nextShapes.splice(shapeIndex, 1)
      nextShapes.splice(targetIndex, 0, moved)
      const nextDoc = normalizeDocPointsToInt({ ...prev, shapes: nextShapes })
      nextDocForPersist = nextDoc
      return nextDoc
    })
    if (nextDocForPersist) persistAnnotation(nextDocForPersist)

    setHiddenShapeIndexes((prev) => Array.from(new Set(prev.map((idx) => remapIndex(idx)))))
    setSelectedShapeIndex((prev) => (prev === null ? prev : remapIndex(prev)))
    setHoveredShapeIndex((prev) => (prev === null ? prev : remapIndex(prev)))
    setRawHighlightCorner((prev) => (prev ? { ...prev, shapeIndex: remapIndex(prev.shapeIndex) } : prev))
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
        setRightToolMode("select")
        setRectPickerOpen(false)
        setRectDrawingEnabled(false)
        setRectFirstPoint(null)
        setRectHoverPoint(null)
        setRotationDragAction(null)
        setRotationTransformAction(null)
        setRawHighlightCorner(null)
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
          <TaskLeftSidebarLayer leftPanelMode={leftPanelMode} onPanelModeChange={setLeftPanelMode}>
            {leftPanelMode === "raw" ? (
              <>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                  <div className="h-full space-y-2 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {panelShapes.length ? (
                      panelShapes.map((shape, index) => {
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
                                renderPositionBox(
                                  formatPosition(shape.points[posIndex]),
                                  posIndex,
                                  index,
                                  rawHighlightCorner?.shapeIndex === index && rawHighlightCorner.cornerIndex === posIndex,
                                  shape.shape_type === "rotation"
                                    ? () => setRawHighlightCorner({ shapeIndex: index, cornerIndex: posIndex })
                                    : undefined,
                                  shape.shape_type === "rotation"
                                    ? () =>
                                        setRawHighlightCorner((prev) =>
                                          prev?.shapeIndex === index && prev.cornerIndex === posIndex ? null : prev,
                                        )
                                    : undefined,
                                ),
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
                        {panelShapes.length ? (
                          panelShapes.map((shape, index) => {
                            const isHidden = hiddenShapeIndexes.includes(index)
                            const isSelected = selectedShapeIndex === index
                            const isHovered = hoveredShapeIndex === index
                            const color = labelColorMap.get(shape.label) ?? "#f59e0b"
                            const canBringForward = index < panelShapes.length - 1
                            const canSendBackward = index > 0
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
                                <DropdownMenu.Root>
                                  <DropdownMenu.Trigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                      aria-label="图层顺序菜单"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <MoreHorizontal className="h-3.5 w-3.5" />
                                    </button>
                                  </DropdownMenu.Trigger>
                                  <DropdownMenu.Portal>
                                    <DropdownMenu.Content
                                      className="z-50 min-w-[11rem] overflow-hidden rounded-md border border-border bg-card p-1 text-sm text-card-foreground shadow-md"
                                      sideOffset={6}
                                      align="end"
                                    >
                                      <DropdownMenu.Item
                                        disabled={!canBringForward}
                                        className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                                        onSelect={() => reorderShapeLayer(index, "forward")}
                                      >
                                        Bring Forward
                                      </DropdownMenu.Item>
                                      <DropdownMenu.Item
                                        disabled={!canSendBackward}
                                        className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                                        onSelect={() => reorderShapeLayer(index, "backward")}
                                      >
                                        Send Backward
                                      </DropdownMenu.Item>
                                      <DropdownMenu.Item
                                        disabled={!canBringForward}
                                        className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                                        onSelect={() => reorderShapeLayer(index, "front")}
                                      >
                                        Bring to Front
                                      </DropdownMenu.Item>
                                      <DropdownMenu.Item
                                        disabled={!canSendBackward}
                                        className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                                        onSelect={() => reorderShapeLayer(index, "back")}
                                      >
                                        Send to Back
                                      </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                  </DropdownMenu.Portal>
                                </DropdownMenu.Root>
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
                            const count = panelShapes.filter((shape) => shape.label === tag.name).length
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

            <div className="absolute top-1/2 right-4 z-50 flex -translate-y-1/2 flex-col gap-2 rounded-md border border-border/70 bg-background/95 p-2 shadow-sm">
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
                  setRotationDragAction(null)
                  setRotationTransformAction(null)
                  setRawHighlightCorner(null)
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
                  rightToolMode === "rotRect"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-label="旋转矩形工具"
                onClick={handleRotRectToolClick}
              >
                <RotateCw className="h-4 w-4" />
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
              <div className="absolute top-1/2 right-20 z-[60] w-52 -translate-y-1/2 rounded-md border border-border bg-background/95 p-3 shadow-md">
                <p className="mb-2 text-xs text-muted-foreground">
                  {drawShapeType === "rotation" ? "旋转矩形标注标签" : "矩形标注标签"}
                </p>
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
            {rightToolMode === "rect" || rightToolMode === "rotRect" ? (
              <div className="absolute right-4 bottom-4 z-50 rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
                {drawShapeType === "rotation"
                  ? rectDrawingEnabled
                    ? rectFirstPoint
                      ? "旋转矩形：已记录第一点，点击第二点完成"
                      : "旋转矩形：点击第一点开始绘制"
                    : "旋转矩形：请选择标签并点击 OK"
                  : rectDrawingEnabled
                    ? rectFirstPoint
                      ? "矩形：已记录第一点，点击第二点完成"
                      : "矩形：点击第一点开始绘制"
                    : "矩形：请选择标签并点击 OK"}
              </div>
            ) : null}
          </TaskCanvasLayer>
        </div>
      </div>

    </div>
  )
}

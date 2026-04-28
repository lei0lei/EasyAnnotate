import { readTasks } from "@/lib/project-tasks-storage"
import {
  deleteImageAnnotation,
  deleteTaskImage,
  downloadTaskImage,
  type ProjectItem,
  type TaskFileItem,
} from "@/lib/projects-api"
import { createXAnyLabelTemplate, type XAnyLabelFile } from "@/lib/xanylabeling-format"
import {
  RectangleOverlayItem,
  TaskCanvasLayer,
  TaskDetailHeader,
  TaskDrawHint,
  TaskLeftPanelContent,
  TaskLeftSidebarLayer,
  TaskRectLabelPicker,
  TaskToolPalette,
  buildImageGeometry,
  buildRenderedRectangles,
  buildRenderedRotationRects,
  fileNameFromPath,
  formatBytes,
  imageToStagePoint,
  normalizeTagColor,
  resolveTaskImagePath,
  stageToImagePoint,
  stageToImagePointStrict,
  useCanvasViewState,
  useDragSessions,
  useShapeManagement,
  useTaskBootstrap,
  useTaskCanvasInteractions,
  useTaskDataSync,
} from "@/pages/project-task-detail/index"
import type {
  ImageGeometry,
  LabelsTab,
  LeftPanelMode,
  Point,
  RightToolMode,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "@/pages/project-task-detail/index"
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

  const { reloadTaskFiles } = useTaskBootstrap({
    projectId,
    taskId,
    files,
    imagePathCandidates,
    currentFilePath: currentFile?.filePath ?? "",
    stageRef,
    panStartRef,
    clearToolTransientInteractions,
    dispatchTool,
    setProject,
    setError,
    setFiles,
    setCurrentIndex,
    setImageObjectUrl,
    setActiveImagePath,
    setIsImageLoading,
    setImageLoadError,
    setImageScale,
    setImageOffset,
    setIsPanning,
    setImageNaturalSize,
    setSelectedShapeIndex,
    setAnnotationDoc,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    setLabelsTab,
    setStageSize,
  })


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

  const { persistAnnotation } = useTaskDataSync({
    activeImagePath,
    imageNaturalSize,
    annotationDoc,
    shapeDragAction,
    annotationDocRef,
    setAnnotationDoc,
    setPanelDoc,
    setImageFileInfo,
  })

  const imageGeometry = useMemo(() => buildImageGeometry(imageNaturalSize, stageSize), [imageNaturalSize, stageSize])

  const getCurrentImageGeometry = () => {
    const stageRect = stageRef.current?.getBoundingClientRect()
    const stageW = stageRect?.width ?? stageSize.width
    const stageH = stageRect?.height ?? stageSize.height
    return buildImageGeometry(imageNaturalSize, { width: stageW, height: stageH })
  }

  const stageToImageWithGeometry = (stagePoint: Point, geometry: ImageGeometry): Point =>
    stageToImagePoint(stagePoint, geometry, { scale: imageScale, offset: imageOffset }, imageNaturalSize)

  const stageToImageStrictWithGeometry = (stagePoint: Point, geometry: ImageGeometry): Point | null =>
    stageToImagePointStrict(stagePoint, geometry, { scale: imageScale, offset: imageOffset }, imageNaturalSize)

  const imageToStage = (point: Point): Point | null => {
    if (!imageGeometry) return null
    return imageToStagePoint(point, imageGeometry, { scale: imageScale, offset: imageOffset })
  }

  const stageToImage = (stagePoint: Point): Point | null => {
    if (!imageGeometry) return null
    return stageToImagePoint(stagePoint, imageGeometry, { scale: imageScale, offset: imageOffset }, imageNaturalSize)
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
    return buildRenderedRectangles({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
      stageWidth: imageGeometry?.stageWidth ?? 0,
      stageHeight: imageGeometry?.stageHeight ?? 0,
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, labelColorMap])

  const renderedRotationRects = useMemo(() => {
    return buildRenderedRotationRects({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
    })
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

  const {
    handleRectangleMouseDown,
    handleRotationPolygonMouseDown,
    handleRotationHandleMouseDown,
    handleRotationCornerMouseDown,
    handleRectResizeMouseDown,
  } = useTaskCanvasInteractions({
    drawingLayerActive,
    rightToolMode,
    annotationDoc,
    selectedShapeIndex,
    selectedRotationRect,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    setSelectedShapeIndex,
    setShapeDragAction,
    setRotationTransformAction,
    setRotationDragAction,
  })

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

  const {
    canPanAndZoom,
    handleImageWheel,
    handleImageMouseDown,
    handleImageMouseMove,
    handleImageDoubleClick,
    endImagePan,
    handleDrawLayerMove,
    handleDrawLayerClick,
    handleStageClick,
  } = useCanvasViewState({
    rightToolMode,
    imageObjectUrl,
    isImageLoading,
    imageLoadError,
    shapeDragAction,
    rotationDragAction,
    rotationTransformAction,
    drawingLayerActive,
    canDrawRectangle,
    isPanning,
    setIsPanning,
    panStartRef,
    imageOffset,
    setImageOffset,
    setImageScale,
    stageRef,
    stageToImage,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    rectHoverPoint,
    dispatchTool,
    rectFirstPoint,
    annotationDoc,
    activeImagePath,
    imageNaturalSize,
    rectPendingLabel,
    drawShapeType,
    setAnnotationDoc,
    persistAnnotation,
    setSelectedShapeIndex,
    setHoveredShapeIndex,
    setRawHighlightCorner,
  })

  const { deleteShape, toggleShapeVisibility, toggleClassVisibility, reorderShapeLayer, updateShapePoints, formatPosition, renderPositionBox } =
    useShapeManagement({
      annotationDoc,
      selectedShapeIndex,
      hoveredShapeIndex,
      setAnnotationDoc,
      persistAnnotation,
      setHiddenShapeIndexes,
      setSelectedShapeIndex,
      setHoveredShapeIndex,
      setRawHighlightCorner,
      setHiddenClassLabels,
    })

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

  useDragSessions({
    shapeDragAction,
    rotationDragAction,
    rotationTransformAction,
    imageNaturalSize,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    updateShapePoints,
    persistAnnotation,
    setShapeDragAction,
    setRotationDragAction,
    setRotationTransformAction,
    setRawHighlightCorner,
  })

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
                              onMouseDown={(event) => handleRotationPolygonMouseDown(item.index, event)}
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
                              onMouseDown={handleRotationHandleMouseDown}
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
                                onMouseDown={(event) => handleRotationCornerMouseDown(cornerIndex, event)}
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
                              onMouseDown={(event) => handleRectResizeMouseDown(handle.id, event)}
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

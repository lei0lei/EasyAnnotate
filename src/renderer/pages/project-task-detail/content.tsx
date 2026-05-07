/**
 * 模块：project-task-detail/content
 * 职责：任务详情页主容器，聚合状态与 hooks，并编排 Header/Sidebar/Canvas。
 * 边界：负责页面级流程编排，不承载底层绘制算法。
 */
import {
  type ProjectItem,
  type TaskFileItem,
} from "@/lib/projects-api"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { formatBytes } from "@/pages/project-task-detail/utils"
import { findShapeIndexByStableId } from "@/pages/project-task-detail/shape-identity"
import { useDragSessions } from "@/pages/project-task-detail/use-drag-sessions"
import { useTaskCanvasEngine } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { DragStageNudge } from "@/pages/project-task-detail/page-sections"
import type { DragLiveMaskRleOverride, DragLivePointsOverride, DragVertexLiveOverride } from "@/pages/project-task-detail/rendered-shapes"
import { useTaskRenderModel } from "@/pages/project-task-detail/use-task-render-model"
import { useMaskTool } from "@/pages/project-task-detail/annotateTools/use-mask-tool"
import { useBox3dTool } from "@/pages/project-task-detail/annotateTools/use-box3d-tool"
import { useKeypointTool } from "@/pages/project-task-detail/annotateTools/use-keypoint-tool"
import { useSkeletonTool } from "@/pages/project-task-detail/annotateTools/use-skeleton-tool"
import { usePolygonTool } from "@/pages/project-task-detail/annotateTools/use-polygon-tool"
import { useRectRotTool } from "@/pages/project-task-detail/annotateTools/use-rect-rot-tool"
import { useTaskBootstrap } from "@/pages/project-task-detail/use-task-bootstrap"
import { useTaskCanvasState } from "@/pages/project-task-detail/use-task-canvas-state"
import { useTaskFileActions } from "@/pages/project-task-detail/use-task-file-actions"
import { useTaskAnnotationState, type TaskAnnotationStore } from "@/pages/project-task-detail/use-task-annotation-state"
import { useTaskDragState } from "@/pages/project-task-detail/use-task-drag-state"
import { useTaskDerivedState } from "@/pages/project-task-detail/use-task-derived-state"
import { useTaskSidebarViewModel } from "@/pages/project-task-detail/use-task-sidebar-view-model"
import { useTaskShortcuts } from "@/pages/project-task-detail/use-task-shortcuts"
import { useToolWorkflowBindings } from "@/pages/project-task-detail/use-tool-workflow-bindings"
import { useCanvasSectionProps } from "@/pages/project-task-detail/use-canvas-section-props"
import { useTaskCanvasContainerProps } from "@/pages/project-task-detail/use-task-canvas-container-props"
import { useTaskSidebarProps } from "@/pages/project-task-detail/use-task-layout-props"
import { useTaskDomainController } from "@/pages/project-task-detail/use-task-domain-controller"
import { useTaskAnnotationLoader } from "@/pages/project-task-detail/use-task-annotation-loader"
import { useTaskCanvasGeometryState } from "@/pages/project-task-detail/use-task-canvas-geometry-state"
import { usePersistAfterDrag } from "@/pages/project-task-detail/use-persist-after-drag"
import { useTaskSessionController } from "@/pages/project-task-detail/use-task-session-controller"
import { useTaskSessionState } from "@/pages/project-task-detail/use-task-session-state"
import { AnnotationStoreProvider } from "@/pages/project-task-detail/annotation-store-context"
import { TaskHeaderContainer } from "@/pages/project-task-detail/header-container"
import { TaskSidebarContainer } from "@/pages/project-task-detail/sidebar-container"
import { TaskCanvasContainer } from "@/pages/project-task-detail/canvas-container"
import { rightToolModeToDrawingPreset } from "@/pages/project-task-detail/drawing-tool-preset"
import type { LabelsTab, LeftPanelMode, RightToolMode } from "@/pages/project-task-detail/types"
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react"

export type ProjectTaskDetailContentProps = {
  projectId: string | undefined
  taskId: string | undefined
}

export function ProjectTaskDetailContent({ projectId, taskId }: ProjectTaskDetailContentProps) {
  const annotationStore = useTaskAnnotationState()
  return (
    <AnnotationStoreProvider value={annotationStore}>
      <ProjectTaskDetailContentBody projectId={projectId} taskId={taskId} annotationStore={annotationStore} />
    </AnnotationStoreProvider>
  )
}

type ProjectTaskDetailContentBodyProps = ProjectTaskDetailContentProps & {
  annotationStore: TaskAnnotationStore
}

function ProjectTaskDetailContentBody({ projectId, taskId, annotationStore }: ProjectTaskDetailContentBodyProps) {
  const [files, setFiles] = useState<TaskFileItem[]>([])
  const [project, setProject] = useState<ProjectItem | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>("labels")
  const [labelsTab, setLabelsTab] = useState<LabelsTab>("layers")
  const {
    imageObjectUrl,
    setImageObjectUrl,
    activeImagePath,
    setActiveImagePath,
    isImageLoading,
    setIsImageLoading,
    imageLoadError,
    setImageLoadError,
    imageScale,
    setImageScale,
    imageOffset,
    setImageOffset,
    isPanning,
    setIsPanning,
    imageNaturalSize,
    setImageNaturalSize,
    stageSize,
    setStageSize,
    imageFileInfo,
    setImageFileInfo,
    stageRef,
    panStartRef,
  } = useTaskCanvasState()
  const {
    annotationDoc,
    panelDoc,
    history,
    setAnnotationDoc,
    setPanelDoc,
    selectedShapeIndex,
    setSelectedShapeIndex,
    selectedShapeId,
    setSelectedShapeId,
    hoveredShapeIndex,
    setHoveredShapeIndex,
    hoveredShapeId,
    setHoveredShapeId,
    hiddenShapeIndexes,
    hiddenClassLabels,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    rawHighlightCorner,
    setRawHighlightCorner,
    setHistory,
    annotationDocRef,
  } = annotationStore
  const resetDocForNewFileRef = useRef<() => void>(() => {})
  const handleResetDocForNewFile = useCallback(() => {
    resetDocForNewFileRef.current()
  }, [])
  const {
    shapeDragAction,
    setShapeDragAction,
    polygonDragAction,
    setPolygonDragAction,
    polygonVertexDragAction,
    setPolygonVertexDragAction,
    rotationDragAction,
    setRotationDragAction,
    rotationTransformAction,
    setRotationTransformAction,
  } = useTaskDragState()
  const [dragLivePoints, setDragLivePoints] = useState<DragLivePointsOverride | null>(null)
  const [dragCuboidLivePoints, setDragCuboidLivePoints] = useState<DragLivePointsOverride | null>(null)
  const [dragVertexLive, setDragVertexLive] = useState<DragVertexLiveOverride | null>(null)
  const [dragLiveMaskRle, setDragLiveMaskRle] = useState<DragLiveMaskRleOverride | null>(null)
  const [dragStageNudge, setDragStageNudge] = useState<DragStageNudge | null>(null)
  const dragSession = useMemo(
    () => ({
      shapeDragAction,
      polygonDragAction,
      polygonVertexDragAction,
      rotationDragAction,
      rotationTransformAction,
      setShapeDragAction,
      setPolygonDragAction,
      setPolygonVertexDragAction,
      setRotationDragAction,
      setRotationTransformAction,
    }),
    [
      polygonDragAction,
      polygonVertexDragAction,
      rotationDragAction,
      rotationTransformAction,
      setPolygonDragAction,
      setPolygonVertexDragAction,
      setRotationDragAction,
      setRotationTransformAction,
      setShapeDragAction,
      shapeDragAction,
    ],
  )
  const clearToolTransientInteractions = useCallback(() => {
    setPolygonDragAction(null)
    setPolygonVertexDragAction(null)
    setRotationDragAction(null)
    setRotationTransformAction(null)
    setRawHighlightCorner(null)
    setDragVertexLive(null)
  }, [])
  const {
    taskName,
    currentFile,
    currentFileName,
    progressText,
    imagePathCandidates,
    annotationLabelOptionsPlain,
    annotationLabelOptionsSkeleton,
    labelColorMap,
  } = useTaskDerivedState({
    projectId,
    taskId,
    project,
    files,
    currentIndex,
  })
  const fallbackFileId = currentFile?.filePath ?? ""
  const taskSessionState = useTaskSessionState({
    activeImagePath,
    fallbackFileId,
    annotationDoc,
    panelDoc,
  })

  const {
    dispatchTool,
    rightToolMode,
    drawShapeType,
    rectFirstPoint,
    rectHoverPoint,
    polygonDraftPoints,
    polygonHoverPoint,
    toolWorkflowPhase,
    rectPickerOpen,
    rectDrawingEnabled,
    rectDrawShapeType,
    handleSelectToolClick,
    handleRectPickerConfirm: handleRectPickerConfirmFromBindings,
    handleRectPickerCancel,
    handleStartMaskTool,
    handleStartKeypointTool,
    handleStartBox3dTool,
    handleStartSkeletonTool,
    rectPendingLabel,
    setRectPendingLabel,
    maskDrawingSessionLabel,
    startDrawingWithPreset,
  } = useToolWorkflowBindings({
    annotationLabelOptionsPlain,
    annotationLabelOptionsSkeleton,
    clearToolTransientInteractions,
  })

  const toolbarAnnotationPrimingPendingRef = useRef(false)
  const lastDrawingToolRef = useRef<RightToolMode>("rect")
  const lastAnnotationLabelRef = useRef("")
  const [annotationHabitPrimed, setAnnotationHabitPrimed] = useState(false)

  useEffect(() => {
    toolbarAnnotationPrimingPendingRef.current = false
    setAnnotationHabitPrimed(false)
    lastAnnotationLabelRef.current = ""
    lastDrawingToolRef.current = "rect"
  }, [projectId, taskId])

  const handleRectPickerConfirmWrapped = useCallback(() => {
    if (toolbarAnnotationPrimingPendingRef.current) {
      toolbarAnnotationPrimingPendingRef.current = false
      setAnnotationHabitPrimed(true)
      lastDrawingToolRef.current = rightToolMode
      lastAnnotationLabelRef.current = rectPendingLabel.trim()
    }
    handleRectPickerConfirmFromBindings()
  }, [handleRectPickerConfirmFromBindings, rectPendingLabel, rightToolMode])

  const handleRectPickerCancelWrapped = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = false
    handleRectPickerCancel()
  }, [handleRectPickerCancel])

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
    resetDocForNewFile: handleResetDocForNewFile,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    setLabelsTab,
    setStageSize,
  })

  const {
    deleteShape,
    toggleShapeVisibility,
    toggleClassVisibility,
    reorderShapeLayer,
    applyShapePatch,
    applyMaskRlePatch,
    createShape,
    replaceDoc,
    resetDoc,
    persistIfDirty,
    undo,
    redo,
    canUndo,
    canRedo,
    clearSelectedShape,
    handleEngineShapeCreated,
    handleEngineViewportChanged,
  } = useTaskDomainController({
    activeImagePath,
    annotationDoc,
    selectedShapeIndex,
    hoveredShapeIndex,
    hiddenShapeIndexes,
    hiddenClassLabels,
    history,
    shapeDragAction,
    annotationDocRef,
    setAnnotationDoc,
    setHiddenShapeIndexes,
    setSelectedShapeIndex,
    setSelectedShapeId,
    setHoveredShapeIndex,
    setRawHighlightCorner,
    setPanelDoc,
    setHiddenClassLabels,
    setHistory,
    setImageFileInfo,
  })
  resetDocForNewFileRef.current = resetDoc
  const replaceDocRef = useRef(replaceDoc)
  useEffect(() => {
    replaceDocRef.current = replaceDoc
  }, [replaceDoc])
  const handleLoadedDocReplace = useCallback(
    (nextDoc: XAnyLabelFile | null, options?: { resetHistory?: boolean; clearVisibility?: boolean }) => {
      replaceDocRef.current(nextDoc, options)
    },
    [],
  )

  useTaskAnnotationLoader({
    currentFileId: taskSessionState.currentFileId,
    imageNaturalSize,
    replaceDoc: handleLoadedDocReplace,
  })

  const {
    imageGeometry,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    stageToImageStrictWithGeometry,
    imageToStageBase,
  } = useTaskCanvasGeometryState({
      imageNaturalSize,
      stageSize,
      stageRef,
      imageScale,
      imageOffset,
      imageObjectUrl,
      isImageLoading,
      imageLoadError,
      setImageOffset,
      setImageScale,
      setIsPanning,
      panStartRef,
    })

  /** 与 base 坐标系下的标注层一致，供 drag nudge 使用（外层 CSS scale 会映射到屏幕） */
  const projectImageDeltaToStage = useCallback(
    (dix: number, diy: number) => {
      const p0 = imageToStageBase({ x: 0, y: 0 })
      const p1 = imageToStageBase({ x: dix, y: diy })
      if (!p0 || !p1) return { dx: 0, dy: 0 }
      return { dx: p1.x - p0.x, dy: p1.y - p0.y }
    },
    [imageToStageBase],
  )

  const {
    canDrawRectangle,
    previewRect,
    handleStartRectTool,
    handleStartRotRectTool,
    handleRectDrawMove,
    handleRectDrawClick,
  } = useRectRotTool({
    rightToolMode,
    rectDrawingEnabled,
    imageGeometry,
    activeImagePath,
    isImageLoading,
    imageLoadError,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStage: imageToStageBase,
    rectFirstPoint,
    rectHoverPoint,
    drawShapeType: rectDrawShapeType,
    dispatchTool,
    createShape,
    activeImageSize: imageNaturalSize,
    rectPendingLabel,
    onShapeCreated: handleEngineShapeCreated,
    onCommittedExitToSelect: handleSelectToolClick,
  })

  const {
    canDrawPolygon,
    polygonDraftStagePoints,
    hoveredDraftVertexIndex,
    handleStartPolygonTool,
    handlePolygonDrawMove,
    handlePolygonDrawClick,
    handlePolygonDrawDoubleClick,
    clearPolygonDraft,
    popPolygonPoint,
    polygonDraftPointCount,
  } = usePolygonTool({
    rightToolMode,
    rectDrawingEnabled,
    imageGeometry,
    activeImagePath,
    isImageLoading,
    imageLoadError,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStage: imageToStageBase,
    imageScale,
    polygonDraftPoints,
    polygonHoverPoint,
    dispatchTool,
    imageNaturalSize,
    rectPendingLabel,
    createShape,
    onShapeCreated: handleEngineShapeCreated,
    onCommittedExitToSelect: handleSelectToolClick,
  })

  const {
    maskDrawMode,
    setMaskDrawMode,
    maskBrushSize,
    setMaskBrushSize,
    canDrawMask,
    maskDraftStagePoints,
    maskCursorStagePoint,
    hasMaskDraft,
    createMaskDraft,
    appendMaskDraftPoint,
    commitMaskStroke,
    clearMaskTransientState,
  } = useMaskTool({
    rightToolMode,
    rectDrawingEnabled,
    imageGeometry,
    activeImagePath,
    isImageLoading,
    imageLoadError,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStage: imageToStageBase,
    annotationDoc,
    applyMaskRlePatch,
    createShape,
    deleteShape,
    selectedShapeIndex,
    setSelectedShapeIndex,
    imageNaturalSize,
    rectPendingLabel,
    maskSessionLabel: (maskDrawingSessionLabel ?? "").trim() || rectPendingLabel.trim(),
    onShapeCreated: handleEngineShapeCreated,
  })

  const {
    canDrawBox3d,
    box3dAwaitingSecondClick,
    handleBox3dDrawMove,
    handleBox3dDrawClick,
    box3dDraftBaseStagePoints,
    box3dPreviewTopStagePoints,
    clearBox3dDraft,
  } = useBox3dTool({
    rightToolMode,
    rectDrawingEnabled,
    imageGeometry,
    activeImagePath,
    isImageLoading,
    imageLoadError,
    imageNaturalSize,
    rectPendingLabel,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStage: imageToStageBase,
    createShape,
    onShapeCreated: handleEngineShapeCreated,
    onDefaultCuboidPlaced: (shapeId) => setSelectedShapeId(shapeId),
    onCuboidCommitted: handleSelectToolClick,
  })

  const { canDrawKeypoint, handleKeypointDrawClick } = useKeypointTool({
    rightToolMode,
    rectDrawingEnabled,
    imageGeometry,
    activeImagePath,
    isImageLoading,
    imageLoadError,
    imageNaturalSize,
    rectPendingLabel,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    createShape,
    onShapeCreated: handleEngineShapeCreated,
    onKeypointCommitted: handleSelectToolClick,
  })

  const { canDrawSkeleton, handleSkeletonDrawClick } = useSkeletonTool({
    rightToolMode,
    rectDrawingEnabled,
    imageGeometry,
    activeImagePath,
    isImageLoading,
    imageLoadError,
    imageNaturalSize,
    rectPendingLabel,
    projectTags: project?.tags,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    createShape,
    onShapeCreated: handleEngineShapeCreated,
    onSkeletonCommitted: handleSelectToolClick,
  })

  const handleStartRectToolFromToolbar = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = true
    handleStartRectTool()
  }, [handleStartRectTool])

  const handleStartRotRectToolFromToolbar = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = true
    handleStartRotRectTool()
  }, [handleStartRotRectTool])

  const handleStartPolygonToolFromToolbar = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = true
    handleStartPolygonTool()
  }, [handleStartPolygonTool])

  const handleStartMaskToolFromToolbar = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = true
    handleStartMaskTool()
  }, [handleStartMaskTool])

  const handleStartKeypointToolFromToolbar = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = true
    handleStartKeypointTool()
  }, [handleStartKeypointTool])

  const handleStartBox3dToolFromToolbar = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = true
    handleStartBox3dTool()
  }, [handleStartBox3dTool])

  const handleStartSkeletonToolFromToolbar = useCallback(() => {
    toolbarAnnotationPrimingPendingRef.current = true
    handleStartSkeletonTool()
  }, [handleStartSkeletonTool])

  const repeatNewAnnotation = useCallback(() => {
    if (!annotationHabitPrimed) return
    const presetBase = rightToolModeToDrawingPreset(lastDrawingToolRef.current)
    if (!presetBase) return
    let label = lastAnnotationLabelRef.current
    const allowed =
      lastDrawingToolRef.current === "skeleton" ? annotationLabelOptionsSkeleton : annotationLabelOptionsPlain
    if (!allowed.includes(label)) {
      label = allowed[0] ?? ""
    }
    if (!label.trim()) return
    clearMaskTransientState()
    clearBox3dDraft()
    clearPolygonDraft()
    clearSelectedShape()
    handleSelectToolClick()
    startDrawingWithPreset({ ...presetBase, label })
  }, [
    annotationHabitPrimed,
    annotationLabelOptionsPlain,
    annotationLabelOptionsSkeleton,
    clearBox3dDraft,
    clearMaskTransientState,
    clearPolygonDraft,
    clearSelectedShape,
    handleSelectToolClick,
    startDrawingWithPreset,
  ])

  const drawingLayerActive =
    toolWorkflowPhase ===
      "drawing" && (canDrawRectangle || canDrawPolygon || canDrawMask || canDrawKeypoint || canDrawBox3d || canDrawSkeleton)
  /** 标签弹窗与当前 drawShapeType 一致：骨架仅骨架类，其余工具仅普通类 */
  const taskRectPickerLabelOptions = useMemo(
    () => (drawShapeType === "skeleton" ? annotationLabelOptionsSkeleton : annotationLabelOptionsPlain),
    [annotationLabelOptionsPlain, annotationLabelOptionsSkeleton, drawShapeType],
  )
  const pendingRectColor = labelColorMap.get((maskDrawingSessionLabel ?? "").trim() || rectPendingLabel) ?? "#f59e0b"
  const resolveShapeIndexById = useCallback(
    (shapeId: string | null) => findShapeIndexByStableId(annotationDocRef.current, shapeId),
    [annotationDocRef],
  )

  const {
    renderedRectangles,
    renderedRotationRects,
    renderedPolygons,
    renderedMasks,
    renderedCuboids2d,
    renderedPoints,
    renderedSkeletons,
    selectedRect,
    selectedRotationRect,
    selectedPolygon,
    selectedCuboid2d,
  } = useTaskRenderModel({
      annotationDoc: taskSessionState.currentDoc,
      panelDoc: taskSessionState.currentPanelDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      selectedShapeId,
      labelColorMap,
      projectTags: project?.tags,
      imageGeometry,
      imageToStageBase,
      dragLivePoints,
      dragCuboidLivePoints,
      dragVertexLive,
      dragLiveMaskRle,
    })

  const {
    canPanAndZoom,
    handleImageWheel,
    handleImageMouseDown,
    handleImageMouseMove,
    handleImageDoubleClick,
    endImagePan,
    handleStageClick,
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
    handleRectangleMouseEnter,
    handleRectangleMouseLeave,
    handleRectangleClick,
  } = useTaskCanvasEngine({
    drawingLayerActive,
    rightToolMode,
    annotationDoc,
    selectedShapeId,
    resolveShapeIndexById,
    selectedRotationRect,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    dragSession,
    imageObjectUrl,
    isImageLoading,
    imageLoadError,
    isPanning,
    setIsPanning,
    panStartRef,
    imageOffset,
    imageScale,
    setImageOffset,
    setImageScale,
    setRawHighlightCorner,
    onSelectionChanged: setSelectedShapeId,
    onHoveredShapeChanged: setHoveredShapeId,
    onViewportChanged: handleEngineViewportChanged,
  })
  const { handleDeleteCurrentAnnotation, handleDownloadCurrentImage, handleDeleteCurrentImage } = useTaskFileActions({
    currentFileId: taskSessionState.currentFileId,
    fallbackFilePath: fallbackFileId,
    imageNaturalSize,
    replaceDoc,
    setSelectedShapeIndex,
    setHoveredShapeIndex,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    setError,
    reloadTaskFiles,
  })
  const taskSessionController = useTaskSessionController({
    filesLength: files.length,
    currentIndex,
    currentFileId: taskSessionState.currentFileId,
    setCurrentIndex,
    deleteCurrentFile: handleDeleteCurrentImage,
    deleteCurrentAnnotation: handleDeleteCurrentAnnotation,
  })

  const handleImageElementLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    setImageNaturalSize({
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
    })
    if (stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
  }, [])

  useTaskShortcuts({
    rightToolMode,
    polygonDraftPointCount,
    hasMaskDraft,
    selectedShapeId,
    hoveredShapeId,
    resolveShapeIndexById,
    clearPolygonDraft,
    clearMaskTransientState,
    handleSelectToolClick,
    popPolygonPoint,
    deleteShape,
    undo,
    redo,
    canUndo,
    canRedo,
    canGoPrevImage: taskSessionController.canGoPrev,
    canGoNextImage: taskSessionController.canGoNext,
    goPrevImage: taskSessionController.prevFile,
    goNextImage: taskSessionController.nextFile,
    canRepeatNewAnnotation: annotationHabitPrimed,
    repeatNewAnnotation,
  })

  const dragSessionUpdateShapePoints = useCallback(
    (shapeIndex: number, points: number[][], shouldPersist: boolean) => applyShapePatch(shapeIndex, points, { persist: shouldPersist }),
    [applyShapePatch],
  )
  const dragSessionUpdateMaskRle = useCallback(
    (
      shapeIndex: number,
      payload: { counts: number[]; w: number; h: number; brushSize: number },
      shouldPersist: boolean,
    ) => applyMaskRlePatch(shapeIndex, payload, { persist: shouldPersist }),
    [applyMaskRlePatch],
  )

  useDragSessions({
    dragSession,
    imageNaturalSize,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    updateShapePoints: dragSessionUpdateShapePoints,
    updateMaskRle: dragSessionUpdateMaskRle,
    setRawHighlightCorner,
    setDragLivePoints,
    setDragCuboidLivePoints,
    setDragVertexLive,
    setDragLiveMaskRle,
    setDragStageNudge,
    projectImageDeltaToStage,
  })

  usePersistAfterDrag({ dragSession, persistIfDirty })

  const sidebarPanelProps = useTaskSidebarViewModel({
    leftPanelMode,
    labelsTab,
    onLabelsTabChange: setLabelsTab,
    panelShapes: panelDoc?.shapes ?? [],
    selectedShapeId,
    hoveredShapeId,
    hiddenShapeIndexes,
    hiddenClassLabels,
    labelColorMap,
    project,
    taskName,
    activeImagePath,
    imageNaturalSize,
    imageFileInfo,
    formatBytes,
    onSetHoveredShapeId: setHoveredShapeId,
    onSetSelectedShapeId: setSelectedShapeId,
    onDeleteShape: deleteShape,
    onToggleShapeVisibility: toggleShapeVisibility,
    onToggleClassVisibility: toggleClassVisibility,
    onReorderShapeLayer: reorderShapeLayer,
  })

  const canvasSectionProps = useCanvasSectionProps({
    stageRef,
    handleImageWheel,
    handleImageMouseDown,
    handleImageMouseMove,
    endImagePan,
    handleImageDoubleClick,
    handleStageClick,
    setImageLoadError,
    handleImageElementLoad,
    setRawHighlightCorner,
    setSelectedShape: (shapeId) => setSelectedShapeId(shapeId),
    handleRectangleMouseEnter,
    handleRectangleMouseLeave,
    handleRectangleMouseDown,
    handleRectangleClick,
    handleMaskMouseDown,
    handlePointMouseDown,
    handlePolygonMouseDown,
    handleCuboidFaceMouseDown,
    handleRotationPolygonMouseDown,
    handleRotationHandleMouseDown,
    handleRotationCornerMouseDown,
    handlePolygonVertexMouseDown,
    handleRectResizeMouseDown,
    previewRect,
    polygonDraftStagePoints,
    hoveredDraftVertexIndex,
    maskDraftStagePoints,
    maskCursorStagePoint,
    maskBrushSize,
    maskDrawMode,
    createMaskDraft,
    appendMaskDraftPoint,
    commitMaskStroke,
    clearMaskTransientState,
    handlePolygonDrawMove,
    handlePolygonDrawClick,
    handlePolygonDrawDoubleClick,
    handleRectDrawMove,
    handleRectDrawClick,
    handleBox3dDrawMove,
    handleBox3dDrawClick,
    handleKeypointDrawClick,
    handleSkeletonDrawClick,
    box3dDraftBaseStagePoints,
    box3dPreviewTopStagePoints,
    error,
    filesLength: files.length,
    isImageLoading,
    imageObjectUrl,
    imageLoadError,
    currentFileName,
    canPanAndZoom,
    isPanning,
    canDrawMask,
    canDrawRectangle,
    canDrawPolygon,
    canDrawBox3d,
    canDrawKeypoint,
    canDrawSkeleton,
    imageOffset,
    imageScale,
    imageFitScale: imageGeometry?.fitScale ?? 1,
    drawingLayerActive,
    renderedMasks,
    renderedPolygons,
    renderedRotationRects,
    renderedRectangles,
    renderedCuboids2d,
    renderedPoints,
    renderedSkeletons,
    selectedShapeIndex,
    hoveredShapeIndex,
    pendingRectColor,
    selectedRotationRect,
    selectedPolygon,
    selectedCuboid2d,
    selectedRect,
    rawHighlightCorner,
    dragStageNudge,
  })

  const handleSelectToolFromPalette = useCallback(() => {
    clearMaskTransientState()
    clearBox3dDraft()
    handleSelectToolClick()
  }, [clearBox3dDraft, clearMaskTransientState, handleSelectToolClick])

  const canvasContainerProps = useTaskCanvasContainerProps({
    sectionProps: canvasSectionProps,
    rightToolMode,
    drawShapeType,
    rectDrawingEnabled,
    rectFirstPoint,
    polygonDraftPointCount,
    rectPickerOpen,
    rectPendingLabel,
    annotationLabelOptions: taskRectPickerLabelOptions,
    maskDrawMode,
    maskBrushSize,
    onSelectTool: handleSelectToolFromPalette,
    onStartRectTool: handleStartRectToolFromToolbar,
    onStartRotRectTool: handleStartRotRectToolFromToolbar,
    onStartPolygonTool: handleStartPolygonToolFromToolbar,
    onStartMaskTool: handleStartMaskToolFromToolbar,
    onStartKeypointTool: handleStartKeypointToolFromToolbar,
    onStartBox3dTool: handleStartBox3dToolFromToolbar,
    onStartSkeletonTool: handleStartSkeletonToolFromToolbar,
    onClearSelection: clearSelectedShape,
    onRectPendingLabelChange: setRectPendingLabel,
    onMaskDrawModeChange: setMaskDrawMode,
    onMaskBrushSizeChange: setMaskBrushSize,
    onRectPickerCancel: handleRectPickerCancelWrapped,
    onRectPickerConfirm: handleRectPickerConfirmWrapped,
    box3dAwaitingSecondClick,
  })

  const sidebarProps = useTaskSidebarProps({
    leftPanelMode,
    onPanelModeChange: setLeftPanelMode,
    panelProps: sidebarPanelProps,
  })

  return (
    <div className="flex h-[calc(100vh-var(--ea-titlebar-height,36px))] min-h-0 w-full select-none flex-col overflow-hidden">
      <TaskHeaderContainer
        projectId={projectId}
        taskName={taskName}
        currentFileName={currentFileName}
        progressText={progressText}
        canGoPrev={taskSessionController.canGoPrev}
        canGoNext={taskSessionController.canGoNext}
        onPrevFile={taskSessionController.prevFile}
        onNextFile={taskSessionController.nextFile}
        onDownloadCurrentImage={handleDownloadCurrentImage}
        onDeleteCurrentAnnotation={taskSessionController.deleteCurrentAnnotation}
        onDeleteCurrentImage={taskSessionController.deleteCurrentFile}
      />
      <div className="relative min-h-0 flex-1 bg-background">
        <div className="flex h-full min-h-0">
          <TaskSidebarContainer {...sidebarProps} />
          <TaskCanvasContainer {...canvasContainerProps} />
        </div>
      </div>
    </div>
  )
}

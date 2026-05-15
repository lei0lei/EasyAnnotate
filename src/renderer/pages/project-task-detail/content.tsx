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
import { fetchModelRuntimeCatalog } from "@/lib/model-runtime-api"
import { writeMaskRleAttributes, decodeRowMajorRleToBinary, foregroundBBoxInclusive } from "@/lib/mask-raster-rle"
import { contourForYoloExport } from "@/lib/mask-contour"
import {
  formatOrtWebInferError,
  isSamCvatsFeatureLayout,
  loadSamDecoderSession,
  runSamCvatsDecoder,
} from "@/lib/sam2-cvat-onnx"
import { mapFullImageSam2PromptToEncode, upscaleSam2DecoderRleToFullImageIfNeeded } from "@/lib/sam2-infer-scale"
import type { Sam2EmbedCache } from "@/lib/sam2-encode-api"
import {
  formatActiveSamAnnotationLabel,
  persistSamAnnotationSelection,
  resolveActiveSamFromCatalog,
} from "@/lib/sam-annotation-runtime"
import {
  getSam2AiToolbarEnabledSnapshot,
  subscribeSam2AiToolbarEnabled,
} from "@/lib/sam2-ai-toolbar-prefs"
import { formatBytes } from "@/pages/project-task-detail/utils"
import { findShapeIndexByStableId } from "@/pages/project-task-detail/shape-identity"
import { useDragSessions } from "@/pages/project-task-detail/use-drag-sessions"
import { useTaskCanvasEngine } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { DragStageNudge } from "@/pages/project-task-detail/page-sections"
import type {
  DragLiveMaskRleOverride,
  DragLivePointsOverride,
  DragVertexLiveOverride,
  Sam2DraftMaskRle,
} from "@/pages/project-task-detail/rendered-shapes"
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
import {
  useSam2CanvasTool,
  type Sam2AutoPromptParams,
  type Sam2DecodeRequest,
} from "@/pages/project-task-detail/use-sam2-canvas-tool"
import { AnnotationStoreProvider } from "@/pages/project-task-detail/annotation-store-context"
import { TaskHeaderContainer } from "@/pages/project-task-detail/header-container"
import { TaskSidebarContainer } from "@/pages/project-task-detail/sidebar-container"
import { TaskCanvasContainer } from "@/pages/project-task-detail/canvas-container"
import { rightToolModeToDrawingPreset } from "@/pages/project-task-detail/drawing-tool-preset"
import type {
  Sam2AutoAnnotationFormat,
  Sam2PromptMode,
} from "@/pages/project-task-detail/annotateTools/aiTools/types"
import type { LabelsTab, LeftPanelMode, RightToolMode } from "@/pages/project-task-detail/types"
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent, useSyncExternalStore } from "react"

/** SAM2 多边形滑条：0=左少顶点、100=右多顶点 → RDP 容差与顶点上限 */
function sam2PolygonContourOptions(vertexBias0to100: number): { rdpEpsilon: number; maxPoints: number } {
  const t = Math.max(0, Math.min(100, Math.round(vertexBias0to100))) / 100
  return {
    rdpEpsilon: 8.5 - (8.5 - 0.22) * t,
    maxPoints: Math.max(24, Math.floor(36 + t * 620)),
  }
}

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
  const [sam2DialogOpen, setSam2DialogOpen] = useState(false)
  const [sam2SelectedLabel, setSam2SelectedLabel] = useState("")
  const [sam2OutputFormat, setSam2OutputFormat] = useState<Sam2AutoAnnotationFormat>("mask")
  /** 多边形输出：0=左少顶点，100=右多顶点 */
  const [sam2PolygonVertexBias, setSam2PolygonVertexBias] = useState(50)
  const [sam2PromptMode, setSam2PromptMode] = useState<Sam2PromptMode>("point")
  const [sam2AutoPromptEnabled, setSam2AutoPromptEnabled] = useState(false)
  const [sam2AutoObjectBoxW, setSam2AutoObjectBoxW] = useState(128)
  const [sam2AutoObjectBoxH, setSam2AutoObjectBoxH] = useState(128)
  const [sam2AutoIouThreshold, setSam2AutoIouThreshold] = useState(0.5)
  const [sam2AutoHoverFactor, setSam2AutoHoverFactor] = useState(1)
  /** SAM2 encode / ORT 解码使用的相对原图边长倍率（0.3–1）；画布与落盘仍为原图坐标 */
  const [sam2InferScale, setSam2InferScale] = useState(1)
  const [sam2AnnotatingActive, setSam2AnnotatingActive] = useState(false)
  const sam2AnnotatingActiveRef = useRef(false)
  sam2AnnotatingActiveRef.current = sam2AnnotatingActive
  const sam2SelectedLabelRef = useRef(sam2SelectedLabel)
  sam2SelectedLabelRef.current = sam2SelectedLabel
  const [sam2SessionNonce, setSam2SessionNonce] = useState(0)
  const [sam2DraftRle, setSam2DraftRle] = useState<{ counts: number[]; w: number; h: number } | null>(null)
  const sam2EncodeModelIdRef = useRef("sam2/sam2.1_hiera_tiny")
  const sam2EmbedCacheRef = useRef<Sam2EmbedCache | null>(null)
  const sam2DecodeGenRef = useRef(0)
  const [activeSamRuntime, setActiveSamRuntime] = useState<{ label: string; running: boolean } | null>(null)
  /** 上次用 N 成功提交 SAM2 并已切到选择工具后，再按 N 可回到 SAM2 标注（沿用面板中的标签/输出类型等） */
  const sam2ResumeAfterNCommitRef = useRef(false)

  const refreshActiveSamRuntime = useCallback(() => {
    void fetchModelRuntimeCatalog()
      .then((cat) => {
        const active = resolveActiveSamFromCatalog(cat.categories)
        if (!active) {
          setActiveSamRuntime({ label: "", running: false })
          return
        }
        setActiveSamRuntime({
          label: formatActiveSamAnnotationLabel(active, cat.categories),
          running: true,
        })
        sam2EncodeModelIdRef.current = active.modelId
        persistSamAnnotationSelection(active.family, active.modelId)
      })
      .catch(() => {
        setActiveSamRuntime(null)
      })
  }, [])

  useEffect(() => {
    if (!sam2DialogOpen) return
    refreshActiveSamRuntime()
  }, [sam2DialogOpen, refreshActiveSamRuntime])
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

  const finishSam2CommitAndSwitchToSelect = useCallback(() => {
    sam2ResumeAfterNCommitRef.current = true
    setSam2AnnotatingActive(false)
    handleSelectToolClick()
  }, [handleSelectToolClick])

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
  useEffect(() => {
    const plain = annotationLabelOptionsPlain
    if (!plain.includes(sam2SelectedLabel)) {
      setSam2SelectedLabel(plain[0] ?? "")
    }
  }, [annotationLabelOptionsPlain, sam2SelectedLabel])

  useEffect(() => {
    sam2EmbedCacheRef.current = null
    setSam2DraftRle(null)
    // 保留 sam2ResumeAfterNCommitRef：上一张用 N 落盘后，翻页再按 N 仍应回到 SAM2
  }, [activeImagePath])

  useEffect(() => {
    sam2EmbedCacheRef.current = null
    setSam2DraftRle(null)
    setSam2SessionNonce((n) => n + 1)
  }, [sam2InferScale])

  const [sam2Toast, setSam2Toast] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  const handleSam2Confirm = useCallback(() => {
    sam2ResumeAfterNCommitRef.current = false
    setSam2DraftRle(null)
    setSam2SessionNonce((n) => n + 1)
    void fetchModelRuntimeCatalog()
      .then((cat) => {
        const active = resolveActiveSamFromCatalog(cat.categories)
        if (!active) {
          setSam2Toast({
            kind: "err",
            text: "请先在「模型 → 自动标注 → SAM 标注」中启动 SAM 推理实例",
          })
          return
        }
        persistSamAnnotationSelection(active.family, active.modelId)
        sam2EncodeModelIdRef.current = active.modelId
        setActiveSamRuntime({
          label: formatActiveSamAnnotationLabel(active, cat.categories),
          running: true,
        })
        setSam2AnnotatingActive(true)
      })
      .catch(() => {
        setSam2Toast({ kind: "err", text: "无法连接后端，请检查 SAM 推理实例状态" })
      })
  }, [])

  const handleSam2EmbeddingsCached = useCallback((cache: Sam2EmbedCache) => {
    sam2EmbedCacheRef.current = cache
    if (isSamCvatsFeatureLayout(cache.response.feature_layout)) {
      void loadSamDecoderSession(cache.response.model_id).catch(() => {})
    }
  }, [])

  const sam2AiToolbarEnabled = useSyncExternalStore(
    subscribeSam2AiToolbarEnabled,
    getSam2AiToolbarEnabledSnapshot,
    getSam2AiToolbarEnabledSnapshot,
  )
  useEffect(() => {
    if (!sam2AiToolbarEnabled) {
      setSam2DialogOpen(false)
      setSam2AnnotatingActive(false)
      setSam2Toast(null)
      setSam2DraftRle(null)
      sam2ResumeAfterNCommitRef.current = false
    }
  }, [sam2AiToolbarEnabled])
  useEffect(() => {
    if (!sam2Toast) return
    const t = window.setTimeout(() => setSam2Toast(null), 6000)
    return () => window.clearTimeout(t)
  }, [sam2Toast])

  const handleSam2EncodeToast = useCallback((ok: boolean, message: string) => {
    setSam2Toast({ kind: ok ? "ok" : "err", text: message })
  }, [])

  const handleSam2DecodeRequest = useCallback(
    async (ctx: Sam2DecodeRequest) => {
      if (!sam2AnnotatingActiveRef.current) return
      const cache = sam2EmbedCacheRef.current
      if (!cache || cache.imagePath !== ctx.imagePath) return
      const enc = cache.response
      if (!isSamCvatsFeatureLayout(enc.feature_layout)) return

      const label = sam2SelectedLabelRef.current.trim()
      if (!label) return

      const prompt = mapFullImageSam2PromptToEncode(enc, {
        promptMode: ctx.promptMode,
        points: ctx.points.map((p) => ({ x: p.x, y: p.y, label: p.label })),
        bbox: ctx.bbox,
      })
      if (!prompt) return

      const gen = ++sam2DecodeGenRef.current
      try {
        const decodeOpts =
          ctx.minPredIou !== undefined && ctx.minPredIou > 0 ? { minPredIou: ctx.minPredIou } : undefined
        const rle = await runSamCvatsDecoder(enc, prompt, decodeOpts)
        if (gen !== sam2DecodeGenRef.current) return
        if (!rle) {
          setSam2DraftRle(null)
          setSam2Toast({ kind: "ok", text: "SAM 未分割出前景（可调整点/框后重试）" })
          return
        }
        const fullRle = upscaleSam2DecoderRleToFullImageIfNeeded(rle, enc)
        if (!fullRle) {
          setSam2DraftRle(null)
          setSam2Toast({ kind: "ok", text: "SAM 未分割出前景（可调整点/框后重试）" })
          return
        }
        setSam2DraftRle({ counts: fullRle.counts, w: fullRle.w, h: fullRle.h })
      } catch (e) {
        if (gen !== sam2DecodeGenRef.current) return
        const msg = formatOrtWebInferError(e)
        setSam2Toast({ kind: "err", text: `SAM ONNX 解码失败：${msg}` })
      }
    },
    [],
  )

  const commitSam2DraftAndNew = useCallback(() => {
    const d = sam2DraftRle
    if (!d) {
      setSam2Toast({ kind: "err", text: "请先在画布上添加点或框以生成分割预览，再按 N 确认" })
      return
    }
    const label = sam2SelectedLabel.trim()
    if (!label) {
      setSam2Toast({ kind: "err", text: "请选择标签" })
      return
    }
    sam2DecodeGenRef.current += 1

    const iw = imageNaturalSize.width
    const ih = imageNaturalSize.height
    const total = d.w * d.h
    if (d.w <= 0 || d.h <= 0 || total <= 0 || d.w !== iw || d.h !== ih) {
      setSam2Toast({ kind: "err", text: "SAM2 预览尺寸与当前图像不一致，请重新标点" })
      return
    }

    const bin = decodeRowMajorRleToBinary(d.counts, total)

    if (sam2OutputFormat === "mask") {
      const created = createShape({
        imagePath: activeImagePath,
        imageWidth: iw,
        imageHeight: ih,
        shape: {
          label,
          score: null,
          points: [],
          group_id: null,
          description: null,
          difficult: false,
          shape_type: "mask",
          flags: null,
          attributes: writeMaskRleAttributes({}, { ...d, brushSize: 1 }),
          kie_linking: [],
        },
      })
      handleEngineShapeCreated({ shapeId: created.shapeId })
      setSam2DraftRle(null)
      setSam2SessionNonce((n) => n + 1)
      finishSam2CommitAndSwitchToSelect()
      return
    }

    if (sam2OutputFormat === "polygon") {
      let ring = contourForYoloExport(bin, d.w, d.h, sam2PolygonContourOptions(sam2PolygonVertexBias)).map(
        ([x, y]) => [Math.round(x), Math.round(y)] as number[],
      )
      if (ring.length >= 2) {
        const a = ring[0]
        const b = ring[ring.length - 1]
        if (a && b && a[0] === b[0] && a[1] === b[1]) ring = ring.slice(0, -1)
      }
      if (ring.length < 3) {
        setSam2Toast({ kind: "err", text: "无法从分割结果生成多边形（轮廓点过少），可改用掩码或 Bbox" })
        return
      }
      const created = createShape({
        imagePath: activeImagePath,
        imageWidth: iw,
        imageHeight: ih,
        shape: {
          label,
          score: null,
          points: ring,
          group_id: null,
          description: null,
          difficult: false,
          shape_type: "polygon",
          flags: null,
          attributes: {},
          kie_linking: [],
        },
      })
      handleEngineShapeCreated({ shapeId: created.shapeId })
      setSam2DraftRle(null)
      setSam2SessionNonce((n) => n + 1)
      finishSam2CommitAndSwitchToSelect()
      return
    }

    if (sam2OutputFormat === "box") {
      const bb = foregroundBBoxInclusive(bin, d.w, d.h)
      if (!bb) {
        setSam2Toast({ kind: "err", text: "分割结果为空，无法生成 Bbox" })
        return
      }
      let minX = bb.minX
      let minY = bb.minY
      let maxX = bb.maxX
      let maxY = bb.maxY
      if (maxX <= minX) maxX = minX + 1
      if (maxY <= minY) maxY = minY + 1
      const created = createShape({
        imagePath: activeImagePath,
        imageWidth: iw,
        imageHeight: ih,
        shape: {
          label,
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
      })
      handleEngineShapeCreated({ shapeId: created.shapeId })
      setSam2DraftRle(null)
      setSam2SessionNonce((n) => n + 1)
      finishSam2CommitAndSwitchToSelect()
      return
    }

    setSam2Toast({ kind: "err", text: "未知的 SAM2 输出类型" })
  }, [
    activeImagePath,
    createShape,
    finishSam2CommitAndSwitchToSelect,
    handleEngineShapeCreated,
    imageNaturalSize.height,
    imageNaturalSize.width,
    sam2DraftRle,
    sam2OutputFormat,
    sam2PolygonVertexBias,
    sam2SelectedLabel,
  ])

  const cancelSam2Round = useCallback(() => {
    sam2DecodeGenRef.current += 1
    setSam2DraftRle(null)
    setSam2SessionNonce((n) => n + 1)
    setSam2Toast({ kind: "ok", text: "已撤销本轮 SAM2 标注" })
  }, [])

  const dismissAiToolUiFromShortcut = useCallback(() => {
    if (sam2AnnotatingActiveRef.current) {
      sam2ResumeAfterNCommitRef.current = true
    }
    setSam2DialogOpen(false)
    setSam2AnnotatingActive(false)
    setSam2Toast(null)
    setSam2DraftRle(null)
  }, [])

  const tryResumeSam2AfterCommit = useCallback((): boolean => {
    if (!sam2AiToolbarEnabled) return false
    if (sam2AnnotatingActive) return false
    if (!sam2ResumeAfterNCommitRef.current) return false
    sam2ResumeAfterNCommitRef.current = false
    setSam2DraftRle(null)
    setSam2SessionNonce((n) => n + 1)
    setSam2AnnotatingActive(true)
    return true
  }, [sam2AiToolbarEnabled, sam2AnnotatingActive])

  const pendingRectColor = labelColorMap.get((maskDrawingSessionLabel ?? "").trim() || rectPendingLabel) ?? "#f59e0b"

  const shouldSkipSam2Encode = useCallback(
    () =>
      sam2EmbedCacheRef.current?.imagePath === activeImagePath.trim() &&
      (sam2EmbedCacheRef.current?.inferScale ?? 1) === sam2InferScale,
    [activeImagePath, sam2InferScale],
  )

  const getSam2EmbedCache = useCallback(() => sam2EmbedCacheRef.current, [])

  const sam2AutoParams: Sam2AutoPromptParams = useMemo(
    () => ({
      enabled: sam2AutoPromptEnabled,
      objectBoxW: sam2AutoObjectBoxW,
      objectBoxH: sam2AutoObjectBoxH,
      iouThreshold: sam2AutoIouThreshold,
      hoverFactor: sam2AutoHoverFactor,
    }),
    [sam2AutoHoverFactor, sam2AutoIouThreshold, sam2AutoObjectBoxH, sam2AutoObjectBoxW, sam2AutoPromptEnabled],
  )

  const sam2Tool = useSam2CanvasTool({
    sam2AnnotatingActive,
    sam2PromptMode,
    activeImagePath,
    imageReady: !!activeImagePath.trim() && !isImageLoading && !imageLoadError && !!imageObjectUrl,
    imageGeometry,
    imageFitScale: imageGeometry?.fitScale ?? 1,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStage: imageToStageBase,
    labelColor: pendingRectColor,
    modelIdRef: sam2EncodeModelIdRef,
    sessionNonce: sam2SessionNonce,
    shouldSkipEncode: shouldSkipSam2Encode,
    onEmbeddingsCached: handleSam2EmbeddingsCached,
    onEncodeToast: handleSam2EncodeToast,
    getEmbedCache: getSam2EmbedCache,
    onSam2DecodeRequest: handleSam2DecodeRequest,
    imageNaturalSize: { width: imageNaturalSize.width, height: imageNaturalSize.height },
    sam2Auto: sam2AutoParams,
    sam2InferScale,
  })

  const sam2DraftMaskForRender = useMemo((): Sam2DraftMaskRle | null => {
    if (!sam2DraftRle || !sam2SelectedLabel.trim()) return null
    return {
      ...sam2DraftRle,
      label: sam2SelectedLabel.trim(),
      color: labelColorMap.get(sam2SelectedLabel.trim()) ?? "#f59e0b",
    }
  }, [labelColorMap, sam2DraftRle, sam2SelectedLabel])

  const sam2HasCancelableRound = useMemo(
    () =>
      sam2AnnotatingActive && (sam2DraftRle !== null || sam2Tool.sam2ManualPromptNonEmpty),
    [sam2AnnotatingActive, sam2DraftRle, sam2Tool.sam2ManualPromptNonEmpty],
  )

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
      sam2DraftMaskRle: sam2DraftMaskForRender,
    })

  const sam2ImageReadyForEncode =
    !!activeImagePath.trim() && !isImageLoading && !imageLoadError && !!imageObjectUrl
  const sam2BlockPan = sam2AnnotatingActive && sam2ImageReadyForEncode

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
    blockViewPanAndWheel: sam2BlockPan,
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
    dismissAiToolUi: dismissAiToolUiFromShortcut,
    sam2AnnotatingActive,
    sam2HasCancelableRound,
    cancelSam2Round,
    commitSam2DraftAndNew,
    tryResumeSam2AfterCommit,
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
    sam2OverlayActive: sam2Tool.sam2OverlayActive,
    sam2StagePoints: sam2Tool.sam2StagePoints,
    sam2PointPositiveColor: sam2Tool.sam2PointColors.positive,
    sam2PointNegativeColor: sam2Tool.sam2PointColors.negative,
    sam2PreviewRect: sam2Tool.sam2PreviewRect,
    sam2AutoPreviewRect: sam2Tool.sam2AutoPreviewRect,
    onSam2OverlayClick: sam2Tool.handleSam2OverlayClick,
    onSam2OverlayContextMenu: sam2Tool.handleSam2OverlayContextMenu,
    onSam2OverlayMouseMove: sam2Tool.handleSam2OverlayMouseMove,
    onSam2OverlayMouseLeave: sam2Tool.handleSam2OverlayMouseLeave,
    sam2Toast,
    onSam2ToastDismiss: () => setSam2Toast(null),
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
    aiToolPaletteProps: {
      plainAnnotationLabels: annotationLabelOptionsPlain,
      sam2ToolbarEnabled: sam2AiToolbarEnabled,
      sam2DialogOpen,
      onSam2DialogOpenChange: setSam2DialogOpen,
      sam2SelectedLabel,
      onSam2SelectedLabelChange: setSam2SelectedLabel,
      sam2PromptMode,
      onSam2PromptModeChange: setSam2PromptMode,
      sam2OutputFormat,
      onSam2OutputFormatChange: setSam2OutputFormat,
      sam2PolygonVertexBias,
      onSam2PolygonVertexBiasChange: setSam2PolygonVertexBias,
      sam2AutoPromptEnabled,
      onSam2AutoPromptEnabledChange: setSam2AutoPromptEnabled,
      sam2AutoObjectBoxW,
      onSam2AutoObjectBoxWChange: setSam2AutoObjectBoxW,
      sam2AutoObjectBoxH,
      onSam2AutoObjectBoxHChange: setSam2AutoObjectBoxH,
      sam2AutoIouThreshold,
      onSam2AutoIouThresholdChange: setSam2AutoIouThreshold,
      sam2AutoHoverFactor,
      onSam2AutoHoverFactorChange: setSam2AutoHoverFactor,
      sam2InferScale,
      onSam2InferScaleChange: setSam2InferScale,
      activeSamRuntime,
      onSam2Confirm: handleSam2Confirm,
    },
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

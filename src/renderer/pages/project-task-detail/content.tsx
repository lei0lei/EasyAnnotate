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
import { getPrimaryShortcutLabel } from "@/lib/app-shortcut-registry"
import { fetchModelRuntimeCatalog } from "@/lib/model-runtime-api"
import {
  decodeSamSessionWithRetry,
  releaseSamSession,
  type Sam2DraftPreview,
  type SamSessionCache,
} from "@/lib/sam2-session-api"
import {
  formatActiveSamAnnotationLabel,
  persistSamAnnotationSelection,
  resolveActiveSamFromCatalog,
} from "@/lib/sam-annotation-runtime"
import {
  formatActiveGlobalDinov2Label,
  resolveActiveGlobalDinov2FromCatalog,
} from "@/lib/global-dinov2-runtime"
import { getGlobalDinov2ModelId } from "@/lib/global-dinov2-prefs"
import {
  extractDiffusionPolygonRing,
  isDiffusionCandidateAnnotatable,
} from "@/lib/diffusion-candidate-shape"
import {
  runDiffusionPipeline,
  type DiffusionCandidateResult,
  type DiffusionPipelineVisualStep,
  type DiffusionSeedBbox,
} from "@/lib/diffusion-annotation-runtime"
import { diffusionProcessAnimationPrefs } from "@/lib/diffusion-process-animation-prefs"
import {
  buildRefinedProcessOverlay,
  buildSimilarityProcessOverlay,
  DIFFUSION_PROCESS_ANIM_MS,
  diffusionProcessOverlayToStageRects,
  sleepMs,
  type DiffusionProcessOverlay,
} from "@/lib/diffusion-process-visual"
import { diffusionPipelinePrefs } from "@/lib/diffusion-pipeline-prefs"
import { annotationAppearancePrefs } from "@/lib/annotation-appearance-prefs"
import {
  getSam2AiToolbarEnabledSnapshot,
  subscribeSam2AiToolbarEnabled,
} from "@/lib/sam2-ai-toolbar-prefs"
import { diffusionAiToolbarPrefs } from "@/lib/placeholder-ai-toolbar-prefs"
import { formatBytes } from "@/pages/project-task-detail/utils"
import { findShapeIndexByStableId } from "@/pages/project-task-detail/shape-identity"
import { useDragSessions } from "@/pages/project-task-detail/use-drag-sessions"
import { useTaskCanvasEngine } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { DragStageNudge } from "@/pages/project-task-detail/page-sections"
import type {
  DragLivePointsOverride,
  DragVertexLiveOverride,
  DiffusionPreviewMaskBinary,
  DiffusionPreviewPolygon,
  DiffusionPreviewRectangle,
  Sam2DraftPreviewPolygon,
} from "@/pages/project-task-detail/rendered-shapes"
import { useTaskRenderModel } from "@/pages/project-task-detail/use-task-render-model"
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
import { useDiffusionCanvasTool } from "@/pages/project-task-detail/use-diffusion-canvas-tool"
import { AnnotationStoreProvider } from "@/pages/project-task-detail/annotation-store-context"
import { TaskHeaderContainer } from "@/pages/project-task-detail/header-container"
import { TaskSidebarContainer } from "@/pages/project-task-detail/sidebar-container"
import { TaskCanvasContainer } from "@/pages/project-task-detail/canvas-container"
import { rightToolModeToDrawingPreset } from "@/pages/project-task-detail/drawing-tool-preset"
import type {
  DiffusionSeedSamPreviewMode,
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
  const [sam2OutputFormat, setSam2OutputFormat] = useState<Sam2AutoAnnotationFormat>("polygon")
  /** 多边形输出：0=左少顶点，100=右多顶点 */
  const [sam2PolygonVertexBias, setSam2PolygonVertexBias] = useState(50)
  const [sam2PromptMode, setSam2PromptMode] = useState<Sam2PromptMode>("point")
  const [sam2AutoPromptEnabled, setSam2AutoPromptEnabled] = useState(false)
  const [sam2AutoObjectBoxW, setSam2AutoObjectBoxW] = useState(128)
  const [sam2AutoObjectBoxH, setSam2AutoObjectBoxH] = useState(128)
  const [sam2AutoIouThreshold, setSam2AutoIouThreshold] = useState(0.5)
  const [sam2AutoHoverFactor, setSam2AutoHoverFactor] = useState(1)
  /** SAM2 session prepare / 服务端 decode 使用的相对原图边长倍率（0.3–1）；画布与落盘仍为原图坐标 */
  const [sam2InferScale, setSam2InferScale] = useState(1)
  const [sam2AnnotatingActive, setSam2AnnotatingActive] = useState(false)
  const sam2AnnotatingActiveRef = useRef(false)
  sam2AnnotatingActiveRef.current = sam2AnnotatingActive
  const sam2SelectedLabelRef = useRef(sam2SelectedLabel)
  sam2SelectedLabelRef.current = sam2SelectedLabel
  const sam2PolygonVertexBiasRef = useRef(sam2PolygonVertexBias)
  sam2PolygonVertexBiasRef.current = sam2PolygonVertexBias
  const [sam2SessionNonce, setSam2SessionNonce] = useState(0)
  const [sam2DraftPreview, setSam2DraftPreview] = useState<Sam2DraftPreview | null>(null)
  const [sam2DecodeBusy, setSam2DecodeBusy] = useState(false)
  const sam2ModelIdRef = useRef("sam2/sam2.1_hiera_tiny")
  const sam2SessionCacheRef = useRef<SamSessionCache | null>(null)
  const sam2DecodeGenRef = useRef(0)
  const sam2DecodeRoundRef = useRef(0)
  const sam2DecodePendingRef = useRef<Sam2DecodeRequest | null>(null)
  const sam2DecodeInFlightRef = useRef(false)
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
        sam2ModelIdRef.current = active.modelId
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

  const [diffusionDialogOpen, setDiffusionDialogOpen] = useState(false)
  const [diffusionSelectedLabel, setDiffusionSelectedLabel] = useState("")
  const [diffusionInferScale, setDiffusionInferScale] = useState(1)
  const [diffusionSeedPreview, setDiffusionSeedPreview] = useState<DiffusionSeedSamPreviewMode>("bbox_and_mask")
  const [diffusionOutputFormat, setDiffusionOutputFormat] = useState<Sam2AutoAnnotationFormat>("polygon")
  const [diffusionPolygonVertexBias, setDiffusionPolygonVertexBias] = useState(50)
  const [diffusionSamRunning, setDiffusionSamRunning] = useState(false)
  const [diffusionSamRuntimeLabel, setDiffusionSamRuntimeLabel] = useState("")
  const [diffusionDinov2Running, setDiffusionDinov2Running] = useState(false)
  const [diffusionDinov2RuntimeLabel, setDiffusionDinov2RuntimeLabel] = useState("")
  const [diffusionAnnotatingActive, setDiffusionAnnotatingActive] = useState(false)
  const diffusionAnnotatingActiveRef = useRef(false)
  diffusionAnnotatingActiveRef.current = diffusionAnnotatingActive
  const [diffusionPhase, setDiffusionPhase] = useState<"seed" | "searching" | "preview">("seed")
  const [diffusionSeedBbox, setDiffusionSeedBbox] = useState<DiffusionSeedBbox | null>(null)
  const [diffusionCandidates, setDiffusionCandidates] = useState<DiffusionCandidateResult[]>([])
  const [diffusionBusy, setDiffusionBusy] = useState(false)
  const [diffusionSimilarityThreshold, setDiffusionSimilarityThreshold] = useState(0.45)
  const [diffusionMaxInstances, setDiffusionMaxInstances] = useState(32)
  const [diffusionProcessOverlay, setDiffusionProcessOverlay] = useState<DiffusionProcessOverlay | null>(null)
  const diffusionShowProcessAnimation = useSyncExternalStore(
    diffusionProcessAnimationPrefs.subscribe,
    () => diffusionProcessAnimationPrefs.getEnabled(),
    () => false,
  )
  const [diffusionSessionNonce, setDiffusionSessionNonce] = useState(0)
  const [diffusionToast, setDiffusionToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const diffusionSamModelIdRef = useRef("sam2/sam2.1_hiera_tiny")
  const diffusionDinov2ModelIdRef = useRef(getGlobalDinov2ModelId())
  const diffusionResumeAfterNCommitRef = useRef(false)

  const refreshDiffusionBackendRuntimes = useCallback(() => {
    void fetchModelRuntimeCatalog()
      .then((cat) => {
        const sam = resolveActiveSamFromCatalog(cat.categories)
        const samOk = sam != null
        if (samOk) {
          setDiffusionSamRuntimeLabel(formatActiveSamAnnotationLabel(sam, cat.categories))
        } else {
          setDiffusionSamRuntimeLabel("")
        }
        setDiffusionSamRunning(samOk)
        const dino = resolveActiveGlobalDinov2FromCatalog(cat.categories)
        const dinoOk = dino != null
        if (dinoOk) {
          setDiffusionDinov2RuntimeLabel(formatActiveGlobalDinov2Label(dino, cat.categories))
        } else {
          setDiffusionDinov2RuntimeLabel("")
        }
        setDiffusionDinov2Running(dinoOk)
      })
      .catch(() => {
        setDiffusionSamRunning(false)
        setDiffusionSamRuntimeLabel("")
        setDiffusionDinov2Running(false)
        setDiffusionDinov2RuntimeLabel("")
      })
  }, [])

  useEffect(() => {
    if (!diffusionDialogOpen) return
    refreshDiffusionBackendRuntimes()
  }, [diffusionDialogOpen, refreshDiffusionBackendRuntimes])
  const {
    imageObjectUrl,
    setImageObjectUrl,
    activeImagePath,
    setActiveImagePath,
    isImageLoading,
    setIsImageLoading,
    imageLoadingHint,
    setImageLoadingHint,
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
    totalFileCount,
    currentImageOneBased,
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
    handleStartKeypointTool,
    handleStartBox3dTool,
    handleStartSkeletonTool,
    rectPendingLabel,
    setRectPendingLabel,
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

  const { reloadTaskFiles, handleImageDecodeError, ensureFilesLoadedThroughIndex } = useTaskBootstrap({
    projectId,
    taskId,
    currentIndex,
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
    setImageLoadingHint,
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
    clearPolygonDraft,
    clearSelectedShape,
    handleSelectToolClick,
    startDrawingWithPreset,
  ])

  const drawingLayerActive =
    toolWorkflowPhase === "drawing" && (canDrawRectangle || canDrawPolygon || canDrawKeypoint || canDrawBox3d || canDrawSkeleton)
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
    const plain = annotationLabelOptionsPlain
    if (!plain.includes(diffusionSelectedLabel)) {
      setDiffusionSelectedLabel(plain[0] ?? "")
    }
  }, [annotationLabelOptionsPlain, diffusionSelectedLabel])

  useEffect(() => {
    sam2SessionCacheRef.current = null
    sam2DecodeRoundRef.current += 1
    sam2DecodeGenRef.current += 1
    sam2DecodePendingRef.current = null
    setSam2DraftPreview(null)
    // 保留 sam2ResumeAfterNCommitRef：上一张用 N 落盘后，翻页再按 N 仍应回到 SAM2
  }, [activeImagePath])

  useEffect(() => {
    sam2SessionCacheRef.current = null
    sam2DecodeRoundRef.current += 1
    sam2DecodeGenRef.current += 1
    sam2DecodePendingRef.current = null
    setSam2DraftPreview(null)
    setSam2SessionNonce((n) => n + 1)
  }, [sam2InferScale])

  const [sam2Toast, setSam2Toast] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  const handleSam2Confirm = useCallback(() => {
    setDiffusionAnnotatingActive(false)
    setDiffusionPhase("seed")
    sam2ResumeAfterNCommitRef.current = false
    setSam2DraftPreview(null)
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
        sam2ModelIdRef.current = active.modelId
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

  useEffect(() => {
    if (!diffusionAnnotatingActive && diffusionInferScale === sam2InferScale) return
    if (diffusionAnnotatingActive) {
      sam2SessionCacheRef.current = null
    }
  }, [diffusionAnnotatingActive, diffusionInferScale, sam2InferScale])

  useEffect(() => {
    setDiffusionSeedBbox(null)
    setDiffusionCandidates([])
    setDiffusionPhase("seed")
    setDiffusionProcessOverlay(null)
    if (diffusionAnnotatingActive) {
      sam2SessionCacheRef.current = null
    }
  }, [activeImagePath])

  useEffect(() => {
    if (!diffusionToast) return
    const t = window.setTimeout(() => setDiffusionToast(null), 8000)
    return () => window.clearTimeout(t)
  }, [diffusionToast])

  const handleDiffusionVisualStep = useCallback(
    async (step: DiffusionPipelineVisualStep) => {
      if (!diffusionShowProcessAnimation) return
      if (step.kind === "clear") {
        setDiffusionProcessOverlay(null)
        return
      }
      if (step.kind === "similarity_boxes") {
        setDiffusionProcessOverlay(buildSimilarityProcessOverlay(step.similarityCandidates))
        setDiffusionToast({ kind: "ok", text: `DINO 候选 ${step.similarityCandidates.length} 个…` })
        await sleepMs(DIFFUSION_PROCESS_ANIM_MS)
        return
      }
      setDiffusionProcessOverlay(buildRefinedProcessOverlay(step.candidates))
      setDiffusionToast({ kind: "ok", text: `后处理保留 ${step.candidates.length} 个…` })
      await sleepMs(DIFFUSION_PROCESS_ANIM_MS)
    },
    [diffusionShowProcessAnimation],
  )

  const handleDiffusionConfirm = useCallback(() => {
    setSam2AnnotatingActive(false)
    setSam2DialogOpen(false)
    setDiffusionSeedBbox(null)
    setDiffusionCandidates([])
    setDiffusionProcessOverlay(null)
    setDiffusionPhase("seed")
    setDiffusionSessionNonce((n) => n + 1)
    void fetchModelRuntimeCatalog()
      .then((cat) => {
        const sam = resolveActiveSamFromCatalog(cat.categories)
        const dino = resolveActiveGlobalDinov2FromCatalog(cat.categories)
        if (!sam || !dino) {
          setDiffusionToast({
            kind: "err",
            text: "请先在「模型 → 后端模型管理」中启动全局 SAM 与 DINOv2 推理实例",
          })
          return
        }
        persistSamAnnotationSelection(sam.family, sam.modelId)
        diffusionSamModelIdRef.current = sam.modelId
        sam2ModelIdRef.current = sam.modelId
        diffusionDinov2ModelIdRef.current = dino.modelId
        setDiffusionAnnotatingActive(true)
        setDiffusionToast({ kind: "ok", text: "在画布上拖拽种子框，画完后将自动搜索" })
      })
      .catch(() => {
        setDiffusionToast({ kind: "err", text: "无法连接后端，请检查推理实例状态" })
      })
  }, [])

  const runDiffusionSearchPipeline = useCallback((seedOverride?: DiffusionSeedBbox) => {
    const seed = seedOverride ?? diffusionSeedBbox
    const path = activeImagePath.trim()
    if (!seed || !path) {
      setDiffusionToast({ kind: "err", text: "请先在画布上拖拽种子矩形框" })
      return
    }
    if (diffusionBusy) return
    setDiffusionBusy(true)
    setDiffusionPhase("searching")
    setDiffusionCandidates([])
    setDiffusionProcessOverlay(null)
    void runDiffusionPipeline({
      imagePath: path,
      samModelId: diffusionSamModelIdRef.current,
      dinov2ModelId: diffusionDinov2ModelIdRef.current,
      inferScale: diffusionInferScale,
      seedBbox: seed,
      seedGuideMode: diffusionSeedPreview,
      sessionCache: sam2SessionCacheRef.current,
      similarityThreshold: diffusionSimilarityThreshold,
      maxInstances: diffusionMaxInstances,
      candidateBoxStrategy: diffusionPipelinePrefs.getCandidateBoxStrategy(),
      refinePostStrategy: diffusionPipelinePrefs.getRefinePostStrategy(),
      animateProcess: diffusionShowProcessAnimation,
      onVisualStep: handleDiffusionVisualStep,
      onProgress: (msg) => setDiffusionToast({ kind: "ok", text: msg }),
    })
      .then((result) => {
        sam2SessionCacheRef.current = result.sessionCache
        setDiffusionProcessOverlay(null)
        setDiffusionCandidates(result.candidates)
        setDiffusionPhase("preview")
        const iw = imageNaturalSize.width
        const ih = imageNaturalSize.height
        const contourOpts = sam2PolygonContourOptions(diffusionPolygonVertexBias)
        const ok = result.candidates.filter((c) =>
          isDiffusionCandidateAnnotatable(c, diffusionOutputFormat, iw, ih, contourOpts),
        ).length
        const filteredNote =
          result.dinoFilteredCount + result.maskNmsFilteredCount > 0
            ? `，过滤 ${result.dinoFilteredCount + result.maskNmsFilteredCount}（DINO ${result.dinoFilteredCount} / IoU ${result.maskNmsFilteredCount}）`
            : ""
        setDiffusionToast({
          kind: "ok",
          text:
            `找到 ${result.similarityCandidates.length} 个相似区域，` +
            `SAM 精化成功 ${result.refinedSuccessCount} / 失败 ${result.refinedFailedCount}${filteredNote}，` +
            `保留 ${result.candidates.length} 个，${ok} 个可标注；按 ${getPrimaryShortcutLabel("new-annotation")} 全部新建，` +
            `${getPrimaryShortcutLabel("select-tool")} 退出`,
        })
      })
      .catch((e) => {
        setDiffusionPhase("seed")
        setDiffusionProcessOverlay(null)
        const msg = e instanceof Error ? e.message : String(e)
        setDiffusionToast({ kind: "err", text: `扩散搜索失败：${msg}` })
      })
      .finally(() => {
        setDiffusionBusy(false)
      })
  }, [
    activeImagePath,
    diffusionBusy,
    diffusionShowProcessAnimation,
    handleDiffusionVisualStep,
    diffusionInferScale,
    diffusionMaxInstances,
    diffusionOutputFormat,
    diffusionPolygonVertexBias,
    diffusionSeedBbox,
    diffusionSimilarityThreshold,
    imageNaturalSize.height,
    imageNaturalSize.width,
  ])

  const handleDiffusionPanelOk = useCallback(() => {
    if (!diffusionAnnotatingActive) {
      handleDiffusionConfirm()
    }
  }, [diffusionAnnotatingActive, handleDiffusionConfirm])

  const handleDiffusionSeedBboxChange = useCallback(
    (bbox: DiffusionSeedBbox | null) => {
      setDiffusionSeedBbox(bbox)
      if (!bbox || diffusionBusy) return
      if (!diffusionAnnotatingActive || diffusionPhase !== "seed") return
      runDiffusionSearchPipeline(bbox)
    },
    [diffusionAnnotatingActive, diffusionBusy, diffusionPhase, runDiffusionSearchPipeline],
  )

  const finishDiffusionCommitAndSwitchToSelect = useCallback(() => {
    diffusionResumeAfterNCommitRef.current = true
    setDiffusionAnnotatingActive(false)
    setDiffusionPhase("seed")
    setDiffusionSeedBbox(null)
    setDiffusionCandidates([])
    setDiffusionProcessOverlay(null)
    setDiffusionDialogOpen(false)
    handleSelectToolClick()
  }, [handleSelectToolClick])

  const exitDiffusionAnnotating = useCallback(() => {
    diffusionResumeAfterNCommitRef.current = false
    setDiffusionAnnotatingActive(false)
    setDiffusionPhase("seed")
    setDiffusionSeedBbox(null)
    setDiffusionCandidates([])
    setDiffusionProcessOverlay(null)
    setDiffusionToast(null)
    setDiffusionDialogOpen(false)
    sam2SessionCacheRef.current = null
    handleSelectToolClick()
  }, [handleSelectToolClick])

  const commitDiffusionCandidates = useCallback(() => {
    const label = diffusionSelectedLabel.trim()
    if (!label) {
      setDiffusionToast({ kind: "err", text: "请选择标签" })
      return
    }
    if (diffusionCandidates.length === 0) {
      setDiffusionToast({ kind: "err", text: "没有可新建的实例（请重新搜索）" })
      return
    }
    const iw = imageNaturalSize.width
    const ih = imageNaturalSize.height
    const contourOpts = sam2PolygonContourOptions(diffusionPolygonVertexBias)
    let created = 0
    for (const c of diffusionCandidates) {
      if (!isDiffusionCandidateAnnotatable(c, diffusionOutputFormat, iw, ih, contourOpts)) continue

      if (diffusionOutputFormat === "box") {
        const { x1, y1, x2, y2 } = c.bbox
        const shape = createShape({
          imagePath: activeImagePath,
          imageWidth: iw,
          imageHeight: ih,
          shape: {
            label,
            score: c.score,
            points: [
              [x1, y1],
              [x2, y2],
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
        handleEngineShapeCreated({ shapeId: shape.shapeId })
        created += 1
        continue
      }

      if (diffusionOutputFormat === "polygon") {
        const ring = extractDiffusionPolygonRing(c, iw, ih, contourOpts)
        if (!ring) continue
        const shape = createShape({
          imagePath: activeImagePath,
          imageWidth: iw,
          imageHeight: ih,
          shape: {
            label,
            score: c.score,
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
        handleEngineShapeCreated({ shapeId: shape.shapeId })
        created += 1
        continue
      }

    }
    if (created === 0) {
      setDiffusionToast({ kind: "err", text: "未能生成有效形状，可改用 Bbox 输出或调低相似度阈值" })
      return
    }
    const newAnnKey = getPrimaryShortcutLabel("new-annotation")
    setDiffusionToast({
      kind: "ok",
      text: `已新建 ${created} 个标注；按 ${newAnnKey} 可继续用当前配置新建`,
    })
    finishDiffusionCommitAndSwitchToSelect()
  }, [
    activeImagePath,
    createShape,
    diffusionCandidates,
    diffusionOutputFormat,
    diffusionPolygonVertexBias,
    diffusionSelectedLabel,
    finishDiffusionCommitAndSwitchToSelect,
    handleEngineShapeCreated,
    imageNaturalSize.height,
    imageNaturalSize.width,
  ])

  const handleSam2SessionCached = useCallback((cache: SamSessionCache) => {
    sam2SessionCacheRef.current = cache
  }, [])

  const sam2AiToolbarEnabled = useSyncExternalStore(
    subscribeSam2AiToolbarEnabled,
    getSam2AiToolbarEnabledSnapshot,
    getSam2AiToolbarEnabledSnapshot,
  )
  const diffusionAiToolbarEnabled = useSyncExternalStore(
    diffusionAiToolbarPrefs.subscribe,
    () => diffusionAiToolbarPrefs.getEnabled(),
    () => false,
  )
  const annotationAppearance = useSyncExternalStore(
    annotationAppearancePrefs.subscribe,
    () => annotationAppearancePrefs.get(),
    () => annotationAppearancePrefs.defaults(),
  )

  const tryResumeDiffusionAfterCommit = useCallback((): boolean => {
    if (!diffusionAiToolbarEnabled) return false
    if (diffusionAnnotatingActive) return false
    if (!diffusionResumeAfterNCommitRef.current) return false
    diffusionResumeAfterNCommitRef.current = false
    setDiffusionSeedBbox(null)
    setDiffusionCandidates([])
    setDiffusionPhase("seed")
    setDiffusionSessionNonce((n) => n + 1)
    setDiffusionAnnotatingActive(true)
    setDiffusionToast({ kind: "ok", text: "在画布上拖拽种子框，画完后将自动搜索" })
    return true
  }, [diffusionAiToolbarEnabled, diffusionAnnotatingActive])

  useEffect(() => {
    if (!sam2AiToolbarEnabled) {
      sam2DecodeRoundRef.current += 1
      sam2DecodePendingRef.current = null
      void releaseSamSession()
      setSam2DialogOpen(false)
      setSam2AnnotatingActive(false)
      setSam2Toast(null)
      setSam2DraftPreview(null)
      sam2SessionCacheRef.current = null
      sam2ResumeAfterNCommitRef.current = false
    }
  }, [sam2AiToolbarEnabled])
  useEffect(() => {
    if (!diffusionAiToolbarEnabled) {
      diffusionResumeAfterNCommitRef.current = false
      setDiffusionDialogOpen(false)
      setDiffusionAnnotatingActive(false)
      setDiffusionPhase("seed")
      setDiffusionSeedBbox(null)
      setDiffusionCandidates([])
      setDiffusionProcessOverlay(null)
      setDiffusionToast(null)
    }
  }, [diffusionAiToolbarEnabled])
  useEffect(() => {
    if (!sam2Toast) return
    const t = window.setTimeout(() => setSam2Toast(null), 6000)
    return () => window.clearTimeout(t)
  }, [sam2Toast])

  const handleSam2PrepareToast = useCallback((ok: boolean, message: string) => {
    setSam2Toast({ kind: ok ? "ok" : "err", text: message })
  }, [])

  useEffect(() => {
    return () => {
      sam2DecodeRoundRef.current += 1
      sam2DecodePendingRef.current = null
      void releaseSamSession()
    }
  }, [])

  const runSam2DecodeNow = useCallback(
    async (ctx: Sam2DecodeRequest) => {
      if (!sam2AnnotatingActiveRef.current) return
      const cache = sam2SessionCacheRef.current
      if (!cache || cache.imagePath !== ctx.imagePath) return

      const roundAtStart = sam2DecodeRoundRef.current
      const gen = ++sam2DecodeGenRef.current
      try {
        const result = await decodeSamSessionWithRetry(
          {
            sessionId: cache.sessionId,
            promptMode: ctx.promptMode,
            points: ctx.points.map((p) => ({ x: p.x, y: p.y, label: p.label })),
            bbox: ctx.bbox,
            minPredIou: ctx.minPredIou,
            polygonVertexBias: sam2PolygonVertexBiasRef.current,
            includePolygon: true,
          },
          {
            modelId: cache.modelId,
            imagePath: cache.imagePath,
            inferScale: cache.inferScale,
          },
          (refreshed) => {
            sam2SessionCacheRef.current = refreshed
          },
        )
        if (roundAtStart !== sam2DecodeRoundRef.current || gen !== sam2DecodeGenRef.current) return
        if (!result.ok || !result.polygon) {
          setSam2DraftPreview(null)
          setSam2Toast({
            kind: "ok",
            text: result.message?.trim() || "SAM 未分割出前景（可调整点/框后重试）",
          })
          return
        }
        setSam2DraftPreview({
          polygon: result.polygon,
          bbox: result.bbox,
        })
      } catch (e) {
        if (roundAtStart !== sam2DecodeRoundRef.current || gen !== sam2DecodeGenRef.current) return
        const msg = e instanceof Error ? e.message : String(e)
        setSam2Toast({ kind: "err", text: `SAM 服务端解码失败：${msg}` })
      }
    },
    [],
  )

  const drainSam2DecodeQueue = useCallback(() => {
    if (sam2DecodeInFlightRef.current) return
    sam2DecodeInFlightRef.current = true
    setSam2DecodeBusy(true)
    void (async () => {
      try {
        while (true) {
          const next = sam2DecodePendingRef.current
          if (!next) break
          sam2DecodePendingRef.current = null
          await runSam2DecodeNow(next)
        }
      } finally {
        sam2DecodeInFlightRef.current = false
        setSam2DecodeBusy(false)
        if (sam2DecodePendingRef.current) {
          drainSam2DecodeQueue()
        }
      }
    })()
  }, [runSam2DecodeNow])

  const handleSam2DecodeRequest = useCallback(
    (ctx: Sam2DecodeRequest) => {
      if (!sam2AnnotatingActiveRef.current) return
      // 删除点导致 point prompt 为空时，立即清空当前预览并作废在途解码。
      if (ctx.promptMode === "point" && ctx.points.length === 0) {
        sam2DecodeRoundRef.current += 1
        sam2DecodeGenRef.current += 1
        sam2DecodePendingRef.current = null
        setSam2DraftPreview(null)
        return
      }
      // Single-flight: 同图同轮只保留最后一次请求。
      sam2DecodePendingRef.current = ctx
      drainSam2DecodeQueue()
    },
    [drainSam2DecodeQueue],
  )

  const commitSam2DraftAndNew = useCallback(() => {
    const d = sam2DraftPreview
    if (!d?.polygon || d.polygon.length < 3) {
      setSam2Toast({ kind: "err", text: "请先在画布上添加点或框以生成分割预览，再按 N 确认" })
      return
    }
    const label = sam2SelectedLabel.trim()
    if (!label) {
      setSam2Toast({ kind: "err", text: "请选择标签" })
      return
    }
    sam2DecodeGenRef.current += 1
    sam2DecodePendingRef.current = null

    const iw = imageNaturalSize.width
    const ih = imageNaturalSize.height

    if (sam2OutputFormat === "polygon") {
      const ring = d.polygon
      if (!ring || ring.length < 3) {
        setSam2Toast({ kind: "err", text: "无法从分割结果生成多边形（轮廓点过少），可改用 Bbox" })
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
      setSam2DraftPreview(null)
      setSam2SessionNonce((n) => n + 1)
      finishSam2CommitAndSwitchToSelect()
      return
    }

    if (sam2OutputFormat === "box") {
      const bb = d.bbox
      if (!bb) {
        setSam2Toast({ kind: "err", text: "分割结果为空，无法生成 Bbox" })
        return
      }
      let minX = bb.x1
      let minY = bb.y1
      let maxX = bb.x2
      let maxY = bb.y2
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
      setSam2DraftPreview(null)
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
    sam2DraftPreview,
    sam2OutputFormat,
    sam2SelectedLabel,
  ])

  const cancelSam2Round = useCallback(() => {
    sam2DecodeRoundRef.current += 1
    sam2DecodeGenRef.current += 1
    sam2DecodePendingRef.current = null
    setSam2DraftPreview(null)
    setSam2SessionNonce((n) => n + 1)
    setSam2Toast({ kind: "ok", text: "已撤销本轮 SAM2 标注" })
  }, [])

  const dismissAiToolUiFromShortcut = useCallback(() => {
    if (diffusionAnnotatingActiveRef.current) {
      exitDiffusionAnnotating()
      return
    }
    if (sam2AnnotatingActiveRef.current) {
      sam2ResumeAfterNCommitRef.current = true
    }
    setSam2DialogOpen(false)
    setSam2AnnotatingActive(false)
    sam2DecodeRoundRef.current += 1
    sam2DecodePendingRef.current = null
    setSam2Toast(null)
    setSam2DraftPreview(null)
  }, [exitDiffusionAnnotating])

  const tryResumeSam2AfterCommit = useCallback((): boolean => {
    if (!sam2AiToolbarEnabled) return false
    if (sam2AnnotatingActive) return false
    if (!sam2ResumeAfterNCommitRef.current) return false
    sam2ResumeAfterNCommitRef.current = false
    setSam2DraftPreview(null)
    setSam2SessionNonce((n) => n + 1)
    setSam2AnnotatingActive(true)
    return true
  }, [sam2AiToolbarEnabled, sam2AnnotatingActive])

  const pendingRectColor = labelColorMap.get(rectPendingLabel) ?? "#f59e0b"
  const diffusionLabelColor = labelColorMap.get(diffusionSelectedLabel.trim()) ?? "#f59e0b"

  const shouldSkipSam2Prepare = useCallback(
    () =>
      sam2SessionCacheRef.current?.imagePath === activeImagePath.trim() &&
      (sam2SessionCacheRef.current?.inferScale ?? 1) === sam2InferScale,
    [activeImagePath, sam2InferScale],
  )

  const getSam2SessionCache = useCallback(() => sam2SessionCacheRef.current, [])

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
    modelIdRef: sam2ModelIdRef,
    sessionNonce: sam2SessionNonce,
    shouldSkipPrepare: shouldSkipSam2Prepare,
    onSessionCached: handleSam2SessionCached,
    onPrepareToast: handleSam2PrepareToast,
    getSessionCache: getSam2SessionCache,
    onSam2DecodeRequest: handleSam2DecodeRequest,
    imageNaturalSize: { width: imageNaturalSize.width, height: imageNaturalSize.height },
    sam2Auto: sam2AutoParams,
    sam2InferScale,
  })

  const diffusionProcessStageRects = useMemo(
    () => diffusionProcessOverlayToStageRects(diffusionProcessOverlay, imageGeometry, imageToStageBase),
    [diffusionProcessOverlay, imageGeometry, imageToStageBase],
  )

  const diffusionTool = useDiffusionCanvasTool({
    diffusionAnnotatingActive,
    diffusionPhase,
    activeImagePath,
    imageReady: !!activeImagePath.trim() && !isImageLoading && !imageLoadError && !!imageObjectUrl,
    imageGeometry,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStageForBbox: imageToStageBase,
    labelColor: diffusionLabelColor,
    sessionNonce: diffusionSessionNonce,
    committedSeedBbox: diffusionSeedBbox,
    onCommittedSeedBboxChange: handleDiffusionSeedBboxChange,
  })

  /** SAM2 二次精化后的候选预览（非 DINO 粗框）；与提交逻辑共用 isDiffusionCandidateAnnotatable */
  const diffusionPreviewShapes = useMemo(() => {
    const masks: DiffusionPreviewMaskBinary[] = []
    const polygons: DiffusionPreviewPolygon[] = []
    const rectangles: DiffusionPreviewRectangle[] = []
    if (diffusionPhase !== "preview") {
      return { masks, polygons, rectangles }
    }
    const label = diffusionSelectedLabel.trim()
    const color = diffusionLabelColor
    const iw = imageNaturalSize.width
    const ih = imageNaturalSize.height
    if (!label || iw < 1 || ih < 1) {
      return { masks, polygons, rectangles }
    }
    const contourOpts = sam2PolygonContourOptions(diffusionPolygonVertexBias)
    for (const c of diffusionCandidates) {
      if (!isDiffusionCandidateAnnotatable(c, diffusionOutputFormat, iw, ih, contourOpts)) continue
      if (c.mask && c.mask.w === iw && c.mask.h === ih) {
        masks.push({ id: c.id, label, color, ...c.mask })
      }

      if (diffusionOutputFormat === "box") {
        const { x1, y1, x2, y2 } = c.bbox
        rectangles.push({ id: c.id, label, color, x1, y1, x2, y2 })
        continue
      }

      const ring = extractDiffusionPolygonRing(c, iw, ih, contourOpts)
      if (!ring) continue
      polygons.push({ id: c.id, label, color, imageRing: ring })
    }
    return { masks, polygons, rectangles }
  }, [
    diffusionCandidates,
    diffusionLabelColor,
    diffusionOutputFormat,
    diffusionPhase,
    diffusionPolygonVertexBias,
    diffusionSelectedLabel,
    imageNaturalSize.height,
    imageNaturalSize.width,
  ])

  const sam2DraftPreviewForRender = useMemo((): Sam2DraftPreviewPolygon | null => {
    if (!sam2DraftPreview?.polygon) return null
    const ring = sam2DraftPreview.polygon
    if (ring.length < 3) return null
    const label = sam2SelectedLabel.trim()
    return {
      label: label || "SAM2 预览",
      color: label ? (labelColorMap.get(label) ?? "#f59e0b") : "#f59e0b",
      imageRing: ring,
    }
  }, [labelColorMap, sam2DraftPreview, sam2SelectedLabel])

  const sam2HasCancelableRound = useMemo(
    () =>
      sam2AnnotatingActive && (sam2DraftPreview !== null || sam2Tool.sam2ManualPromptNonEmpty),
    [sam2AnnotatingActive, sam2DraftPreview, sam2Tool.sam2ManualPromptNonEmpty],
  )

  const resolveShapeIndexById = useCallback(
    (shapeId: string | null) => findShapeIndexByStableId(annotationDocRef.current, shapeId),
    [annotationDocRef],
  )

  const {
    renderedRectangles,
    renderedRotationRects,
    renderedPolygons,
    renderedRasterPreviews,
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
      sam2DraftPreviewPolygon: sam2DraftPreviewForRender,
      diffusionPreviewMasks: diffusionPreviewShapes.masks,
      diffusionPreviewPolygons: diffusionPreviewShapes.polygons,
      diffusionPreviewRectangles: diffusionPreviewShapes.rectangles,
    })

  const sam2ImageReadyForPrepare =
    !!activeImagePath.trim() && !isImageLoading && !imageLoadError && !!imageObjectUrl
  const sam2BlockPan = sam2AnnotatingActive && sam2ImageReadyForPrepare
  const diffusionBlockPan =
    diffusionAnnotatingActive &&
    diffusionPhase === "seed" &&
    !!activeImagePath.trim() &&
    !isImageLoading &&
    !imageLoadError &&
    !!imageObjectUrl

  const {
    canPanAndZoom,
    handleImageWheel,
    handleImageMouseDown,
    handleImageMouseMove,
    handleImageDoubleClick,
    endImagePan,
    handleStageClick,
    handleRectangleMouseDown,
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
    blockViewPanAndWheel: sam2BlockPan || diffusionBlockPan,
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
    totalFileCount,
    currentIndex,
    currentFileId: taskSessionState.currentFileId,
    setCurrentIndex,
    ensureFilesLoadedThroughIndex,
    deleteCurrentFile: handleDeleteCurrentImage,
    deleteCurrentAnnotation: handleDeleteCurrentAnnotation,
  })

  const handleImageElementLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    setIsImageLoading(false)
    setImageLoadError(false)
    setImageLoadingHint("图片解码完成")
    setImageNaturalSize({
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
    })
    if (stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
  }, [setImageLoadError, setImageLoadingHint, setIsImageLoading])

  useTaskShortcuts({
    rightToolMode,
    polygonDraftPointCount,
    selectedShapeId,
    hoveredShapeId,
    resolveShapeIndexById,
    clearPolygonDraft,
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
    goNextImage: () => {
      void taskSessionController.nextFile()
    },
    canRepeatNewAnnotation: annotationHabitPrimed,
    repeatNewAnnotation,
    dismissAiToolUi: dismissAiToolUiFromShortcut,
    sam2AnnotatingActive,
    sam2HasCancelableRound,
    cancelSam2Round,
    commitSam2DraftAndNew,
    tryResumeSam2AfterCommit,
    diffusionAnnotatingActive,
    diffusionPreviewActive: diffusionPhase === "preview" && diffusionCandidates.length > 0,
    commitDiffusionCandidates,
    tryResumeDiffusionAfterCommit,
  })

  const dragSessionUpdateShapePoints = useCallback(
    (shapeIndex: number, points: number[][], shouldPersist: boolean) => applyShapePatch(shapeIndex, points, { persist: shouldPersist }),
    [applyShapePatch],
  )

  useDragSessions({
    dragSession,
    imageNaturalSize,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    updateShapePoints: dragSessionUpdateShapePoints,
    setRawHighlightCorner,
    setDragLivePoints,
    setDragCuboidLivePoints,
    setDragVertexLive,
    setDragStageNudge,
    projectImageDeltaToStage,
  })

  const persistIfDirtyRef = useRef(persistIfDirty)
  useEffect(() => {
    persistIfDirtyRef.current = persistIfDirty
  }, [persistIfDirty])
  useEffect(() => {
    return () => {
      persistIfDirtyRef.current()
    }
  }, [])

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
    setImageLoadingHint,
    handleImageDecodeError,
    handleImageElementLoad,
    setRawHighlightCorner,
    setSelectedShape: (shapeId) => setSelectedShapeId(shapeId),
    handleRectangleMouseEnter,
    handleRectangleMouseLeave,
    handleRectangleMouseDown,
    handleRectangleClick,
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
    imageLoadingHint,
    imageObjectUrl,
    imageLoadError,
    currentFileName,
    canPanAndZoom,
    isPanning,
    canDrawRectangle,
    canDrawPolygon,
    canDrawBox3d,
    canDrawKeypoint,
    canDrawSkeleton,
    imageOffset,
    imageScale,
    annotationLineWidthScale: annotationAppearance.lineWidthScale,
    annotationPointSizeScale: annotationAppearance.pointSizeScale,
    imageFitScale: imageGeometry?.fitScale ?? 1,
    drawingLayerActive,
    renderedRasterPreviews,
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
    sam2DecodeBusy,
    sam2StagePoints: sam2Tool.sam2StagePoints,
    sam2PointPositiveColor: sam2Tool.sam2PointColors.positive,
    sam2PointNegativeColor: sam2Tool.sam2PointColors.negative,
    sam2PreviewRect: sam2Tool.sam2PreviewRect,
    sam2AutoPreviewRect: sam2Tool.sam2AutoPreviewRect,
    onSam2OverlayClick: sam2Tool.handleSam2OverlayClick,
    onSam2OverlayContextMenu: sam2Tool.handleSam2OverlayContextMenu,
    onSam2OverlayMouseMove: sam2Tool.handleSam2OverlayMouseMove,
    onSam2OverlayMouseLeave: sam2Tool.handleSam2OverlayMouseLeave,
    sam2Toast: diffusionAnnotatingActive ? diffusionToast : sam2Toast,
    onSam2ToastDismiss: () => {
      setDiffusionToast(null)
      setSam2Toast(null)
    },
    diffusionOverlayActive: diffusionTool.diffusionOverlayActive,
    diffusionSeedRect: diffusionTool.diffusionSeedRect,
    diffusionSeedRectCommitted: diffusionTool.diffusionSeedRectCommitted,
    diffusionSeedColor: diffusionTool.diffusionSeedColor,
    onDiffusionOverlayClick: diffusionTool.handleDiffusionOverlayClick,
    onDiffusionOverlayMouseMove: diffusionTool.handleDiffusionOverlayMouseMove,
    onDiffusionOverlayMouseLeave: diffusionTool.handleDiffusionOverlayMouseLeave,
    diffusionProcessRects: diffusionProcessStageRects,
  })

  const handleSelectToolFromPalette = useCallback(() => {
    clearBox3dDraft()
    handleSelectToolClick()
  }, [clearBox3dDraft, handleSelectToolClick])

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
    onSelectTool: handleSelectToolFromPalette,
    onStartRectTool: handleStartRectToolFromToolbar,
    onStartRotRectTool: handleStartRotRectToolFromToolbar,
    onStartPolygonTool: handleStartPolygonToolFromToolbar,
    onStartKeypointTool: handleStartKeypointToolFromToolbar,
    onStartBox3dTool: handleStartBox3dToolFromToolbar,
    onStartSkeletonTool: handleStartSkeletonToolFromToolbar,
    onClearSelection: clearSelectedShape,
    onRectPendingLabelChange: setRectPendingLabel,
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
      diffusionDialogOpen,
      onDiffusionDialogOpenChange: setDiffusionDialogOpen,
      diffusionSelectedLabel,
      onDiffusionSelectedLabelChange: setDiffusionSelectedLabel,
      diffusionInferScale,
      onDiffusionInferScaleChange: setDiffusionInferScale,
      diffusionSeedPreview,
      onDiffusionSeedPreviewChange: setDiffusionSeedPreview,
      diffusionOutputFormat,
      onDiffusionOutputFormatChange: setDiffusionOutputFormat,
      diffusionPolygonVertexBias,
      onDiffusionPolygonVertexBiasChange: setDiffusionPolygonVertexBias,
      diffusionSamRunning,
      diffusionSamRuntimeLabel,
      diffusionDinov2Running,
      diffusionDinov2RuntimeLabel,
      diffusionAnnotatingActive,
      diffusionPhase,
      diffusionBusy,
      diffusionSimilarityThreshold,
      onDiffusionSimilarityThresholdChange: setDiffusionSimilarityThreshold,
      diffusionMaxInstances,
      onDiffusionMaxInstancesChange: setDiffusionMaxInstances,
      diffusionShowProcessAnimation,
      onDiffusionShowProcessAnimationChange: diffusionProcessAnimationPrefs.setEnabled,
      onDiffusionPanelOk: handleDiffusionPanelOk,
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
        currentImageOneBased={currentImageOneBased}
        totalFileCount={totalFileCount}
        canGoPrev={taskSessionController.canGoPrev}
        canGoNext={taskSessionController.canGoNext}
        onPrevFile={taskSessionController.prevFile}
        onNextFile={() => {
          void taskSessionController.nextFile()
        }}
        onJumpToImage={taskSessionController.jumpToImageOneBased}
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

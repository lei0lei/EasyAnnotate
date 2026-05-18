/**
 * 模块：annotateTools/aiTools/task-ai-tool-palette
 * 职责：画布左侧浮动 AI 工具栏（插件式扩展入口）；SAM2、扩散式标注、占位跟踪。
 */
import { diffusionAiToolbarPrefs, trackingAiToolbarPrefs } from "@/lib/placeholder-ai-toolbar-prefs"
import { ToolButton } from "@/pages/project-task-detail/annotateTools/tool-button"
import { cn } from "@/lib/utils"
import { Scan, Sparkles, Video } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { DiffusionSegmentAnchorPanel } from "./diffusion-segment-anchor-panel"
import { PlaceholderAiAnchorPanel } from "./placeholder-ai-anchor-panel"
import { Sam2SegmentAnchorPanel } from "./sam2-segment-anchor-panel"
import type { TaskAiToolPaletteProps } from "./types"

const TRACKING_PANEL_COPY = {
  title: "跟踪标注",
  description: "能力规划中。时序与跟踪相关能力尚未接入；此处仅作入口占位。",
  configTo: "/models/annotation/tracking",
}

export function TaskAiToolPalette(props: TaskAiToolPaletteProps) {
  const {
    plainAnnotationLabels,
    sam2ToolbarEnabled,
    sam2DialogOpen,
    onSam2DialogOpenChange,
    sam2SelectedLabel,
    onSam2SelectedLabelChange,
    sam2PromptMode,
    onSam2PromptModeChange,
    sam2OutputFormat,
    onSam2OutputFormatChange,
    sam2PolygonVertexBias,
    onSam2PolygonVertexBiasChange,
    sam2AutoPromptEnabled,
    onSam2AutoPromptEnabledChange,
    sam2AutoObjectBoxW,
    onSam2AutoObjectBoxWChange,
    sam2AutoObjectBoxH,
    onSam2AutoObjectBoxHChange,
    sam2AutoIouThreshold,
    onSam2AutoIouThresholdChange,
    sam2AutoHoverFactor,
    onSam2AutoHoverFactorChange,
    sam2InferScale,
    onSam2InferScaleChange,
    activeSamRuntime,
    onSam2Confirm,
    diffusionDialogOpen,
    onDiffusionDialogOpenChange,
    diffusionSelectedLabel,
    onDiffusionSelectedLabelChange,
    diffusionInferScale,
    onDiffusionInferScaleChange,
    diffusionSeedPreview,
    onDiffusionSeedPreviewChange,
    diffusionOutputFormat,
    onDiffusionOutputFormatChange,
    diffusionPolygonVertexBias,
    onDiffusionPolygonVertexBiasChange,
    diffusionSamRunning,
    diffusionSamRuntimeLabel,
    diffusionDinov2Running,
    diffusionDinov2RuntimeLabel,
    diffusionAnnotatingActive,
    diffusionPhase,
    diffusionBusy,
    diffusionSimilarityThreshold,
    onDiffusionSimilarityThresholdChange,
    diffusionMaxInstances,
    onDiffusionMaxInstancesChange,
    onDiffusionPanelOk,
  } = props

  const diffusionToolbarEnabled = useSyncExternalStore(
    diffusionAiToolbarPrefs.subscribe,
    () => diffusionAiToolbarPrefs.getEnabled(),
    () => false,
  )
  const trackingToolbarEnabled = useSyncExternalStore(
    trackingAiToolbarPrefs.subscribe,
    () => trackingAiToolbarPrefs.getEnabled(),
    () => false,
  )

  const anyAiToolbarVisible =
    diffusionToolbarEnabled || trackingToolbarEnabled || sam2ToolbarEnabled

  const toolbarShellRef = useRef<HTMLDivElement | null>(null)
  const refSam2 = useRef<HTMLDivElement | null>(null)
  const refDiffusion = useRef<HTMLDivElement | null>(null)
  const refTracking = useRef<HTMLDivElement | null>(null)

  const [trackingPanelOpen, setTrackingPanelOpen] = useState(false)

  const getSam2Anchor = useCallback((): HTMLElement | null => refSam2.current, [])
  const getDiffusionAnchor = useCallback((): HTMLElement | null => refDiffusion.current, [])
  const getTrackingAnchor = useCallback((): HTMLElement | null => refTracking.current, [])

  const toggleSam2 = useCallback(() => {
    setTrackingPanelOpen(false)
    onDiffusionDialogOpenChange(false)
    onSam2DialogOpenChange(!sam2DialogOpen)
  }, [onDiffusionDialogOpenChange, onSam2DialogOpenChange, sam2DialogOpen])

  const toggleDiffusion = useCallback(() => {
    onSam2DialogOpenChange(false)
    setTrackingPanelOpen(false)
    onDiffusionDialogOpenChange(!diffusionDialogOpen)
  }, [onDiffusionDialogOpenChange, diffusionDialogOpen, onSam2DialogOpenChange])

  const toggleTracking = useCallback(() => {
    onSam2DialogOpenChange(false)
    onDiffusionDialogOpenChange(false)
    setTrackingPanelOpen((cur) => !cur)
  }, [onDiffusionDialogOpenChange, onSam2DialogOpenChange])

  useEffect(() => {
    if (!anyAiToolbarVisible) {
      setTrackingPanelOpen(false)
      onDiffusionDialogOpenChange(false)
    }
  }, [anyAiToolbarVisible, onDiffusionDialogOpenChange])

  useEffect(() => {
    if (!sam2ToolbarEnabled) onSam2DialogOpenChange(false)
  }, [sam2ToolbarEnabled, onSam2DialogOpenChange])

  useEffect(() => {
    if (!diffusionToolbarEnabled) onDiffusionDialogOpenChange(false)
  }, [diffusionToolbarEnabled, onDiffusionDialogOpenChange])

  useEffect(() => {
    const sam2Open = sam2ToolbarEnabled && sam2DialogOpen
    const diffusionOpen = diffusionToolbarEnabled && diffusionDialogOpen
    const trackingOpen = trackingPanelOpen
    if (!sam2Open && !diffusionOpen && !trackingOpen) return
    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (toolbarShellRef.current?.contains(target)) return
      if (sam2Open) {
        const panel = document.querySelector("[data-ea-sam2-picker-panel]")
        if (panel?.contains(target)) return
        onSam2DialogOpenChange(false)
      }
      if (diffusionOpen) {
        const panel = document.querySelector("[data-ea-diffusion-picker-panel]")
        if (panel?.contains(target)) return
        onDiffusionDialogOpenChange(false)
      }
      if (trackingOpen) {
        const ph = document.querySelector("[data-ea-placeholder-ai-picker-panel]")
        if (ph?.contains(target)) return
        setTrackingPanelOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDownCapture, true)
    return () => document.removeEventListener("pointerdown", onPointerDownCapture, true)
  }, [
    sam2ToolbarEnabled,
    sam2DialogOpen,
    diffusionToolbarEnabled,
    diffusionDialogOpen,
    trackingPanelOpen,
    onSam2DialogOpenChange,
    onDiffusionDialogOpenChange,
  ])

  return (
    <>
      {anyAiToolbarVisible ? (
        <div
          ref={toolbarShellRef}
          className={cn("absolute top-1/2 left-4 z-50 -translate-y-1/2")}
          data-ea-task-ai-tool-palette=""
        >
          <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-background/95 p-2 shadow-sm">
            {sam2ToolbarEnabled ? (
              <div ref={refSam2} className="inline-flex">
                <ToolButton
                  active={sam2DialogOpen}
                  ariaLabel="SAM2 自动标注"
                  title="SAM2 自动标注"
                  onClick={toggleSam2}
                >
                  <Scan className="h-4 w-4" aria-hidden />
                </ToolButton>
              </div>
            ) : null}
            {diffusionToolbarEnabled ? (
              <div ref={refDiffusion} className="inline-flex">
                <ToolButton
                  active={diffusionDialogOpen}
                  ariaLabel="扩散式标注"
                  title="扩散式标注"
                  onClick={toggleDiffusion}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                </ToolButton>
              </div>
            ) : null}
            {trackingToolbarEnabled ? (
              <div ref={refTracking} className="inline-flex">
                <ToolButton
                  active={trackingPanelOpen}
                  ariaLabel="跟踪标注（占位）"
                  title="跟踪标注"
                  onClick={toggleTracking}
                >
                  <Video className="h-4 w-4" aria-hidden />
                </ToolButton>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <Sam2SegmentAnchorPanel
        open={sam2ToolbarEnabled && sam2DialogOpen}
        getAnchor={getSam2Anchor}
        labels={plainAnnotationLabels}
        selectedLabel={sam2SelectedLabel}
        onSelectedLabelChange={onSam2SelectedLabelChange}
        promptMode={sam2PromptMode}
        onPromptModeChange={onSam2PromptModeChange}
        outputFormat={sam2OutputFormat}
        onOutputFormatChange={onSam2OutputFormatChange}
        polygonVertexBias={sam2PolygonVertexBias}
        onPolygonVertexBiasChange={onSam2PolygonVertexBiasChange}
        autoPromptEnabled={sam2AutoPromptEnabled}
        onAutoPromptEnabledChange={onSam2AutoPromptEnabledChange}
        autoObjectBoxW={sam2AutoObjectBoxW}
        onAutoObjectBoxWChange={onSam2AutoObjectBoxWChange}
        autoObjectBoxH={sam2AutoObjectBoxH}
        onAutoObjectBoxHChange={onSam2AutoObjectBoxHChange}
        autoIouThreshold={sam2AutoIouThreshold}
        onAutoIouThresholdChange={onSam2AutoIouThresholdChange}
        autoHoverFactor={sam2AutoHoverFactor}
        onAutoHoverFactorChange={onSam2AutoHoverFactorChange}
        inferScale={sam2InferScale}
        onInferScaleChange={onSam2InferScaleChange}
        activeSamRuntime={activeSamRuntime}
        onCancel={() => onSam2DialogOpenChange(false)}
        onConfirm={() => {
          onSam2Confirm()
          onSam2DialogOpenChange(false)
        }}
      />

      <DiffusionSegmentAnchorPanel
        open={diffusionToolbarEnabled && diffusionDialogOpen}
        getAnchor={getDiffusionAnchor}
        labels={plainAnnotationLabels}
        selectedLabel={diffusionSelectedLabel}
        onSelectedLabelChange={onDiffusionSelectedLabelChange}
        inferScale={diffusionInferScale}
        onInferScaleChange={onDiffusionInferScaleChange}
        seedPreview={diffusionSeedPreview}
        onSeedPreviewChange={onDiffusionSeedPreviewChange}
        outputFormat={diffusionOutputFormat}
        onOutputFormatChange={onDiffusionOutputFormatChange}
        polygonVertexBias={diffusionPolygonVertexBias}
        onPolygonVertexBiasChange={onDiffusionPolygonVertexBiasChange}
        diffusionSamRunning={diffusionSamRunning}
        diffusionSamRuntimeLabel={diffusionSamRuntimeLabel}
        diffusionDinov2Running={diffusionDinov2Running}
        diffusionDinov2RuntimeLabel={diffusionDinov2RuntimeLabel}
        diffusionAnnotatingActive={diffusionAnnotatingActive}
        diffusionPhase={diffusionPhase}
        diffusionBusy={diffusionBusy}
        similarityThreshold={diffusionSimilarityThreshold}
        onSimilarityThresholdChange={onDiffusionSimilarityThresholdChange}
        maxInstances={diffusionMaxInstances}
        onMaxInstancesChange={onDiffusionMaxInstancesChange}
        onCancel={() => onDiffusionDialogOpenChange(false)}
        onPanelOk={onDiffusionPanelOk}
      />

      {trackingPanelOpen ? (
        <PlaceholderAiAnchorPanel
          open
          title={TRACKING_PANEL_COPY.title}
          description={TRACKING_PANEL_COPY.description}
          configTo={TRACKING_PANEL_COPY.configTo}
          getAnchor={getTrackingAnchor}
          onClose={() => setTrackingPanelOpen(false)}
        />
      ) : null}
    </>
  )
}

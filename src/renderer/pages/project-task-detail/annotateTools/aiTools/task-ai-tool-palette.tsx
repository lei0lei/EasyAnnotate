/**
 * 模块：annotateTools/aiTools/task-ai-tool-palette
 * 职责：画布左侧浮动 AI 工具栏（插件式扩展入口）；占位按钮 + SAM2。
 */
import { diffusionAiToolbarPrefs, trackingAiToolbarPrefs } from "@/lib/placeholder-ai-toolbar-prefs"
import { ToolButton } from "@/pages/project-task-detail/annotateTools/tool-button"
import { cn } from "@/lib/utils"
import { Scan, Sparkles, Video } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { PlaceholderAiAnchorPanel } from "./placeholder-ai-anchor-panel"
import { Sam2SegmentAnchorPanel } from "./sam2-segment-anchor-panel"
import type { TaskAiToolPaletteProps } from "./types"

type PlaceholderPanelId = "diffusion" | "tracking"

const PLACEHOLDER_PANEL_COPY: Record<
  PlaceholderPanelId,
  { title: string; description: string; configTo: string }
> = {
  diffusion: {
    title: "扩散式标注",
    description:
      "能力规划中。可在「模型 → 自动标注工具」中启用或关闭工具栏显示，并打开完整配置页。",
    configTo: "/models/annotation/diffusion",
  },
  tracking: {
    title: "跟踪标注",
    description: "能力规划中。时序与跟踪相关能力尚未接入；此处仅作入口占位。",
    configTo: "/models/annotation/tracking",
  },
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

  const [placeholderPanel, setPlaceholderPanel] = useState<PlaceholderPanelId | null>(null)

  const getSam2Anchor = useCallback((): HTMLElement | null => refSam2.current, [])
  const getDiffusionAnchor = useCallback((): HTMLElement | null => refDiffusion.current, [])
  const getTrackingAnchor = useCallback((): HTMLElement | null => refTracking.current, [])

  const toggleSam2 = useCallback(() => {
    setPlaceholderPanel(null)
    onSam2DialogOpenChange(!sam2DialogOpen)
  }, [onSam2DialogOpenChange, sam2DialogOpen])

  const togglePlaceholder = useCallback((id: PlaceholderPanelId) => {
    onSam2DialogOpenChange(false)
    setPlaceholderPanel((cur) => (cur === id ? null : id))
  }, [onSam2DialogOpenChange])

  useEffect(() => {
    if (!anyAiToolbarVisible) setPlaceholderPanel(null)
  }, [anyAiToolbarVisible])

  useEffect(() => {
    if (!sam2ToolbarEnabled) onSam2DialogOpenChange(false)
  }, [sam2ToolbarEnabled, onSam2DialogOpenChange])

  useEffect(() => {
    const sam2Open = sam2ToolbarEnabled && sam2DialogOpen
    const phOpen = placeholderPanel !== null
    if (!sam2Open && !phOpen) return
    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (toolbarShellRef.current?.contains(target)) return
      if (sam2Open) {
        const panel = document.querySelector("[data-ea-sam2-picker-panel]")
        if (panel?.contains(target)) return
        onSam2DialogOpenChange(false)
      }
      if (phOpen) {
        const ph = document.querySelector("[data-ea-placeholder-ai-picker-panel]")
        if (ph?.contains(target)) return
        setPlaceholderPanel(null)
      }
    }
    document.addEventListener("pointerdown", onPointerDownCapture, true)
    return () => document.removeEventListener("pointerdown", onPointerDownCapture, true)
  }, [sam2ToolbarEnabled, sam2DialogOpen, placeholderPanel, onSam2DialogOpenChange])

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
                  active={placeholderPanel === "diffusion"}
                  ariaLabel="扩散式标注（占位）"
                  title="扩散式标注"
                  onClick={() => togglePlaceholder("diffusion")}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                </ToolButton>
              </div>
            ) : null}
            {trackingToolbarEnabled ? (
              <div ref={refTracking} className="inline-flex">
                <ToolButton
                  active={placeholderPanel === "tracking"}
                  ariaLabel="跟踪标注（占位）"
                  title="跟踪标注"
                  onClick={() => togglePlaceholder("tracking")}
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

      {placeholderPanel === "diffusion" ? (
        <PlaceholderAiAnchorPanel
          open
          title={PLACEHOLDER_PANEL_COPY.diffusion.title}
          description={PLACEHOLDER_PANEL_COPY.diffusion.description}
          configTo={PLACEHOLDER_PANEL_COPY.diffusion.configTo}
          getAnchor={getDiffusionAnchor}
          onClose={() => setPlaceholderPanel(null)}
        />
      ) : null}
      {placeholderPanel === "tracking" ? (
        <PlaceholderAiAnchorPanel
          open
          title={PLACEHOLDER_PANEL_COPY.tracking.title}
          description={PLACEHOLDER_PANEL_COPY.tracking.description}
          configTo={PLACEHOLDER_PANEL_COPY.tracking.configTo}
          getAnchor={getTrackingAnchor}
          onClose={() => setPlaceholderPanel(null)}
        />
      ) : null}
    </>
  )
}

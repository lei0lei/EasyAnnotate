/**
 * 模块：annotateTools/aiTools/task-ai-tool-palette
 * 职责：画布左侧浮动 AI 工具栏（插件式扩展入口）；占位按钮 + SAM2。
 */
import { ToolButton } from "@/pages/project-task-detail/annotateTools/tool-button"
import { cn } from "@/lib/utils"
import { Box, Cpu, Scan, Sparkles } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { Sam2SegmentAnchorPanel } from "./sam2-segment-anchor-panel"
import type { TaskAiToolPaletteProps } from "./types"

export function TaskAiToolPalette(props: TaskAiToolPaletteProps) {
  const {
    plainAnnotationLabels,
    sam2DialogOpen,
    onSam2DialogOpenChange,
    sam2SelectedLabel,
    onSam2SelectedLabelChange,
    sam2OutputFormat,
    onSam2OutputFormatChange,
  } = props

  const toolbarShellRef = useRef<HTMLDivElement | null>(null)
  const refSam2 = useRef<HTMLDivElement | null>(null)

  const getSam2Anchor = useCallback((): HTMLElement | null => refSam2.current, [])

  useEffect(() => {
    if (!sam2DialogOpen) return
    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (toolbarShellRef.current?.contains(target)) return
      const panel = document.querySelector("[data-ea-sam2-picker-panel]")
      if (panel?.contains(target)) return
      onSam2DialogOpenChange(false)
    }
    document.addEventListener("pointerdown", onPointerDownCapture, true)
    return () => document.removeEventListener("pointerdown", onPointerDownCapture, true)
  }, [sam2DialogOpen, onSam2DialogOpenChange])

  return (
    <>
      <div
        ref={toolbarShellRef}
        className={cn("absolute top-1/2 left-4 z-50 -translate-y-1/2")}
        data-ea-task-ai-tool-palette=""
      >
        <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-background/95 p-2 shadow-sm">
          <ToolButton
            active={false}
            ariaLabel="预留 AI 工具"
            title="预留（敬请期待）"
            onClick={() => {}}
          >
            <Sparkles className="h-4 w-4 opacity-60" aria-hidden />
          </ToolButton>
          <ToolButton
            active={false}
            ariaLabel="预留 AI 工具"
            title="预留（敬请期待）"
            onClick={() => {}}
          >
            <Cpu className="h-4 w-4 opacity-60" aria-hidden />
          </ToolButton>
          <div ref={refSam2} className="inline-flex">
            <ToolButton
              active={sam2DialogOpen}
              ariaLabel="SAM2 分割"
              title="SAM2 分割"
              onClick={() => onSam2DialogOpenChange(!sam2DialogOpen)}
            >
              <Scan className="h-4 w-4" aria-hidden />
            </ToolButton>
          </div>
          <ToolButton
            active={false}
            ariaLabel="预留 AI 工具"
            title="预留（敬请期待）"
            onClick={() => {}}
          >
            <Box className="h-4 w-4 opacity-60" aria-hidden />
          </ToolButton>
        </div>
      </div>

      <Sam2SegmentAnchorPanel
        open={sam2DialogOpen}
        getAnchor={getSam2Anchor}
        labels={plainAnnotationLabels}
        selectedLabel={sam2SelectedLabel}
        onSelectedLabelChange={onSam2SelectedLabelChange}
        outputFormat={sam2OutputFormat}
        onOutputFormatChange={onSam2OutputFormatChange}
        onCancel={() => onSam2DialogOpenChange(false)}
        onConfirm={() => onSam2DialogOpenChange(false)}
      />
    </>
  )
}

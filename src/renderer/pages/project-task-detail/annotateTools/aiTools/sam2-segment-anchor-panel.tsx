/**
 * 模块：annotateTools/aiTools/sam2-segment-anchor-panel
 * 职责：SAM2 选项浮动面板，锚定在左侧 AI 工具按钮旁（与右侧 TaskRectLabelPicker 同类交互）。
 */
import { cn } from "@/lib/utils"
import { createPortal } from "react-dom"
import { useLayoutEffect, useState, type CSSProperties } from "react"
import type { Sam2AutoAnnotationFormat, Sam2PromptMode } from "./types"

const SAM2_PANEL_WIDTH_PX = 288

function getFallbackSam2PickerFixedPos(): { top: number; left: number } {
  if (typeof window === "undefined") return { top: 0, left: 0 }
  return {
    top: window.innerHeight / 2,
    left: 8 + 48,
  }
}

/** 工具栏在画布左侧：面板优先出现在按钮右侧，空间不足则翻到左侧 */
function computeSam2PickerPosFromAnchorEl(el: HTMLElement): { top: number; left: number } {
  const w = SAM2_PANEL_WIDTH_PX
  const gap = 8
  const anchor = el.getBoundingClientRect()
  let left = anchor.right + gap
  if (left + w > window.innerWidth - 8) {
    left = anchor.left - gap - w
  }
  if (left < 8) {
    left = Math.max(8, window.innerWidth - w - 8)
  }
  const top = anchor.top + anchor.height / 2
  return { top, left }
}

export type Sam2SegmentAnchorPanelProps = {
  open: boolean
  labels: string[]
  selectedLabel: string
  onSelectedLabelChange: (label: string) => void
  promptMode: Sam2PromptMode
  onPromptModeChange: (mode: Sam2PromptMode) => void
  outputFormat: Sam2AutoAnnotationFormat
  onOutputFormatChange: (format: Sam2AutoAnnotationFormat) => void
  polygonVertexBias: number
  onPolygonVertexBiasChange: (value: number) => void
  autoPromptEnabled: boolean
  onAutoPromptEnabledChange: (enabled: boolean) => void
  autoObjectBoxW: number
  onAutoObjectBoxWChange: (value: number) => void
  autoObjectBoxH: number
  onAutoObjectBoxHChange: (value: number) => void
  autoIouThreshold: number
  onAutoIouThresholdChange: (value: number) => void
  autoHoverFactor: number
  onAutoHoverFactorChange: (value: number) => void
  inferScale: number
  onInferScaleChange: (value: number) => void
  activeSamRuntime: { label: string; running: boolean } | null
  onCancel: () => void
  onConfirm: () => void
  getAnchor: () => HTMLElement | null
}

export function Sam2SegmentAnchorPanel({
  open,
  labels,
  selectedLabel,
  onSelectedLabelChange,
  promptMode,
  onPromptModeChange,
  outputFormat,
  onOutputFormatChange,
  polygonVertexBias,
  onPolygonVertexBiasChange,
  autoPromptEnabled,
  onAutoPromptEnabledChange,
  autoObjectBoxW,
  onAutoObjectBoxWChange,
  autoObjectBoxH,
  onAutoObjectBoxHChange,
  autoIouThreshold,
  onAutoIouThresholdChange,
  autoHoverFactor,
  onAutoHoverFactorChange,
  inferScale,
  onInferScaleChange,
  activeSamRuntime,
  onCancel,
  onConfirm,
  getAnchor,
}: Sam2SegmentAnchorPanelProps) {
  const [anchoredPos, setAnchoredPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAnchoredPos(null)
      return
    }
    const run = () => {
      const el = getAnchor()
      if (el) {
        setAnchoredPos(computeSam2PickerPosFromAnchorEl(el))
      } else {
        setAnchoredPos(getFallbackSam2PickerFixedPos())
      }
    }
    run()
    const t0 = window.setTimeout(run, 0)
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => run())
    })
    window.addEventListener("resize", run)
    return () => {
      window.removeEventListener("resize", run)
      window.clearTimeout(t0)
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [open, getAnchor])

  if (!open) return null

  const fixedPos = anchoredPos ?? getFallbackSam2PickerFixedPos()
  const positionStyle: CSSProperties = {
    top: fixedPos.top,
    left: fixedPos.left,
    transform: "translateY(-50%)",
  }

  const panel = (
    <div
      role="dialog"
      aria-label="SAM 自动标注选项"
      className="fixed z-[200] w-72 rounded-md border border-border bg-background/95 p-3 shadow-md"
      style={positionStyle}
      data-ea-sam2-picker-panel=""
    >
      {labels.length > 0 ? (
        <select
          className="h-8 w-full rounded border border-border bg-background px-2 text-sm"
          value={selectedLabel}
          onChange={(event) => onSelectedLabelChange(event.target.value)}
        >
          {labels.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <div
          className="h-8 rounded border border-dashed border-border/80 bg-muted/30"
          aria-label="暂无可用标签"
        />
      )}

      <div className="mt-3 space-y-1 border-t border-border/70 pt-2">
        <div className="text-[11px] text-muted-foreground">当前推理</div>
        {activeSamRuntime?.running ? (
          <p className="text-sm font-medium text-foreground">{activeSamRuntime.label}</p>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            未启动。请先在「模型 → 自动标注 → SAM 标注」中启动推理实例。
          </p>
        )}
      </div>

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="text-[11px] text-muted-foreground">Prompt 类型</div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center justify-center rounded border px-1 text-xs",
              promptMode === "point"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onPromptModeChange("point")}
          >
            点
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center justify-center rounded border px-1 text-xs",
              promptMode === "bbox"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onPromptModeChange("bbox")}
          >
            矩形框
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>推理图像缩放</span>
          <span className="tabular-nums text-foreground/85">{inferScale.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={30}
          max={100}
          step={5}
          value={Math.round(inferScale * 100)}
          onChange={(e) => onInferScaleChange(Number(e.target.value) / 100)}
          className="h-2 w-full cursor-pointer accent-emerald-600"
          aria-label="SAM2 编码与解码使用的相对原图边长倍率，约 0.3 到 1"
        />
      </div>

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">自动 prompt（悬停）</div>
          <button
            type="button"
            aria-pressed={autoPromptEnabled}
            className={cn(
              "inline-flex h-7 min-w-[3rem] items-center justify-center rounded border px-2 text-xs",
              autoPromptEnabled
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onAutoPromptEnabledChange(!autoPromptEnabled)}
          >
            {autoPromptEnabled ? "开" : "关"}
          </button>
        </div>
        {autoPromptEnabled ? (
          <div className="space-y-2.5">
            {promptMode === "bbox" && autoPromptEnabled ? (
              <>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>物体框宽（px）</span>
                    <span className="tabular-nums text-foreground/85">{autoObjectBoxW}</span>
                  </div>
                  <input
                    type="range"
                    min={16}
                    max={512}
                    step={2}
                    value={autoObjectBoxW}
                    onChange={(e) => onAutoObjectBoxWChange(Number(e.target.value))}
                    className="h-2 w-full cursor-pointer accent-emerald-600"
                    aria-label="自动 prompt 物体框宽度"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>物体框高（px）</span>
                    <span className="tabular-nums text-foreground/85">{autoObjectBoxH}</span>
                  </div>
                  <input
                    type="range"
                    min={16}
                    max={512}
                    step={2}
                    value={autoObjectBoxH}
                    onChange={(e) => onAutoObjectBoxHChange(Number(e.target.value))}
                    className="h-2 w-full cursor-pointer accent-emerald-600"
                    aria-label="自动 prompt 物体框高度"
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>预测 IoU 下限</span>
                <span className="tabular-nums text-foreground/85">{autoIouThreshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(autoIouThreshold * 100)}
                onChange={(e) => onAutoIouThresholdChange(Number(e.target.value) / 100)}
                className="h-2 w-full cursor-pointer accent-emerald-600"
                aria-label="低于该预测 IoU 则视为无目标（decoder 未导出 IoU 时不生效）"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>悬停时间倍率</span>
                <span className="tabular-nums text-foreground/85">{autoHoverFactor.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={30}
                max={150}
                step={5}
                value={Math.round(autoHoverFactor * 100)}
                onChange={(e) => onAutoHoverFactorChange(Number(e.target.value) / 100)}
                className="h-2 w-full cursor-pointer accent-emerald-600"
                aria-label="悬停触发时间倍率，约 0.3 到 1.5"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="text-[11px] text-muted-foreground">输出类型</div>
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              outputFormat === "polygon"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onOutputFormatChange("polygon")}
          >
            <span>多边形</span>
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              outputFormat === "mask"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onOutputFormatChange("mask")}
          >
            <span>掩码</span>
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              outputFormat === "box"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onOutputFormatChange("box")}
          >
            Bbox
          </button>
        </div>
        {outputFormat === "polygon" ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>顶点密度</span>
              <span className="tabular-nums text-foreground/85" aria-live="polite">
                {polygonVertexBias}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={polygonVertexBias}
              onChange={(e) => onPolygonVertexBiasChange(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-emerald-600"
              aria-label="多边形顶点：左侧较少，右侧较多"
            />
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="inline-flex h-7 items-center rounded border border-border px-2 text-xs hover:bg-accent"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          disabled={!selectedLabel.trim() || labels.length === 0 || !activeSamRuntime?.running}
          className="inline-flex h-7 items-center rounded border border-emerald-500/40 px-2 text-xs text-emerald-600 hover:bg-emerald-500/10 disabled:pointer-events-none disabled:opacity-40"
          onClick={onConfirm}
        >
          OK
        </button>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}

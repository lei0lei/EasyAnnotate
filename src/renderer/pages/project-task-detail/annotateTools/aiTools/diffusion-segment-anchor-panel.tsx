/**
 * 模块：annotateTools/aiTools/diffusion-segment-anchor-panel
 * 职责：扩散式标注选项浮动面板（界面）；锚定在左侧 AI 工具按钮旁。
 */
import { getPrimaryShortcutLabel } from "@/lib/app-shortcut-registry"
import { cn } from "@/lib/utils"
import { createPortal } from "react-dom"
import { useLayoutEffect, useState, type CSSProperties } from "react"
import type { DiffusionSeedSamPreviewMode, Sam2AutoAnnotationFormat } from "./types"

const DIFFUSION_PANEL_WIDTH_PX = 288

function getFallbackDiffusionPickerFixedPos(): { top: number; left: number } {
  if (typeof window === "undefined") return { top: 0, left: 0 }
  return {
    top: window.innerHeight / 2,
    left: 8 + 48,
  }
}

function computeDiffusionPickerPosFromAnchorEl(el: HTMLElement): { top: number; left: number } {
  const w = DIFFUSION_PANEL_WIDTH_PX
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

export type DiffusionSegmentAnchorPanelProps = {
  open: boolean
  labels: string[]
  selectedLabel: string
  onSelectedLabelChange: (label: string) => void
  inferScale: number
  onInferScaleChange: (value: number) => void
  seedPreview: DiffusionSeedSamPreviewMode
  onSeedPreviewChange: (mode: DiffusionSeedSamPreviewMode) => void
  outputFormat: Sam2AutoAnnotationFormat
  onOutputFormatChange: (format: Sam2AutoAnnotationFormat) => void
  polygonVertexBias: number
  onPolygonVertexBiasChange: (value: number) => void
  diffusionSamRunning: boolean
  diffusionSamRuntimeLabel: string
  diffusionDinov2Running: boolean
  diffusionDinov2RuntimeLabel: string
  diffusionAnnotatingActive: boolean
  diffusionPhase: "seed" | "searching" | "preview"
  diffusionBusy: boolean
  similarityThreshold: number
  onSimilarityThresholdChange: (value: number) => void
  maxInstances: number
  onMaxInstancesChange: (value: number) => void
  onCancel: () => void
  onPanelOk: () => void
  getAnchor: () => HTMLElement | null
}

export function DiffusionSegmentAnchorPanel({
  open,
  labels,
  selectedLabel,
  onSelectedLabelChange,
  inferScale,
  onInferScaleChange,
  seedPreview,
  onSeedPreviewChange,
  outputFormat,
  onOutputFormatChange,
  polygonVertexBias,
  onPolygonVertexBiasChange,
  diffusionSamRunning,
  diffusionSamRuntimeLabel,
  diffusionDinov2Running,
  diffusionDinov2RuntimeLabel,
  diffusionAnnotatingActive,
  diffusionPhase,
  diffusionBusy,
  similarityThreshold,
  onSimilarityThresholdChange,
  maxInstances,
  onMaxInstancesChange,
  onCancel,
  onPanelOk,
  getAnchor,
}: DiffusionSegmentAnchorPanelProps) {
  const newAnnKey = getPrimaryShortcutLabel("new-annotation")
  const selectToolKey = getPrimaryShortcutLabel("select-tool")
  const [anchoredPos, setAnchoredPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAnchoredPos(null)
      return
    }
    const run = () => {
      const el = getAnchor()
      if (el) {
        setAnchoredPos(computeDiffusionPickerPosFromAnchorEl(el))
      } else {
        setAnchoredPos(getFallbackDiffusionPickerFixedPos())
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

  const fixedPos = anchoredPos ?? getFallbackDiffusionPickerFixedPos()
  const positionStyle: CSSProperties = {
    top: fixedPos.top,
    left: fixedPos.left,
    transform: "translateY(-50%)",
  }

  const backendsReady = diffusionSamRunning && diffusionDinov2Running

  const panel = (
    <div
      role="dialog"
      aria-label="扩散式标注选项"
      className="fixed z-[200] w-72 rounded-md border border-border bg-background/95 p-3 shadow-md"
      style={positionStyle}
      data-ea-diffusion-picker-panel=""
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
        <div className="text-[11px] text-muted-foreground">后端推理</div>
        {!backendsReady ? (
          <p className="text-xs leading-snug text-amber-800 dark:text-amber-200">
            请先在「模型 → 后端模型管理」中启动全局
            <span className="font-medium"> SAM </span>与
            <span className="font-medium"> DINOv2 </span>
            推理实例后再开始标注。
          </p>
        ) : (
          <div className="space-y-1 text-xs text-foreground">
            <p>
              <span className="text-muted-foreground">SAM：</span>
              <span className="font-medium">{diffusionSamRuntimeLabel || "已运行"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">DINOv2：</span>
              <span className="font-medium">{diffusionDinov2RuntimeLabel || "已运行"}</span>
            </p>
          </div>
        )}
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
          className="h-2 w-full cursor-pointer accent-violet-600"
          aria-label="扩散 SAM 编码与解码使用的相对原图边长倍率，约 0.3 到 1"
        />
      </div>

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="text-[11px] text-muted-foreground">SAM 初步输出（种子）</div>
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              seedPreview === "bbox"
                ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onSeedPreviewChange("bbox")}
          >
            框
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              seedPreview === "mask"
                ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onSeedPreviewChange("mask")}
          >
            掩码
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[10px] leading-tight",
              seedPreview === "bbox_and_mask"
                ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onSeedPreviewChange("bbox_and_mask")}
          >
            框+掩码
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="text-[11px] text-muted-foreground">相似搜索</div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>相似度阈值</span>
          <span className="tabular-nums text-foreground/85">{similarityThreshold.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(similarityThreshold * 100)}
          onChange={(e) => onSimilarityThresholdChange(Number(e.target.value) / 100)}
          className="h-2 w-full cursor-pointer accent-violet-600"
          aria-label="DINOv2 余弦相似度阈值（0–1）"
        />
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>最多实例</span>
          <span className="tabular-nums text-foreground/85">{maxInstances}</span>
        </div>
        <input
          type="range"
          min={1}
          max={32}
          step={1}
          value={maxInstances}
          onChange={(e) => onMaxInstancesChange(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-violet-600"
          aria-label="相似候选数量上限（1–32）"
        />
      </div>

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="text-[11px] text-muted-foreground">输出类型</div>
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              outputFormat === "polygon"
                ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onOutputFormatChange("polygon")}
          >
            多边形
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              outputFormat === "mask"
                ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onOutputFormatChange("mask")}
          >
            掩码
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-7 items-center justify-center rounded border px-0.5 py-1 text-[11px] leading-tight",
              outputFormat === "box"
                ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
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
              className="h-2 w-full cursor-pointer accent-violet-600"
              aria-label="多边形顶点：左侧较少，右侧较多"
            />
          </div>
        ) : null}
      </div>

      {diffusionAnnotatingActive ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {diffusionPhase === "seed"
            ? "在画布上拖拽种子框，画完后将自动搜索（此时尚未进行 SAM 编码）。"
            : diffusionPhase === "searching"
              ? "正在编码、搜索并精化，请稍候…"
              : `SAM 精化预览已显示；按 ${newAnnKey} 新建全部实例，${selectToolKey} 退出工具。`}
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          配置完成后点 OK，再在画布上画种子框即可自动搜索。
        </p>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="inline-flex h-7 items-center rounded border border-border px-2 text-xs hover:bg-accent"
          onClick={onCancel}
        >
          取消
        </button>
        {!diffusionAnnotatingActive ? (
          <button
            type="button"
            disabled={
              diffusionBusy || !selectedLabel.trim() || labels.length === 0 || !backendsReady
            }
            className="inline-flex h-7 items-center rounded border border-violet-500/40 px-2 text-xs text-violet-700 hover:bg-violet-500/10 disabled:pointer-events-none disabled:opacity-40 dark:text-violet-300"
            onClick={onPanelOk}
          >
            OK
          </button>
        ) : null}
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}

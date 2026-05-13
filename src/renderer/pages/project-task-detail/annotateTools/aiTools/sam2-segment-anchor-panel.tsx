/**
 * 模块：annotateTools/aiTools/sam2-segment-anchor-panel
 * 职责：SAM2 选项浮动面板，锚定在左侧 AI 工具按钮旁（与右侧 TaskRectLabelPicker 同类交互）。
 */
import { cn } from "@/lib/utils"
import { createPortal } from "react-dom"
import { useLayoutEffect, useState, type CSSProperties } from "react"
import type { Sam2AutoAnnotationFormat } from "./types"

const SAM2_PANEL_WIDTH_PX = 208

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
  outputFormat: Sam2AutoAnnotationFormat
  onOutputFormatChange: (format: Sam2AutoAnnotationFormat) => void
  onCancel: () => void
  onConfirm: () => void
  getAnchor: () => HTMLElement | null
}

export function Sam2SegmentAnchorPanel({
  open,
  labels,
  selectedLabel,
  onSelectedLabelChange,
  outputFormat,
  onOutputFormatChange,
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
      aria-label="SAM2 分割选项"
      className="fixed z-[200] w-52 rounded-md border border-border bg-background/95 p-3 shadow-md"
      style={positionStyle}
      data-ea-sam2-picker-panel=""
    >
      <p className="mb-2 text-xs text-muted-foreground">SAM2 分割</p>
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
        <p className="rounded border border-dashed border-border/80 bg-muted/30 px-2 py-2 text-xs text-muted-foreground">
          请先在项目详情中添加普通类标签。
        </p>
      )}

      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        <div className="text-[11px] text-muted-foreground">输出格式</div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center justify-center rounded border text-xs",
              outputFormat === "box"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onOutputFormatChange("box")}
          >
            框
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center justify-center rounded border text-xs",
              outputFormat === "mask"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
            onClick={() => onOutputFormatChange("mask")}
          >
            掩码
          </button>
        </div>
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
          disabled={!selectedLabel.trim() || labels.length === 0}
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

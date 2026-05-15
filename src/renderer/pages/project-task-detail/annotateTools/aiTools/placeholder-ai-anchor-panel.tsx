/**
 * 占位类 AI 工具：任务页内轻量说明 + 跳转完整配置页（与 SAM2 锚定面板同类定位）。
 */
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createPortal } from "react-dom"
import { useLayoutEffect, useState, type CSSProperties } from "react"
import { Link } from "react-router-dom"

const PANEL_WIDTH_PX = 260

function getFallbackFixedPos(): { top: number; left: number } {
  if (typeof window === "undefined") return { top: 0, left: 0 }
  return {
    top: window.innerHeight / 2,
    left: 8 + 48,
  }
}

function computePosFromAnchorEl(el: HTMLElement): { top: number; left: number } {
  const w = PANEL_WIDTH_PX
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

export type PlaceholderAiAnchorPanelProps = {
  open: boolean
  title: string
  description: string
  configTo: string
  getAnchor: () => HTMLElement | null
  onClose: () => void
}

export function PlaceholderAiAnchorPanel({
  open,
  title,
  description,
  configTo,
  getAnchor,
  onClose,
}: PlaceholderAiAnchorPanelProps) {
  const [anchoredPos, setAnchoredPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAnchoredPos(null)
      return
    }
    const run = () => {
      const el = getAnchor()
      if (el) {
        setAnchoredPos(computePosFromAnchorEl(el))
      } else {
        setAnchoredPos(getFallbackFixedPos())
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

  const fixedPos = anchoredPos ?? getFallbackFixedPos()
  const positionStyle: CSSProperties = {
    top: fixedPos.top,
    left: fixedPos.left,
    transform: "translateY(-50%)",
  }

  const panel = (
    <div
      role="dialog"
      aria-label={`${title} 说明`}
      className={cn("fixed z-[200] w-64 rounded-md border border-border bg-background/95 p-3 shadow-md")}
      style={positionStyle}
      data-ea-placeholder-ai-picker-panel=""
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>
          关闭
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-7 text-xs">
          <Link to={configTo} onClick={onClose}>
            进入配置
          </Link>
        </Button>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}

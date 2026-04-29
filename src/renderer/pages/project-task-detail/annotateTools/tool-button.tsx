/**
 * 模块：project-task-detail/annotateTools/tool-button
 * 职责：提供工具栏通用按钮外观与交互骨架。
 * 边界：不感知具体工具语义，仅接收通用 props。
 */
import { cn } from "@/lib/utils"
import type { ToolButtonProps } from "./types"

export function ToolButton({ active, onClick, ariaLabel, title, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      aria-label={ariaLabel}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

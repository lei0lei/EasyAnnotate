/**
 * 模块：project-task-detail/annotateTools/text-tool-button
 * 职责：渲染并触发文本工具按钮（预留能力）。
 * 边界：仅负责模式切换，不实现文本标注编辑器。
 */
import { Type } from "lucide-react"
import { ToolButton } from "./tool-button"
import type { ModeToolButtonProps } from "./types"

export function TextToolButton({ active, onSetToolMode }: ModeToolButtonProps) {
  const handleClick = () => {
    onSetToolMode("text")
  }

  return (
    <ToolButton active={active} onClick={handleClick} ariaLabel="文本工具">
      <Type className="h-4 w-4" />
    </ToolButton>
  )
}

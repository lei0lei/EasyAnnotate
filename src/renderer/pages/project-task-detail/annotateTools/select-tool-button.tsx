/**
 * 模块：project-task-detail/annotateTools/select-tool-button
 * 职责：渲染并触发选择工具按钮。
 * 边界：只负责按钮触发，不处理选择后的交互流程。
 */
import { MousePointer2 } from "lucide-react"
import { ToolButton } from "./tool-button"
import type { SelectToolButtonProps } from "./types"

export function SelectToolButton({ active, onSelectTool }: SelectToolButtonProps) {
  const handleClick = () => {
    onSelectTool()
  }

  return (
    <ToolButton active={active} onClick={handleClick} ariaLabel="选中工具" title="选中工具（缩放/移动）">
      <MousePointer2 className="h-4 w-4" />
    </ToolButton>
  )
}

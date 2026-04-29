/**
 * 模块：project-task-detail/annotateTools/rect-tool-button
 * 职责：渲染并触发矩形工具按钮。
 * 边界：只切换工具状态，不实现矩形绘制逻辑。
 */
import { Square } from "lucide-react"
import { ToolButton } from "./tool-button"
import type { RectToolButtonProps } from "./types"

export function RectToolButton({ active, onStartRectTool, onClearSelection }: RectToolButtonProps) {
  const handleClick = () => {
    onStartRectTool()
    onClearSelection()
  }

  return (
    <ToolButton active={active} onClick={handleClick} ariaLabel="矩形工具">
      <Square className="h-4 w-4" />
    </ToolButton>
  )
}

/**
 * 模块：project-task-detail/annotateTools/polygon-tool-button
 * 职责：渲染并触发多边形工具按钮。
 * 边界：仅负责工具切换，不实现多边形点集管理。
 */
import { Pentagon } from "lucide-react"
import { ToolButton } from "./tool-button"
import type { PolygonToolButtonProps } from "./types"

export function PolygonToolButton({ active, onStartPolygonTool, onClearSelection }: PolygonToolButtonProps) {
  const handleClick = () => {
    onStartPolygonTool()
    onClearSelection()
  }

  return (
    <ToolButton active={active} onClick={handleClick} ariaLabel="多边形工具">
      <Pentagon className="h-4 w-4" />
    </ToolButton>
  )
}

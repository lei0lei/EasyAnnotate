/**
 * 模块：project-task-detail/annotateTools/rot-rect-tool-button
 * 职责：渲染并触发旋转矩形工具按钮。
 * 边界：只切换到 OBB 工具，不处理旋转框绘制算法。
 */
import { RectangleHorizontal } from "lucide-react"
import { ToolButton } from "./tool-button"
import type { RotRectToolButtonProps } from "./types"

export function RotRectToolButton({ active, onStartRotRectTool, onClearSelection }: RotRectToolButtonProps) {
  const handleClick = () => {
    onStartRotRectTool()
    onClearSelection()
  }

  return (
    <ToolButton active={active} onClick={handleClick} ariaLabel="旋转矩形工具">
      <RectangleHorizontal className="h-4 w-4 rotate-[20deg]" />
    </ToolButton>
  )
}

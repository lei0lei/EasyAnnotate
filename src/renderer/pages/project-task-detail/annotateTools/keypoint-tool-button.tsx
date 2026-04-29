/**
 * 模块：project-task-detail/annotateTools/keypoint-tool-button
 * 职责：渲染并触发关键点工具按钮。
 * 边界：只负责按钮触发，不参与关键点几何计算。
 *
 * 图标与 cvat-ui/src/assets/point-icon.svg 一致
 */
import { ToolButton } from "./tool-button"
import type { KeypointToolButtonProps } from "./types"

const POINT_SQUARES: { x: number; y: number; w: number }[] = [
  { x: 122.622, y: 199.29, w: 141.579 },
  { x: 712.768, y: 203.339, w: 141.579 },
  { x: 397.369, y: 457.061, w: 141.579 },
  { x: 110.006, y: 778.065, w: 141.579 },
  { x: 728.188, y: 658.916, w: 141.579 },
]

function KeypointToolIcon() {
  return (
    <svg viewBox="0 0 1024 1024" className="h-4 w-4 shrink-0" fill="none" aria-hidden>
      {POINT_SQUARES.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.w}
          stroke="currentColor"
          strokeWidth={36}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

export function KeypointToolButton({ active, onStartKeypointTool }: KeypointToolButtonProps) {
  return (
    <ToolButton
      active={active}
      onClick={onStartKeypointTool}
      ariaLabel="关键点标注工具"
      title="关键点"
    >
      <KeypointToolIcon />
    </ToolButton>
  )
}

/**
 * 模块：project-task-detail/annotateTools/box3d-tool-button
 * 职责：3D 框工具按钮。
 * 边界：只负责按钮触发，不参与 3D 框几何与标注逻辑。
 *
 * 图标与 cvat-ui/src/assets/cube-icon.svg 一致
 */
import { ToolButton } from "./tool-button"
import type { Box3dToolButtonProps } from "./types"

const CVAT_CUBE_ICON_PATH =
  "M3 13L2.34921 12.2407L2 12.5401V13H3ZM3 33H2V34H3V33ZM30 33V34H30.3699L30.6508 33.7593L30 33ZM37 27L37.6508 27.7593L38 27.4599V27H37ZM37 7H38V6H37V7ZM10 7V6H9.63008L9.34921 6.24074L10 7ZM2 13V33H4V13H2ZM3 34H30V32H3V34ZM30.6508 33.7593L37.6508 27.7593L36.3492 26.2407L29.3492 32.2407L30.6508 33.7593ZM38 27V7H36V27H38ZM36.3492 6.24074L29.3492 12.2407L30.6508 13.7593L37.6508 7.75926L36.3492 6.24074ZM30 12H3V14H30V12ZM31 33V13H29V33H31ZM3.65079 13.7593L10.6508 7.75926L9.34921 6.24074L2.34921 12.2407L3.65079 13.7593ZM10 8H37V6H10V8Z"

function Box3dToolIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden>
      <path d={CVAT_CUBE_ICON_PATH} />
    </svg>
  )
}

export function Box3dToolButton({ active, onStartBox3dTool }: Box3dToolButtonProps) {
  return (
    <ToolButton
      active={active}
      onClick={onStartBox3dTool}
      ariaLabel="3D 标注框工具"
      title="3D 框"
    >
      <Box3dToolIcon />
    </ToolButton>
  )
}

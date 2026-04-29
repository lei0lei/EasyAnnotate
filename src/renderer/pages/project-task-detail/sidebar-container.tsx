/**
 * 模块：project-task-detail/sidebar-container
 * 职责：组装并透传侧边栏面板数据与模式切换事件。
 * 边界：容器层转接组件，不实现具体面板内容。
 */
import { ProjectTaskSidebarSection } from "@/pages/project-task-detail/page-sections"
import type { LeftPanelMode } from "@/pages/project-task-detail/types"
import type { TaskLeftPanelContentProps } from "@/pages/project-task-detail/components"

export type TaskSidebarContainerProps = {
  leftPanelMode: LeftPanelMode
  onPanelModeChange: (mode: LeftPanelMode) => void
  panelProps: TaskLeftPanelContentProps
}

export function TaskSidebarContainer({ leftPanelMode, onPanelModeChange, panelProps }: TaskSidebarContainerProps) {
  return <ProjectTaskSidebarSection leftPanelMode={leftPanelMode} onPanelModeChange={onPanelModeChange} panelProps={panelProps} />
}

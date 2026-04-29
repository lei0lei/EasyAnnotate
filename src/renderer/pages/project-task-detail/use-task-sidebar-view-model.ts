/**
 * 模块：project-task-detail/use-task-sidebar-view-model
 * 职责：构建侧栏消费的 ViewModel，收敛 content 中的侧栏 props 组装逻辑。
 * 边界：只做数据投影，不处理副作用与持久化。
 */
import { useMemo } from "react"
import type { ProjectItem } from "@/lib/projects-api"
import type { XAnyLabelShape } from "@/lib/xanylabeling-format"
import type { TaskLeftPanelContentProps } from "@/pages/project-task-detail/components"
import type { ImageFileInfo } from "@/pages/project-task-detail/hook-shared"
import type { LabelsTab, LeftPanelMode } from "@/pages/project-task-detail/types"
import type { LayerReorderMode } from "@/pages/project-task-detail/shape-ops"

type UseTaskSidebarViewModelParams = {
  leftPanelMode: LeftPanelMode
  labelsTab: LabelsTab
  onLabelsTabChange: (tab: LabelsTab) => void
  panelShapes: XAnyLabelShape[]
  selectedShapeId: string | null
  hoveredShapeId: string | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  labelColorMap: Map<string, string>
  project: ProjectItem | undefined
  taskName: string
  activeImagePath: string
  imageNaturalSize: { width: number; height: number }
  imageFileInfo: ImageFileInfo
  formatBytes: (value: number) => string
  onSetHoveredShapeId: TaskLeftPanelContentProps["onSetHoveredShapeId"]
  onSetSelectedShapeId: TaskLeftPanelContentProps["onSetSelectedShapeId"]
  onDeleteShape: (shapeIndex: number) => void
  onToggleShapeVisibility: (shapeIndex: number) => void
  onToggleClassVisibility: (label: string) => void
  onReorderShapeLayer: (shapeIndex: number, mode: LayerReorderMode) => void
}

export function useTaskSidebarViewModel(params: UseTaskSidebarViewModelParams): TaskLeftPanelContentProps {
  return useMemo(
    () => ({
      leftPanelMode: params.leftPanelMode,
      labelsTab: params.labelsTab,
      onLabelsTabChange: params.onLabelsTabChange,
      panelShapes: params.panelShapes,
      selectedShapeId: params.selectedShapeId,
      hoveredShapeId: params.hoveredShapeId,
      hiddenShapeIndexes: params.hiddenShapeIndexes,
      hiddenClassLabels: params.hiddenClassLabels,
      labelColorMap: params.labelColorMap,
      project: params.project,
      taskName: params.taskName,
      activeImagePath: params.activeImagePath,
      imageNaturalSize: params.imageNaturalSize,
      imageFileInfo: params.imageFileInfo,
      formatBytes: params.formatBytes,
      onSetHoveredShapeId: params.onSetHoveredShapeId,
      onSetSelectedShapeId: params.onSetSelectedShapeId,
      onDeleteShape: params.onDeleteShape,
      onToggleShapeVisibility: params.onToggleShapeVisibility,
      onToggleClassVisibility: params.onToggleClassVisibility,
      onReorderShapeLayer: params.onReorderShapeLayer,
    }),
    [
      params.activeImagePath,
      params.formatBytes,
      params.hiddenClassLabels,
      params.hiddenShapeIndexes,
      params.hoveredShapeId,
      params.imageFileInfo,
      params.imageNaturalSize,
      params.labelColorMap,
      params.labelsTab,
      params.leftPanelMode,
      params.onDeleteShape,
      params.onLabelsTabChange,
      params.onReorderShapeLayer,
      params.onSetHoveredShapeId,
      params.onSetSelectedShapeId,
      params.onToggleClassVisibility,
      params.onToggleShapeVisibility,
      params.panelShapes,
      params.project,
      params.selectedShapeId,
      params.taskName,
    ],
  )
}

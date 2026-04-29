/**
 * 模块：project-task-detail/annotateTools/types
 * 职责：定义标注工具子模块共享类型（按钮、面板、模式事件）。
 * 边界：仅类型声明，不包含 UI 或算法。
 */
import type { TaskRectLabelPickerProps } from "@/pages/project-task-detail/components"
import type { RightToolMode } from "@/pages/project-task-detail/types"
import type { ReactElement, ReactNode } from "react"

export type AnnotateToolButtonProps = {
  active: boolean
}

export type AnnotateToolButtonComponent = (props: AnnotateToolButtonProps) => ReactElement

export type ToolButtonProps = AnnotateToolButtonProps & {
  onClick: () => void
  ariaLabel: string
  title?: string
  children: ReactNode
}

export type SelectToolButtonProps = AnnotateToolButtonProps & {
  onSelectTool: () => void
}

export type RectToolButtonProps = AnnotateToolButtonProps & {
  onStartRectTool: () => void
  onClearSelection: () => void
}

export type RotRectToolButtonProps = AnnotateToolButtonProps & {
  onStartRotRectTool: () => void
  onClearSelection: () => void
}

export type PolygonToolButtonProps = AnnotateToolButtonProps & {
  onStartPolygonTool: () => void
  onClearSelection: () => void
}

export type MaskToolButtonProps = AnnotateToolButtonProps & {
  onStartMaskTool: () => void
}

export type KeypointToolButtonProps = AnnotateToolButtonProps & {
  onStartKeypointTool: () => void
}

export type Box3dToolButtonProps = AnnotateToolButtonProps & {
  onStartBox3dTool: () => void
}

export type SkeletonToolButtonProps = AnnotateToolButtonProps & {
  onStartSkeletonTool: () => void
}

export type ModeToolButtonProps = AnnotateToolButtonProps & {
  onSetToolMode: (mode: RightToolMode) => void
}

export type TaskToolPaletteProps = {
  rightToolMode: RightToolMode
  onSelectTool: () => void
  onStartRectTool: () => void
  onStartRotRectTool: () => void
  onStartPolygonTool: () => void
  onStartMaskTool: () => void
  onStartKeypointTool: () => void
  onStartBox3dTool: () => void
  onStartSkeletonTool: () => void
  onClearSelection: () => void
  rectPickerProps: TaskRectLabelPickerProps
}

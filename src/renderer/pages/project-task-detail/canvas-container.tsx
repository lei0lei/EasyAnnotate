/**
 * 模块：project-task-detail/canvas-container
 * 职责：组装画布 section 所需 props（工具栏、标签选择、绘制提示）。
 * 边界：容器层转接组件，不实现画布绘制细节。
 */
import { ProjectTaskCanvasSection } from "@/pages/project-task-detail/page-sections"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import type { DrawShapeWithPolygon } from "@/pages/project-task-detail/tool-state"
import type { TaskToolPaletteProps } from "@/pages/project-task-detail/annotateTools/types"
import type { TaskDrawHintProps } from "@/pages/project-task-detail/components"
import type { ComponentProps } from "react"

export type TaskCanvasContainerProps = {
  sectionProps: Omit<ComponentProps<typeof ProjectTaskCanvasSection>, "toolPaletteProps" | "drawHintProps">
  rightToolMode: RightToolMode
  drawShapeType: DrawShapeWithPolygon
  rectDrawingEnabled: boolean
  rectFirstPoint: Point | null
  polygonDraftPointCount: number
  rectPickerOpen: boolean
  rectPendingLabel: string
  annotationLabelOptions: string[]
  maskDrawMode: "brush" | "eraser"
  maskBrushSize: number
  onSelectTool: () => void
  onStartRectTool: TaskToolPaletteProps["onStartRectTool"]
  onStartRotRectTool: TaskToolPaletteProps["onStartRotRectTool"]
  onStartPolygonTool: TaskToolPaletteProps["onStartPolygonTool"]
  onStartMaskTool: TaskToolPaletteProps["onStartMaskTool"]
  onStartKeypointTool: TaskToolPaletteProps["onStartKeypointTool"]
  onStartBox3dTool: TaskToolPaletteProps["onStartBox3dTool"]
  onStartSkeletonTool: TaskToolPaletteProps["onStartSkeletonTool"]
  onClearSelection: TaskToolPaletteProps["onClearSelection"]
  onRectPendingLabelChange: (nextLabel: string) => void
  onMaskDrawModeChange: (nextMode: "brush" | "eraser") => void
  onMaskBrushSizeChange: (nextSize: number) => void
  onRectPickerCancel: () => void
  onRectPickerConfirm: () => void
  box3dAwaitingSecondClick: boolean
}

export function TaskCanvasContainer({
  sectionProps,
  rightToolMode,
  drawShapeType,
  rectDrawingEnabled,
  rectFirstPoint,
  polygonDraftPointCount,
  rectPickerOpen,
  rectPendingLabel,
  annotationLabelOptions,
  maskDrawMode,
  maskBrushSize,
  onSelectTool,
  onStartRectTool,
  onStartRotRectTool,
  onStartPolygonTool,
  onStartMaskTool,
  onStartKeypointTool,
  onStartBox3dTool,
  onStartSkeletonTool,
  onClearSelection,
  onRectPendingLabelChange,
  onMaskDrawModeChange,
  onMaskBrushSizeChange,
  onRectPickerCancel,
  onRectPickerConfirm,
  box3dAwaitingSecondClick,
}: TaskCanvasContainerProps) {
  const toolPaletteProps: TaskToolPaletteProps = {
    rightToolMode,
    onSelectTool,
    onStartRectTool,
    onStartRotRectTool,
    onStartPolygonTool,
    onStartMaskTool,
    onStartKeypointTool,
    onStartBox3dTool,
    onStartSkeletonTool,
    onClearSelection,
    rectPickerProps: {
      rectPickerOpen,
      drawShapeType,
      rectPendingLabel,
      annotationLabelOptions,
      maskDrawMode,
      maskBrushSize,
      onRectPendingLabelChange,
      onMaskDrawModeChange,
      onMaskBrushSizeChange,
      onCancel: onRectPickerCancel,
      onConfirm: onRectPickerConfirm,
    },
  }

  const drawHintProps: TaskDrawHintProps = {
    rightToolMode,
    drawShapeType,
    rectDrawingEnabled,
    rectFirstPoint,
    polygonDraftPointCount,
    maskDrawMode,
    box3dAwaitingSecondClick,
  }

  return <ProjectTaskCanvasSection {...sectionProps} toolPaletteProps={toolPaletteProps} drawHintProps={drawHintProps} />
}

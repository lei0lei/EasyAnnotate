export { ToolButton } from "./tool-button"
/**
 * 模块：project-task-detail/annotateTools/index
 * 职责：标注工具子模块统一导出入口。
 * 边界：只聚合工具相关导出，不包含具体交互实现。
 */
export { TaskToolPalette } from "./task-tool-palette"
export { SelectToolButton } from "./select-tool-button"
export { RectToolButton } from "./rect-tool-button"
export { RotRectToolButton } from "./rot-rect-tool-button"
export { MaskToolButton } from "./circle-tool-button"
export { Box3dToolButton } from "./box3d-tool-button"
export { KeypointToolButton } from "./keypoint-tool-button"
export { SkeletonToolButton } from "./skeleton-tool-button"
export { PolygonToolButton } from "./polygon-tool-button"
export { TextToolButton } from "./text-tool-button"
export { useMaskTool } from "./use-mask-tool"
export { useBox3dTool } from "./use-box3d-tool"
export { usePolygonTool } from "./use-polygon-tool"
export { useRectRotTool } from "./use-rect-rot-tool"
export { eraseMaskPointsByStroke, interpolateMaskPoints, splitMaskPointSegments } from "./mask-draw-ops"
export type {
  AnnotateToolButtonComponent,
  AnnotateToolButtonProps,
  Box3dToolButtonProps,
  KeypointToolButtonProps,
  SkeletonToolButtonProps,
  MaskToolButtonProps,
  ModeToolButtonProps,
  PolygonToolButtonProps,
  RectToolButtonProps,
  RotRectToolButtonProps,
  SelectToolButtonProps,
  TaskToolPaletteProps,
  ToolButtonProps,
} from "./types"

export {
  RectangleOverlayItem,
  TaskCanvasLayer,
  TaskDetailHeader,
  TaskDrawHint,
  TaskLeftPanelContent,
  TaskLeftSidebarLayer,
  TaskRectLabelPicker,
  TaskToolPalette,
} from "./components"

export type {
  LabelsTab,
  LeftPanelMode,
  Point,
  RenderedRectangle,
  RenderedRotationRect,
  ResizeHandle,
  RightToolMode,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "./types"

export { fileNameFromPath, formatBytes, normalizeTagColor, resolveTaskImagePath } from "./utils"

export { buildImageGeometry, imageToStagePoint, stageToImagePoint, stageToImagePointStrict } from "./canvas-geometry"
export type { ImageGeometry } from "./canvas-geometry"

export { buildRenderedRectangles, buildRenderedRotationRects } from "./rendered-shapes"
export { useTaskCanvasInteractions } from "./use-task-canvas-interactions"
export { useDragSessions } from "./use-drag-sessions"
export { useTaskDataSync } from "./use-task-data-sync"
export { useCanvasViewState } from "./use-canvas-view-state"
export { useShapeManagement } from "./use-shape-management"
export { useTaskBootstrap } from "./use-task-bootstrap"

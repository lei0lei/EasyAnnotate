import type { DrawShapeWithPolygon } from "@/pages/project-task-detail/tool-state"
import type { RightToolMode } from "@/pages/project-task-detail/types"

export type DrawingToolForHabit = Exclude<RightToolMode, "select" | "circle" | "text">

export function rightToolModeToDrawingPreset(tool: RightToolMode): {
  mode: DrawingToolForHabit
  drawShapeType: DrawShapeWithPolygon
} | null {
  switch (tool) {
    case "rect":
      return { mode: "rect", drawShapeType: "rectangle" }
    case "rotRect":
      return { mode: "rotRect", drawShapeType: "rotation" }
    case "polygon":
      return { mode: "polygon", drawShapeType: "polygon" }
    case "mask":
      return { mode: "mask", drawShapeType: "mask" }
    case "keypoint":
      return { mode: "keypoint", drawShapeType: "keypoint" }
    case "box3d":
      return { mode: "box3d", drawShapeType: "box3d" }
    case "skeleton":
      return { mode: "skeleton", drawShapeType: "skeleton" }
    default:
      return null
  }
}

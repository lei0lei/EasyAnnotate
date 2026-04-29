/**
 * 模块：project-task-detail/tool-state
 * 职责：定义标注工具状态机（ToolState / Action / reducer）。
 * 边界：只管理工具状态流转，不直接读写标注文档。
 */
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"

export type DrawShapeType = "rectangle" | "rotation"
export type DrawShapeWithPolygon = DrawShapeType | "polygon" | "mask" | "keypoint" | "box3d" | "skeleton"
export type ToolWorkflowPhase = "idle" | "pickingLabel" | "drawing" | "editing"
export type ToolWorkflowState = {
  phase: ToolWorkflowPhase
  activeTool: RightToolMode
  drawShapeType: DrawShapeWithPolygon
  draft: {
    rectFirstPoint: Point | null
    rectHoverPoint: Point | null
    polygonDraftPoints: Point[]
    polygonHoverPoint: Point | null
  }
}

export type ToolState = {
  workflow: ToolWorkflowState
}

export function getToolWorkflowPhase(state: Pick<ToolState, "workflow">): ToolWorkflowPhase {
  return state.workflow.phase
}

export function isRectPickerOpen(state: Pick<ToolState, "workflow">): boolean {
  return state.workflow.phase === "pickingLabel"
}

export function isRectDrawingEnabled(state: Pick<ToolState, "workflow">): boolean {
  return state.workflow.phase === "drawing"
}

export function getActiveTool(state: Pick<ToolState, "workflow">): RightToolMode {
  return state.workflow.activeTool
}

export function getDrawShapeType(state: Pick<ToolState, "workflow">): DrawShapeWithPolygon {
  return state.workflow.drawShapeType
}

export function getToolDraft(state: Pick<ToolState, "workflow">): ToolWorkflowState["draft"] {
  return state.workflow.draft
}

export type ToolAction =
  | { type: "enterPickingLabel"; mode: Exclude<RightToolMode, "select" | "circle" | "text">; drawShapeType: DrawShapeWithPolygon }
  | { type: "enterDrawing" }
  | { type: "cancelPicking" }
  | { type: "exitToEditing" }
  | { type: "setRectHoverPoint"; point: Point | null }
  | { type: "setPolygonHoverPoint"; point: Point | null }
  | { type: "resetForNewFile" }
  | { type: "clearRectPoints" }
  | { type: "appendPolygonPoint"; point: Point }
  | { type: "popPolygonPoint" }
  | { type: "clearPolygonDraft" }
  | { type: "startRectFirstPoint"; point: Point }

export const initialToolState: ToolState = {
  workflow: {
    phase: "editing",
    activeTool: "select",
    drawShapeType: "rectangle",
    draft: {
      rectFirstPoint: null,
      rectHoverPoint: null,
      polygonDraftPoints: [],
      polygonHoverPoint: null,
    },
  },
}

function createEmptyDraft(): ToolWorkflowState["draft"] {
  return {
    rectFirstPoint: null,
    rectHoverPoint: null,
    polygonDraftPoints: [],
    polygonHoverPoint: null,
  }
}

function withDraft(state: ToolState, updater: (draft: ToolWorkflowState["draft"]) => ToolWorkflowState["draft"]): ToolState {
  return {
    workflow: {
      ...state.workflow,
      draft: updater(state.workflow.draft),
    },
  }
}

function withWorkflowMeta(workflow: Pick<ToolWorkflowState, "phase" | "activeTool" | "drawShapeType">): ToolState {
  return {
    workflow: {
      ...workflow,
      draft: createEmptyDraft(),
    },
  }
}

function isRectLikeMode(mode: RightToolMode): boolean {
  return mode === "rect" || mode === "rotRect"
}

function sanitizeByPhase(state: ToolState): ToolState {
  const phase = getToolWorkflowPhase(state)
  const activeTool = state.workflow.activeTool
  let next = state

  // Only polygon drawing phase can keep polygon draft points.
  if (!(phase === "drawing" && activeTool === "polygon")) {
    next = {
      workflow: {
        ...next.workflow,
        draft: {
          ...next.workflow.draft,
          polygonDraftPoints: [],
          polygonHoverPoint: null,
        },
      },
    }
  }

  // Only rect/rotRect drawing phase can keep rectangle anchor/hover points.
  if (!(phase === "drawing" && isRectLikeMode(activeTool))) {
    next = {
      workflow: {
        ...next.workflow,
        draft: {
          ...next.workflow.draft,
          rectFirstPoint: null,
          rectHoverPoint: null,
        },
      },
    }
  }

  return next
}

export function toolReducer(state: ToolState, action: ToolAction): ToolState {
  switch (action.type) {
    case "enterPickingLabel":
      return withWorkflowMeta({
        phase: "pickingLabel",
        activeTool: action.mode,
        drawShapeType: action.drawShapeType,
      })
    case "enterDrawing":
      return withWorkflowMeta({
        phase: "drawing",
        activeTool: state.workflow.activeTool,
        drawShapeType: state.workflow.drawShapeType,
      })
    case "cancelPicking":
      return withWorkflowMeta({
        phase: "idle",
        activeTool: state.workflow.activeTool,
        drawShapeType: state.workflow.drawShapeType,
      })
    case "exitToEditing":
      return withWorkflowMeta({
        phase: "editing",
        activeTool: "select",
        drawShapeType: state.workflow.drawShapeType,
      })
    case "setRectHoverPoint":
      if (getToolWorkflowPhase(state) !== "drawing" || !isRectLikeMode(state.workflow.activeTool)) return state
      return state.workflow.draft.rectHoverPoint === action.point
        ? state
        : withDraft(state, (draft) => ({
            ...draft,
            rectHoverPoint: action.point,
          }))
    case "setPolygonHoverPoint":
      if (getToolWorkflowPhase(state) !== "drawing" || state.workflow.activeTool !== "polygon") return state
      return state.workflow.draft.polygonHoverPoint === action.point
        ? state
        : withDraft(state, (draft) => ({
            ...draft,
            polygonHoverPoint: action.point,
          }))
    case "resetForNewFile":
      return withWorkflowMeta({
        phase: "editing",
        activeTool: "select",
        drawShapeType: "rectangle",
      })
    case "clearRectPoints":
      if (!isRectLikeMode(state.workflow.activeTool)) return state
      return withDraft(state, (draft) => ({
        ...draft,
        rectFirstPoint: null,
        rectHoverPoint: null,
      }))
    case "appendPolygonPoint":
      if (getToolWorkflowPhase(state) !== "drawing" || state.workflow.activeTool !== "polygon") return state
      return withDraft(state, (draft) => ({
        ...draft,
        polygonDraftPoints: [...draft.polygonDraftPoints, action.point],
        polygonHoverPoint: action.point,
      }))
    case "popPolygonPoint":
      if (state.workflow.activeTool !== "polygon") return state
      return withDraft(state, (draft) => ({
        ...draft,
        polygonDraftPoints: draft.polygonDraftPoints.slice(0, -1),
        polygonHoverPoint: null,
      }))
    case "clearPolygonDraft":
      if (state.workflow.activeTool !== "polygon") return state
      return withDraft(state, (draft) => ({
        ...draft,
        polygonDraftPoints: [],
        polygonHoverPoint: null,
      }))
    case "startRectFirstPoint":
      if (getToolWorkflowPhase(state) !== "drawing" || !isRectLikeMode(state.workflow.activeTool)) return state
      return withDraft(state, (draft) => ({
        ...draft,
        rectFirstPoint: action.point,
        rectHoverPoint: action.point,
      }))
    default:
      return sanitizeByPhase(state)
  }
}

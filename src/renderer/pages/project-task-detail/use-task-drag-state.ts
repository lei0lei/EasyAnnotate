/**
 * 模块：project-task-detail/use-task-drag-state
 * 职责：集中管理拖拽会话状态（形状拖拽、多边形拖拽、旋转拖拽）。
 * 边界：仅提供状态容器，不包含拖拽计算与事件绑定。
 */
import { useState } from "react"
import type {
  PolygonDragAction,
  PolygonVertexDragAction,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "@/pages/project-task-detail/types"

export function useTaskDragState() {
  const [shapeDragAction, setShapeDragAction] = useState<ShapeDragAction | null>(null)
  const [polygonDragAction, setPolygonDragAction] = useState<PolygonDragAction | null>(null)
  const [polygonVertexDragAction, setPolygonVertexDragAction] = useState<PolygonVertexDragAction | null>(null)
  const [rotationDragAction, setRotationDragAction] = useState<RotationDragAction | null>(null)
  const [rotationTransformAction, setRotationTransformAction] = useState<RotationTransformAction | null>(null)

  return {
    shapeDragAction,
    setShapeDragAction,
    polygonDragAction,
    setPolygonDragAction,
    polygonVertexDragAction,
    setPolygonVertexDragAction,
    rotationDragAction,
    setRotationDragAction,
    rotationTransformAction,
    setRotationTransformAction,
  }
}

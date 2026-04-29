import { useEffect, useRef } from "react"
import { isDragSessionActive, shouldPersistAfterDrag } from "@/pages/project-task-detail/drag-session-utils"
import type { DragSessionController } from "@/pages/project-task-detail/use-task-canvas-engine"

type UsePersistAfterDragParams = {
  dragSession: Pick<
    DragSessionController,
    "shapeDragAction" | "polygonDragAction" | "polygonVertexDragAction" | "rotationDragAction" | "rotationTransformAction"
  >
  persistIfDirty: () => void
}

export function usePersistAfterDrag({ dragSession, persistIfDirty }: UsePersistAfterDragParams) {
  const wasDraggingRef = useRef(false)

  useEffect(() => {
    const isDraggingNow = isDragSessionActive({
      shapeDragAction: dragSession.shapeDragAction,
      polygonDragAction: dragSession.polygonDragAction,
      polygonVertexDragAction: dragSession.polygonVertexDragAction,
      rotationDragAction: dragSession.rotationDragAction,
      rotationTransformAction: dragSession.rotationTransformAction,
    })
    if (shouldPersistAfterDrag(wasDraggingRef.current, isDraggingNow)) {
      persistIfDirty()
    }
    wasDraggingRef.current = isDraggingNow
  }, [
    dragSession.polygonDragAction,
    dragSession.polygonVertexDragAction,
    dragSession.rotationDragAction,
    dragSession.rotationTransformAction,
    dragSession.shapeDragAction,
    persistIfDirty,
  ])
}

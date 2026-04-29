import { useCallback, useRef } from "react"
import type { CanvasShapeUpdatedEvent, ViewportChangeEvent } from "@/pages/project-task-detail/use-task-canvas-engine"

type UseCanvasEngineEventsParams = {
  markInteractionDirty: (event: { source: "canvas-engine"; shapeId?: string; reason?: CanvasShapeUpdatedEvent["reason"] }) => void
}

export function useCanvasEngineEvents({ markInteractionDirty }: UseCanvasEngineEventsParams) {
  const viewportStateRef = useRef<ViewportChangeEvent | null>(null)
  const lastShapeUpdateRef = useRef<CanvasShapeUpdatedEvent | null>(null)

  const handleEngineViewportChanged = useCallback((event: ViewportChangeEvent) => {
    viewportStateRef.current = event
  }, [])

  const handleEngineShapeUpdated = useCallback(
    (event: CanvasShapeUpdatedEvent) => {
      lastShapeUpdateRef.current = event
      markInteractionDirty({
        source: "canvas-engine",
        shapeId: event.shapeId,
        reason: event.reason,
      })
    },
    [markInteractionDirty],
  )

  return {
    viewportStateRef,
    lastShapeUpdateRef,
    handleEngineViewportChanged,
    handleEngineShapeUpdated,
  }
}

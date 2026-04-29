import { useCallback } from "react"

type UseShapeCreatedEventParams = {
  setSelectedShapeId: (shapeId: string | null) => void
}

export function useShapeCreatedEvent({ setSelectedShapeId }: UseShapeCreatedEventParams) {
  return useCallback(
    ({ shapeId }: { shapeId: string }) => {
      setSelectedShapeId(shapeId)
    },
    [setSelectedShapeId],
  )
}

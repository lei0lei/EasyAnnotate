export type DragSessionFlags = {
  shapeDragAction: unknown | null
  polygonDragAction: unknown | null
  polygonVertexDragAction: unknown | null
  rotationDragAction: unknown | null
  rotationTransformAction: unknown | null
}

export function isDragSessionActive(flags: DragSessionFlags): boolean {
  return (
    flags.shapeDragAction !== null ||
    flags.polygonDragAction !== null ||
    flags.polygonVertexDragAction !== null ||
    flags.rotationDragAction !== null ||
    flags.rotationTransformAction !== null
  )
}

export function shouldPersistAfterDrag(previousDragging: boolean, currentDragging: boolean): boolean {
  return previousDragging && !currentDragging
}

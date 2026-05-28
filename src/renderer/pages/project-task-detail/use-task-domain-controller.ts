import { useCallback, useMemo } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { useAnnotationCommands } from "@/pages/project-task-detail/use-annotation-commands"
import { useCanvasEngineEvents } from "@/pages/project-task-detail/use-canvas-engine-events"
import { useShapeCreatedEvent } from "@/pages/project-task-detail/use-shape-created-event"
import { useTaskDataSync } from "@/pages/project-task-detail/use-task-data-sync"
import type { AnnotationDocRef, ImageFileInfo, RawHighlightCorner } from "@/pages/project-task-detail/hook-shared"
import type { ShapeDragAction } from "@/pages/project-task-detail/types"
import type { AnnotationHistory } from "@/pages/project-task-detail/use-task-annotation-state"

type UseTaskDomainControllerParams = {
  activeImagePath: string
  annotationDoc: XAnyLabelFile | null
  selectedShapeIndex: number | null
  hoveredShapeIndex: number | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  history: AnnotationHistory
  shapeDragAction: ShapeDragAction | null
  annotationDocRef: AnnotationDocRef
  setAnnotationDoc: (value: XAnyLabelFile | null | ((prev: XAnyLabelFile | null) => XAnyLabelFile | null)) => void
  setHiddenShapeIndexes: (value: number[] | ((prev: number[]) => number[])) => void
  setSelectedShapeIndex: (value: number | null | ((prev: number | null) => number | null)) => void
  setSelectedShapeId: (value: string | null | ((prev: string | null) => string | null)) => void
  setHoveredShapeIndex: (value: number | null | ((prev: number | null) => number | null)) => void
  setRawHighlightCorner: (value: RawHighlightCorner | ((prev: RawHighlightCorner) => RawHighlightCorner)) => void
  setHiddenClassLabels: (value: string[] | ((prev: string[]) => string[])) => void
  setHistory: (value: AnnotationHistory | ((prev: AnnotationHistory) => AnnotationHistory)) => void
  setPanelDoc: (value: XAnyLabelFile | null) => void
  setImageFileInfo: (value: ImageFileInfo) => void
}

export function useTaskDomainController(params: UseTaskDomainControllerParams) {
  const { persistAnnotation } = useTaskDataSync({
    activeImagePath: params.activeImagePath,
    annotationDoc: params.annotationDoc,
    shapeDragAction: params.shapeDragAction,
    annotationDocRef: params.annotationDocRef,
    setPanelDoc: params.setPanelDoc,
    setImageFileInfo: params.setImageFileInfo,
  })

  const {
    deleteShape,
    toggleShapeVisibility,
    toggleClassVisibility,
    reorderShapeLayer,
    setSelectedShape,
    setHoveredShape,
    clearSelection,
    applyShapePatch,
    createShape,
    replaceDoc,
    resetDoc,
    markInteractionDirty,
    persistIfDirty,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useAnnotationCommands({
    annotationDoc: params.annotationDoc,
    selectedShapeIndex: params.selectedShapeIndex,
    hoveredShapeIndex: params.hoveredShapeIndex,
    hiddenShapeIndexes: params.hiddenShapeIndexes,
    hiddenClassLabels: params.hiddenClassLabels,
    history: params.history,
    setAnnotationDoc: params.setAnnotationDoc,
    persistAnnotation,
    setHiddenShapeIndexes: params.setHiddenShapeIndexes,
    setSelectedShapeIndex: params.setSelectedShapeIndex,
    setHoveredShapeIndex: params.setHoveredShapeIndex,
    setRawHighlightCorner: params.setRawHighlightCorner,
    setHiddenClassLabels: params.setHiddenClassLabels,
    setHistory: params.setHistory,
  })

  const handleEngineShapeCreated = useShapeCreatedEvent({ setSelectedShapeId: params.setSelectedShapeId })
  const { handleEngineViewportChanged, handleEngineShapeUpdated } = useCanvasEngineEvents({ markInteractionDirty })

  const clearSelectedShape = useCallback(() => {
    clearSelection()
  }, [clearSelection])

  return useMemo(
    () => ({
      persistAnnotation,
      deleteShape,
      toggleShapeVisibility,
      toggleClassVisibility,
      reorderShapeLayer,
      setSelectedShape,
      setHoveredShape,
      applyShapePatch,
      createShape,
      replaceDoc,
      resetDoc,
      persistIfDirty,
      undo,
      redo,
      canUndo,
      canRedo,
      clearSelectedShape,
      handleEngineShapeCreated,
      handleEngineViewportChanged,
      handleEngineShapeUpdated,
    }),
    [
      applyShapePatch,
      clearSelectedShape,
      deleteShape,
      handleEngineShapeCreated,
      handleEngineShapeUpdated,
      handleEngineViewportChanged,
      canRedo,
      canUndo,
      createShape,
      replaceDoc,
      resetDoc,
      persistAnnotation,
      persistIfDirty,
      redo,
      reorderShapeLayer,
      setHoveredShape,
      setSelectedShape,
      toggleClassVisibility,
      toggleShapeVisibility,
      undo,
    ],
  )
}

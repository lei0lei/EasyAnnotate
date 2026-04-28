import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"
import { cn } from "@/lib/utils"
import {
  remapIndexAfterDelete,
  remapIndexAfterReorder,
  reorderItemsByIndex,
  resolveReorderTargetIndex,
  type LayerReorderMode,
} from "@/pages/project-task-detail/shape-ops"
import { roundPointsToInt } from "@/pages/project-task-detail/utils"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { Dispatch, SetStateAction } from "react"
import type { RawHighlightCorner } from "@/pages/project-task-detail/hook-shared"

type UseShapeManagementParams = {
  annotationDoc: XAnyLabelFile | null
  selectedShapeIndex: number | null
  hoveredShapeIndex: number | null
  setAnnotationDoc: Dispatch<SetStateAction<XAnyLabelFile | null>>
  persistAnnotation: (nextDoc: XAnyLabelFile) => void
  setHiddenShapeIndexes: Dispatch<SetStateAction<number[]>>
  setSelectedShapeIndex: Dispatch<SetStateAction<number | null>>
  setHoveredShapeIndex: Dispatch<SetStateAction<number | null>>
  setRawHighlightCorner: Dispatch<SetStateAction<RawHighlightCorner>>
  setHiddenClassLabels: Dispatch<SetStateAction<string[]>>
}

export function formatPositionText(point: number[] | undefined): string {
  if (!point || point.length < 2) return "0,0"
  return `${Math.round(Number(point[0] ?? 0))},${Math.round(Number(point[1] ?? 0))}`
}

export function useShapeManagement(params: UseShapeManagementParams) {
  const deleteShape = (shapeIndex: number) => {
    if (!params.annotationDoc) return
    const nextShapes = params.annotationDoc.shapes.filter((_, index) => index !== shapeIndex)
    const nextDoc = normalizeDocPointsToInt({ ...params.annotationDoc, shapes: nextShapes })
    params.setAnnotationDoc(nextDoc)
    params.persistAnnotation(nextDoc)
    params.setHiddenShapeIndexes((prev) =>
      prev
        .map((idx) => remapIndexAfterDelete(idx, shapeIndex))
        .filter((idx): idx is number => idx !== null),
    )
    params.setSelectedShapeIndex(null)
    params.setHoveredShapeIndex((prev) => (prev === null ? prev : remapIndexAfterDelete(prev, shapeIndex)))
    params.setRawHighlightCorner((prev) => {
      if (!prev) return prev
      const nextIndex = remapIndexAfterDelete(prev.shapeIndex, shapeIndex)
      if (nextIndex === null) return null
      return { ...prev, shapeIndex: nextIndex }
    })
  }

  const toggleShapeVisibility = (shapeIndex: number) => {
    params.setHiddenShapeIndexes((prev) => {
      if (prev.includes(shapeIndex)) return prev.filter((idx) => idx !== shapeIndex)
      return [...prev, shapeIndex]
    })
    if (params.selectedShapeIndex === shapeIndex) params.setSelectedShapeIndex(null)
    if (params.hoveredShapeIndex === shapeIndex) params.setHoveredShapeIndex(null)
  }

  const toggleClassVisibility = (label: string) => {
    params.setHiddenClassLabels((prev) => {
      if (prev.includes(label)) return prev.filter((item) => item !== label)
      return [...prev, label]
    })
    const selectedShape =
      params.selectedShapeIndex !== null ? params.annotationDoc?.shapes?.[params.selectedShapeIndex] : null
    const hoveredShape = params.hoveredShapeIndex !== null ? params.annotationDoc?.shapes?.[params.hoveredShapeIndex] : null
    if (selectedShape?.label === label) params.setSelectedShapeIndex(null)
    if (hoveredShape?.label === label) params.setHoveredShapeIndex(null)
  }

  const reorderShapeLayer = (shapeIndex: number, mode: LayerReorderMode) => {
    const total = params.annotationDoc?.shapes.length ?? 0
    if (total <= 1) return
    const targetIndex = resolveReorderTargetIndex(shapeIndex, total, mode)
    if (targetIndex === shapeIndex) return

    let nextDocForPersist: XAnyLabelFile | null = null
    params.setAnnotationDoc((prev) => {
      if (!prev || !prev.shapes[shapeIndex]) return prev
      const nextShapes = reorderItemsByIndex(prev.shapes, shapeIndex, targetIndex)
      const nextDoc = normalizeDocPointsToInt({ ...prev, shapes: nextShapes })
      nextDocForPersist = nextDoc
      return nextDoc
    })
    if (nextDocForPersist) params.persistAnnotation(nextDocForPersist)

    params.setHiddenShapeIndexes((prev) => Array.from(new Set(prev.map((idx) => remapIndexAfterReorder(idx, shapeIndex, targetIndex)))))
    params.setSelectedShapeIndex((prev) => (prev === null ? prev : remapIndexAfterReorder(prev, shapeIndex, targetIndex)))
    params.setHoveredShapeIndex((prev) => (prev === null ? prev : remapIndexAfterReorder(prev, shapeIndex, targetIndex)))
    params.setRawHighlightCorner((prev) =>
      prev ? { ...prev, shapeIndex: remapIndexAfterReorder(prev.shapeIndex, shapeIndex, targetIndex) } : prev,
    )
  }

  const updateShapePoints = (shapeIndex: number, points: number[][], shouldPersist: boolean) => {
    const roundedPoints = roundPointsToInt(points)
    let nextDocForPersist: XAnyLabelFile | null = null
    params.setAnnotationDoc((prev) => {
      if (!prev) return prev
      const nextShapes = prev.shapes.map((shape, index) => (index === shapeIndex ? { ...shape, points: roundedPoints } : shape))
      const nextDoc = normalizeDocPointsToInt({ ...prev, shapes: nextShapes })
      if (shouldPersist) nextDocForPersist = nextDoc
      return nextDoc
    })
    if (shouldPersist && nextDocForPersist) params.persistAnnotation(nextDocForPersist)
  }

  const formatPosition = (point: number[] | undefined): string => formatPositionText(point)

  const renderPositionBox = (
    value: string,
    idx: number,
    shapeIndex: number,
    highlighted: boolean,
    onEnter?: () => void,
    onLeave?: () => void,
  ) => (
    <button
      type="button"
      key={`${shapeIndex}-pos-${idx}`}
      className={cn(
        "inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded border px-1 text-[11px]",
        highlighted
          ? "border-emerald-400 bg-emerald-500/15 text-foreground"
          : "border-border/70 bg-background text-muted-foreground",
      )}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {value}
    </button>
  )

  return {
    deleteShape,
    toggleShapeVisibility,
    toggleClassVisibility,
    reorderShapeLayer,
    updateShapePoints,
    formatPosition,
    renderPositionBox,
  }
}

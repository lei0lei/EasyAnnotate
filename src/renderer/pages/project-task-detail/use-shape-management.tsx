/**
 * 模块：project-task-detail/use-shape-management
 * 职责：提供 shape 管理能力（删除、显隐、排序、侧栏展示辅助）。
 * 边界：负责 shape 级状态修改，不处理画布手势。
 */
import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"
import { cn } from "@/lib/utils"
import { findShapeIndexByStableId, getShapeStableIdAtIndex } from "@/pages/project-task-detail/shape-identity"
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
  const deleteShape = (shapeIndex: number): XAnyLabelFile | null => {
    if (!params.annotationDoc) return null
    const selectedShapeId = getShapeStableIdAtIndex(params.annotationDoc, params.selectedShapeIndex)
    const hoveredShapeId = getShapeStableIdAtIndex(params.annotationDoc, params.hoveredShapeIndex)
    const deletedShapeId = getShapeStableIdAtIndex(params.annotationDoc, shapeIndex)
    const nextShapes = params.annotationDoc.shapes.filter((_, index) => index !== shapeIndex)
    const nextDoc = normalizeDocPointsToInt({ ...params.annotationDoc, shapes: nextShapes })
    params.setAnnotationDoc(nextDoc)
    params.setHiddenShapeIndexes((prev) =>
      prev
        .map((idx) => remapIndexAfterDelete(idx, shapeIndex))
        .filter((idx): idx is number => idx !== null),
    )
    params.setSelectedShapeIndex(() => {
      if (!selectedShapeId || selectedShapeId === deletedShapeId) return null
      return findShapeIndexByStableId(nextDoc, selectedShapeId)
    })
    params.setHoveredShapeIndex(() => {
      if (!hoveredShapeId || hoveredShapeId === deletedShapeId) return null
      return findShapeIndexByStableId(nextDoc, hoveredShapeId)
    })
    params.setRawHighlightCorner((prev) => {
      if (!prev) return prev
      if (prev.shapeId === deletedShapeId) return null
      return prev
    })
    return nextDoc
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

  const reorderShapeLayer = (shapeIndex: number, mode: LayerReorderMode): XAnyLabelFile | null => {
    const total = params.annotationDoc?.shapes.length ?? 0
    if (total <= 1) return null
    const selectedShapeId = getShapeStableIdAtIndex(params.annotationDoc, params.selectedShapeIndex)
    const hoveredShapeId = getShapeStableIdAtIndex(params.annotationDoc, params.hoveredShapeIndex)
    const targetIndex = resolveReorderTargetIndex(shapeIndex, total, mode)
    if (targetIndex === shapeIndex) return null

    let nextDocForPersist: XAnyLabelFile | null = null
    params.setAnnotationDoc((prev) => {
      if (!prev || !prev.shapes[shapeIndex]) return prev
      const nextShapes = reorderItemsByIndex(prev.shapes, shapeIndex, targetIndex)
      const nextDoc = normalizeDocPointsToInt({ ...prev, shapes: nextShapes })
      nextDocForPersist = nextDoc
      return nextDoc
    })

    params.setHiddenShapeIndexes((prev) => Array.from(new Set(prev.map((idx) => remapIndexAfterReorder(idx, shapeIndex, targetIndex)))))
    params.setSelectedShapeIndex(() => findShapeIndexByStableId(nextDocForPersist, selectedShapeId))
    params.setHoveredShapeIndex(() => findShapeIndexByStableId(nextDocForPersist, hoveredShapeId))
    params.setRawHighlightCorner((prev) => prev)
    return nextDocForPersist
  }

  const updateShapePoints = (shapeIndex: number, points: number[][]): XAnyLabelFile | null => {
    const roundedPoints = roundPointsToInt(points)
    let nextDocForPersist: XAnyLabelFile | null = null
    params.setAnnotationDoc((prev) => {
      if (!prev) return prev
      const nextShapes = prev.shapes.map((shape, index) => (index === shapeIndex ? { ...shape, points: roundedPoints } : shape))
      const nextDoc = normalizeDocPointsToInt({ ...prev, shapes: nextShapes })
      nextDocForPersist = nextDoc
      return nextDoc
    })
    return nextDocForPersist
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

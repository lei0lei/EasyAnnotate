/**
 * 模块：project-task-detail/use-annotation-commands
 * 职责：提供标注域统一命令入口，封装常见 shape 与选择操作。
 * 边界：复用底层 shape management，不直接处理画布鼠标事件。
 */
import { useCallback, useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import { createXAnyLabelTemplate, type XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { RawHighlightCorner } from "@/pages/project-task-detail/hook-shared"
import type { LayerReorderMode } from "@/pages/project-task-detail/shape-ops"
import type { CanvasShapeUpdatedEvent } from "@/pages/project-task-detail/use-task-canvas-engine"
import { cloneAnnotationDoc, cloneAnnotationSnapshot, type AnnotationHistory, type AnnotationSnapshot } from "@/pages/project-task-detail/use-task-annotation-state"
import { createShapeStableId, ensureDocHasStableShapeIds, getShapeStableIdAtIndex } from "@/pages/project-task-detail/shape-identity"
import { useShapeManagement } from "@/pages/project-task-detail/use-shape-management"

type UseAnnotationCommandsParams = {
  annotationDoc: XAnyLabelFile | null
  selectedShapeIndex: number | null
  hoveredShapeIndex: number | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  history: AnnotationHistory
  setAnnotationDoc: Dispatch<SetStateAction<XAnyLabelFile | null>>
  persistAnnotation: (nextDoc: XAnyLabelFile) => void
  setHiddenShapeIndexes: Dispatch<SetStateAction<number[]>>
  setSelectedShapeIndex: Dispatch<SetStateAction<number | null>>
  setHoveredShapeIndex: Dispatch<SetStateAction<number | null>>
  setRawHighlightCorner: Dispatch<SetStateAction<RawHighlightCorner>>
  setHiddenClassLabels: Dispatch<SetStateAction<string[]>>
  setHistory: Dispatch<SetStateAction<AnnotationHistory>>
}

export type InteractionDirtyEvent = {
  source: "canvas-engine" | "command"
  shapeId?: string
  reason?: CanvasShapeUpdatedEvent["reason"]
}

type CreateShapeParams = {
  imagePath: string
  imageWidth: number
  imageHeight: number
  shape: XAnyLabelFile["shapes"][number]
}

type CreateShapeResult = {
  shapeIndex: number
  shapeId: string
}

export function useAnnotationCommands(params: UseAnnotationCommandsParams) {
  const dirtyRef = useRef(false)
  const lastDirtyEventRef = useRef<InteractionDirtyEvent | null>(null)
  const lastCommittedSnapshotRef = useRef<AnnotationSnapshot>({
    doc: params.annotationDoc ? cloneAnnotationDoc(params.annotationDoc) : null,
    hiddenShapeIndexes: [...params.hiddenShapeIndexes],
    hiddenClassLabels: [...params.hiddenClassLabels],
  })
  const shapeManagement = useShapeManagement(params)
  const resolveShapeIdFromDoc = useCallback((doc: XAnyLabelFile | null, shapeIndex: number | null | undefined) => {
    if (shapeIndex === null || shapeIndex === undefined) return undefined
    return getShapeStableIdAtIndex(doc, shapeIndex) ?? undefined
  }, [])

  useEffect(() => {
    if (dirtyRef.current) return
    lastCommittedSnapshotRef.current = {
      doc: params.annotationDoc ? cloneAnnotationDoc(params.annotationDoc) : null,
      hiddenShapeIndexes: [...params.hiddenShapeIndexes],
      hiddenClassLabels: [...params.hiddenClassLabels],
    }
  }, [params.annotationDoc, params.hiddenClassLabels, params.hiddenShapeIndexes])

  const setSelectedShape = useCallback(
    (index: SetStateAction<number | null>) => {
      params.setSelectedShapeIndex(index)
    },
    [params],
  )

  const setHoveredShape = useCallback(
    (index: SetStateAction<number | null>) => {
      params.setHoveredShapeIndex(index)
    },
    [params],
  )

  const clearSelection = useCallback(() => {
    params.setSelectedShapeIndex(null)
  }, [params])

  const commitSnapshot = useCallback(
    (nextSnapshot: AnnotationSnapshot, dirtyEvent?: InteractionDirtyEvent, options?: { persistDoc?: boolean }) => {
      const beforeCommit = cloneAnnotationSnapshot(lastCommittedSnapshotRef.current)
      if (options?.persistDoc !== false && nextSnapshot.doc) {
        params.persistAnnotation(nextSnapshot.doc)
      }
      params.setHistory((prev) => ({
        undo: [...prev.undo, beforeCommit],
        redo: [],
        lastCommitMeta: {
          source: dirtyEvent?.source ?? "command",
          shapeId: dirtyEvent?.shapeId,
          reason: dirtyEvent?.reason,
          committedAt: Date.now(),
        },
      }))
      lastCommittedSnapshotRef.current = cloneAnnotationSnapshot(nextSnapshot)
      dirtyRef.current = false
      lastDirtyEventRef.current = null
    },
    [params],
  )

  const commitDoc = useCallback(
    (nextDoc: XAnyLabelFile, dirtyEvent?: InteractionDirtyEvent) => {
      commitSnapshot(
        {
          doc: nextDoc,
          hiddenShapeIndexes: [...params.hiddenShapeIndexes],
          hiddenClassLabels: [...params.hiddenClassLabels],
        },
        dirtyEvent,
      )
    },
    [commitSnapshot, params.hiddenClassLabels, params.hiddenShapeIndexes],
  )

  const applyShapePatch = useCallback(
    (shapeIndex: number, points: number[][], options?: { persist?: boolean }) => {
      const shouldPersist = options?.persist ?? false
      const nextDoc = shapeManagement.updateShapePoints(shapeIndex, points)
      if (shouldPersist) {
        if (nextDoc) {
          commitDoc(nextDoc, {
            source: "command",
            shapeId: resolveShapeIdFromDoc(nextDoc, shapeIndex),
          })
        }
      } else {
        dirtyRef.current = true
        lastDirtyEventRef.current = {
          source: "command",
          shapeId: resolveShapeIdFromDoc(nextDoc, shapeIndex),
        }
      }
    },
    [commitDoc, resolveShapeIdFromDoc, shapeManagement],
  )

  const persistIfDirty = useCallback(() => {
    if (!dirtyRef.current || !params.annotationDoc) return
    const dirtyEvent = lastDirtyEventRef.current
    commitDoc(params.annotationDoc, dirtyEvent ?? { source: "command" })
  }, [commitDoc, params.annotationDoc])

  const undo = useCallback(() => {
    if (params.history.undo.length === 0) return
    const currentSnapshot: AnnotationSnapshot = {
      doc: params.annotationDoc ? cloneAnnotationDoc(params.annotationDoc) : null,
      hiddenShapeIndexes: [...params.hiddenShapeIndexes],
      hiddenClassLabels: [...params.hiddenClassLabels],
    }
    const previousSnapshot = cloneAnnotationSnapshot(params.history.undo[params.history.undo.length - 1]!)
    params.setAnnotationDoc(previousSnapshot.doc)
    params.setHiddenShapeIndexes(previousSnapshot.hiddenShapeIndexes)
    params.setHiddenClassLabels(previousSnapshot.hiddenClassLabels)
    params.setSelectedShapeIndex(null)
    params.setHoveredShapeIndex(null)
    if (previousSnapshot.doc) params.persistAnnotation(previousSnapshot.doc)
    params.setHistory((prev) => ({
      undo: prev.undo.slice(0, -1),
      redo: [...prev.redo, cloneAnnotationSnapshot(currentSnapshot)],
      lastCommitMeta: {
        source: "command",
        committedAt: Date.now(),
      },
    }))
    lastCommittedSnapshotRef.current = cloneAnnotationSnapshot(previousSnapshot)
    dirtyRef.current = false
    lastDirtyEventRef.current = null
  }, [params])

  const redo = useCallback(() => {
    if (params.history.redo.length === 0) return
    const currentSnapshot: AnnotationSnapshot = {
      doc: params.annotationDoc ? cloneAnnotationDoc(params.annotationDoc) : null,
      hiddenShapeIndexes: [...params.hiddenShapeIndexes],
      hiddenClassLabels: [...params.hiddenClassLabels],
    }
    const nextSnapshot = cloneAnnotationSnapshot(params.history.redo[params.history.redo.length - 1]!)
    params.setAnnotationDoc(nextSnapshot.doc)
    params.setHiddenShapeIndexes(nextSnapshot.hiddenShapeIndexes)
    params.setHiddenClassLabels(nextSnapshot.hiddenClassLabels)
    params.setSelectedShapeIndex(null)
    params.setHoveredShapeIndex(null)
    if (nextSnapshot.doc) params.persistAnnotation(nextSnapshot.doc)
    params.setHistory((prev) => ({
      undo: [...prev.undo, cloneAnnotationSnapshot(currentSnapshot)],
      redo: prev.redo.slice(0, -1),
      lastCommitMeta: {
        source: "command",
        committedAt: Date.now(),
      },
    }))
    lastCommittedSnapshotRef.current = cloneAnnotationSnapshot(nextSnapshot)
    dirtyRef.current = false
    lastDirtyEventRef.current = null
  }, [params])

  const markInteractionDirty = useCallback((event: InteractionDirtyEvent) => {
    dirtyRef.current = true
    lastDirtyEventRef.current = event
  }, [])

  const createShape = useCallback(
    ({ imagePath, imageWidth, imageHeight, shape }: CreateShapeParams) => {
      const workingDoc =
        params.annotationDoc ??
        createXAnyLabelTemplate({
          imagePath,
          imageWidth,
          imageHeight,
        })
      const shapeId = createShapeStableId()
      const nextDoc = cloneAnnotationDoc({
        ...workingDoc,
        shapes: [
          ...workingDoc.shapes,
          {
            ...shape,
            attributes: {
              ...shape.attributes,
              __eaShapeId: shapeId,
            },
          },
        ],
      })
      const shapeIndex = nextDoc.shapes.length - 1
      params.setAnnotationDoc(nextDoc)
      commitDoc(nextDoc, {
        source: "command",
        shapeId,
      })
      return { shapeIndex, shapeId } satisfies CreateShapeResult
    },
    [commitDoc, params, resolveShapeIdFromDoc],
  )

  const replaceDoc = useCallback(
    (nextDoc: XAnyLabelFile | null, options?: { resetHistory?: boolean; clearVisibility?: boolean }) => {
      const normalizedDoc = ensureDocHasStableShapeIds(nextDoc)
      params.setAnnotationDoc(normalizedDoc)
      params.setSelectedShapeIndex(null)
      params.setHoveredShapeIndex(null)
      const nextHiddenShapeIndexes = options?.clearVisibility ? [] : params.hiddenShapeIndexes
      const nextHiddenClassLabels = options?.clearVisibility ? [] : params.hiddenClassLabels
      if (options?.clearVisibility) {
        params.setHiddenShapeIndexes([])
        params.setHiddenClassLabels([])
      }
      const nextSnapshot: AnnotationSnapshot = {
        doc: normalizedDoc ? cloneAnnotationDoc(normalizedDoc) : null,
        hiddenShapeIndexes: [...nextHiddenShapeIndexes],
        hiddenClassLabels: [...nextHiddenClassLabels],
      }
      lastCommittedSnapshotRef.current = nextSnapshot
      dirtyRef.current = false
      lastDirtyEventRef.current = null
      if (options?.resetHistory) {
        params.setHistory({
          undo: [],
          redo: [],
          lastCommitMeta: null,
        })
      }
    },
    [params],
  )

  const resetDoc = useCallback(() => {
    replaceDoc(null, { resetHistory: true, clearVisibility: true })
  }, [replaceDoc])

  const deleteShape = useCallback(
    (shapeIndex: number) => {
      const shapeId = resolveShapeIdFromDoc(params.annotationDoc, shapeIndex)
      const nextDoc = shapeManagement.deleteShape(shapeIndex)
      if (!nextDoc) return
      commitDoc(nextDoc, { source: "command", shapeId })
    },
    [commitDoc, params.annotationDoc, resolveShapeIdFromDoc, shapeManagement],
  )

  const toggleShapeVisibility = useCallback(
    (shapeIndex: number) => {
      const currentHidden = params.hiddenShapeIndexes
      const nextHidden = currentHidden.includes(shapeIndex)
        ? currentHidden.filter((idx) => idx !== shapeIndex)
        : [...currentHidden, shapeIndex]
      params.setHiddenShapeIndexes(nextHidden)
      if (params.selectedShapeIndex === shapeIndex) params.setSelectedShapeIndex(null)
      if (params.hoveredShapeIndex === shapeIndex) params.setHoveredShapeIndex(null)
      commitSnapshot(
        {
          doc: params.annotationDoc ? cloneAnnotationDoc(params.annotationDoc) : null,
          hiddenShapeIndexes: nextHidden,
          hiddenClassLabels: [...params.hiddenClassLabels],
        },
        {
          source: "command",
          shapeId: resolveShapeIdFromDoc(params.annotationDoc, shapeIndex),
        },
        { persistDoc: false },
      )
    },
    [commitSnapshot, params, resolveShapeIdFromDoc],
  )

  const toggleClassVisibility = useCallback(
    (label: string) => {
      const currentHidden = params.hiddenClassLabels
      const nextHidden = currentHidden.includes(label)
        ? currentHidden.filter((item) => item !== label)
        : [...currentHidden, label]
      params.setHiddenClassLabels(nextHidden)
      const selectedShape =
        params.selectedShapeIndex !== null ? params.annotationDoc?.shapes?.[params.selectedShapeIndex] : null
      const hoveredShape =
        params.hoveredShapeIndex !== null ? params.annotationDoc?.shapes?.[params.hoveredShapeIndex] : null
      if (selectedShape?.label === label) params.setSelectedShapeIndex(null)
      if (hoveredShape?.label === label) params.setHoveredShapeIndex(null)
      commitSnapshot(
        {
          doc: params.annotationDoc ? cloneAnnotationDoc(params.annotationDoc) : null,
          hiddenShapeIndexes: [...params.hiddenShapeIndexes],
          hiddenClassLabels: nextHidden,
        },
        { source: "command" },
        { persistDoc: false },
      )
    },
    [commitSnapshot, params],
  )

  const reorderShapeLayer = useCallback(
    (shapeIndex: number, mode: LayerReorderMode) => {
      const shapeId = resolveShapeIdFromDoc(params.annotationDoc, shapeIndex)
      const nextDoc = shapeManagement.reorderShapeLayer(shapeIndex, mode)
      if (!nextDoc) return
      commitDoc(nextDoc, { source: "command", shapeId })
    },
    [commitDoc, params.annotationDoc, resolveShapeIdFromDoc, shapeManagement],
  )

  return {
    ...shapeManagement,
    deleteShape,
    toggleShapeVisibility,
    toggleClassVisibility,
    reorderShapeLayer,
    updateShapePoints: shapeManagement.updateShapePoints,
    setSelectedShape,
    setHoveredShape,
    clearSelection,
    applyShapePatch,
    markInteractionDirty,
    lastDirtyEventRef,
    persistIfDirty,
    createShape,
    replaceDoc,
    resetDoc,
    undo,
    redo,
    canUndo: params.history.undo.length > 0,
    canRedo: params.history.redo.length > 0,
  }
}

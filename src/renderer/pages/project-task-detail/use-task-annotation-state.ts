/**
 * 模块：project-task-detail/use-task-annotation-state
 * 职责：以 reducer 形式集中管理标注域状态（文档、基于 stable shapeId 的选中态、显隐态与高亮角点）。
 * 边界：仅提供状态容器，不包含写盘、交互计算与渲染转换逻辑。
 */
import { useCallback, useEffect, useReducer, useRef, type Dispatch, type SetStateAction } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { RawHighlightCorner } from "@/pages/project-task-detail/hook-shared"
import { findShapeIndexByStableId, getShapeStableIdAtIndex } from "@/pages/project-task-detail/shape-identity"

export type AnnotationHistory = {
  undo: AnnotationSnapshot[]
  redo: AnnotationSnapshot[]
  lastCommitMeta: {
    source: "canvas-engine" | "command"
    shapeId?: string
    reason?: "drag-move" | "drag-resize" | "drag-rotate" | "drag-vertex"
    committedAt: number
  } | null
}

export type AnnotationSnapshot = {
  doc: XAnyLabelFile | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
}

export function cloneAnnotationDoc(doc: XAnyLabelFile): XAnyLabelFile {
  return JSON.parse(JSON.stringify(doc)) as XAnyLabelFile
}

export function cloneAnnotationSnapshot(snapshot: AnnotationSnapshot): AnnotationSnapshot {
  return {
    doc: snapshot.doc ? cloneAnnotationDoc(snapshot.doc) : null,
    hiddenShapeIndexes: [...snapshot.hiddenShapeIndexes],
    hiddenClassLabels: [...snapshot.hiddenClassLabels],
  }
}

export type AnnotationState = {
  annotationDoc: XAnyLabelFile | null
  panelDoc: XAnyLabelFile | null
  selectedShapeId: string | null
  hoveredShapeId: string | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  rawHighlightCorner: RawHighlightCorner
  history: AnnotationHistory
}

type AnnotationAction =
  | { type: "setAnnotationDoc"; value: SetStateAction<XAnyLabelFile | null> }
  | { type: "setPanelDoc"; value: SetStateAction<XAnyLabelFile | null> }
  | { type: "setSelectedShapeId"; value: SetStateAction<string | null> }
  | { type: "setHoveredShapeId"; value: SetStateAction<string | null> }
  | { type: "setHiddenShapeIndexes"; value: SetStateAction<number[]> }
  | { type: "setHiddenClassLabels"; value: SetStateAction<string[]> }
  | { type: "setRawHighlightCorner"; value: SetStateAction<RawHighlightCorner> }
  | { type: "setHistory"; value: SetStateAction<AnnotationHistory> }

const initialAnnotationState: AnnotationState = {
  annotationDoc: null,
  panelDoc: null,
  selectedShapeId: null,
  hoveredShapeId: null,
  hiddenShapeIndexes: [],
  hiddenClassLabels: [],
  rawHighlightCorner: null,
  history: { undo: [], redo: [], lastCommitMeta: null },
}

function resolveStateAction<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === "function" ? (next as (prev: T) => T)(current) : next
}

function annotationReducer(state: AnnotationState, action: AnnotationAction): AnnotationState {
  switch (action.type) {
    case "setAnnotationDoc":
      return { ...state, annotationDoc: resolveStateAction(state.annotationDoc, action.value) }
    case "setPanelDoc":
      return { ...state, panelDoc: resolveStateAction(state.panelDoc, action.value) }
    case "setSelectedShapeId":
      return { ...state, selectedShapeId: resolveStateAction(state.selectedShapeId, action.value) }
    case "setHoveredShapeId":
      return { ...state, hoveredShapeId: resolveStateAction(state.hoveredShapeId, action.value) }
    case "setHiddenShapeIndexes":
      return { ...state, hiddenShapeIndexes: resolveStateAction(state.hiddenShapeIndexes, action.value) }
    case "setHiddenClassLabels":
      return { ...state, hiddenClassLabels: resolveStateAction(state.hiddenClassLabels, action.value) }
    case "setRawHighlightCorner":
      return { ...state, rawHighlightCorner: resolveStateAction(state.rawHighlightCorner, action.value) }
    case "setHistory":
      return { ...state, history: resolveStateAction(state.history, action.value) }
    default:
      return state
  }
}

function useDispatchSetter<TAction extends AnnotationAction["type"], TValue>(
  dispatch: Dispatch<AnnotationAction>,
  type: TAction,
) {
  return useCallback(
    (value: SetStateAction<TValue>) => {
      dispatch({ type, value } as AnnotationAction)
    },
    [dispatch, type],
  )
}

export type TaskAnnotationStore = ReturnType<typeof useTaskAnnotationState>

export function useTaskAnnotationState() {
  const [state, dispatch] = useReducer(annotationReducer, initialAnnotationState)
  const annotationDocRef = useRef<XAnyLabelFile | null>(null)

  useEffect(() => {
    annotationDocRef.current = state.annotationDoc
  }, [state.annotationDoc])

  const setAnnotationDoc = useDispatchSetter<"setAnnotationDoc", XAnyLabelFile | null>(dispatch, "setAnnotationDoc")
  const setPanelDoc = useDispatchSetter<"setPanelDoc", XAnyLabelFile | null>(dispatch, "setPanelDoc")
  const setSelectedShapeId = useDispatchSetter<"setSelectedShapeId", string | null>(dispatch, "setSelectedShapeId")
  const setHoveredShapeId = useDispatchSetter<"setHoveredShapeId", string | null>(dispatch, "setHoveredShapeId")
  const setHiddenShapeIndexes = useDispatchSetter<"setHiddenShapeIndexes", number[]>(dispatch, "setHiddenShapeIndexes")
  const setHiddenClassLabels = useDispatchSetter<"setHiddenClassLabels", string[]>(dispatch, "setHiddenClassLabels")
  const setRawHighlightCorner = useDispatchSetter<"setRawHighlightCorner", RawHighlightCorner>(dispatch, "setRawHighlightCorner")
  const setHistory = useDispatchSetter<"setHistory", AnnotationHistory>(dispatch, "setHistory")
  const selectedShapeIndex = findShapeIndexByStableId(state.annotationDoc, state.selectedShapeId)
  const hoveredShapeIndex = findShapeIndexByStableId(state.annotationDoc, state.hoveredShapeId)
  const setSelectedShapeIndex = useCallback(
    (value: SetStateAction<number | null>) => {
      const nextIndex = typeof value === "function" ? (value as (prev: number | null) => number | null)(selectedShapeIndex) : value
      setSelectedShapeId(getShapeStableIdAtIndex(annotationDocRef.current, nextIndex))
    },
    [annotationDocRef, selectedShapeIndex, setSelectedShapeId],
  )
  const setHoveredShapeIndex = useCallback(
    (value: SetStateAction<number | null>) => {
      const nextIndex = typeof value === "function" ? (value as (prev: number | null) => number | null)(hoveredShapeIndex) : value
      setHoveredShapeId(getShapeStableIdAtIndex(annotationDocRef.current, nextIndex))
    },
    [annotationDocRef, hoveredShapeIndex, setHoveredShapeId],
  )

  return {
    annotationDoc: state.annotationDoc,
    setAnnotationDoc,
    panelDoc: state.panelDoc,
    setPanelDoc,
    selectedShapeId: state.selectedShapeId,
    setSelectedShapeId,
    hoveredShapeId: state.hoveredShapeId,
    setHoveredShapeId,
    selectedShapeIndex,
    setSelectedShapeIndex,
    hoveredShapeIndex,
    setHoveredShapeIndex,
    hiddenShapeIndexes: state.hiddenShapeIndexes,
    setHiddenShapeIndexes,
    hiddenClassLabels: state.hiddenClassLabels,
    setHiddenClassLabels,
    rawHighlightCorner: state.rawHighlightCorner,
    setRawHighlightCorner,
    history: state.history,
    setHistory,
    annotationDocRef,
  }
}

/**
 * 模块：project-task-detail/use-task-shortcuts
 * 职责：集中处理页面快捷键（Esc / Backspace / Delete）。
 * 边界：只绑定键盘行为，不直接管理工具状态机定义。
 */
import { useEffect } from "react"
import type { RightToolMode } from "@/pages/project-task-detail/types"

type UseTaskShortcutsParams = {
  rightToolMode: RightToolMode
  polygonDraftPointCount: number
  hasMaskDraft: boolean
  selectedShapeId: string | null
  hoveredShapeId: string | null
  resolveShapeIndexById: (shapeId: string | null) => number | null
  clearPolygonDraft: () => void
  clearMaskTransientState: () => void
  handleSelectToolClick: () => void
  popPolygonPoint: () => void
  deleteShape: (shapeIndex: number) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useTaskShortcuts({
  rightToolMode,
  polygonDraftPointCount,
  hasMaskDraft,
  selectedShapeId,
  hoveredShapeId,
  resolveShapeIndexById,
  clearPolygonDraft,
  clearMaskTransientState,
  handleSelectToolClick,
  popPolygonPoint,
  deleteShape,
  undo,
  redo,
  canUndo,
  canRedo,
}: UseTaskShortcutsParams) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.ctrlKey || event.metaKey
      const lowerKey = event.key.toLowerCase()
      if (isModifierPressed && lowerKey === "z") {
        event.preventDefault()
        if (event.shiftKey) {
          if (canRedo) redo()
          return
        }
        if (canUndo) undo()
        return
      }
      if (isModifierPressed && lowerKey === "y") {
        event.preventDefault()
        if (canRedo) redo()
        return
      }
      if (event.key === "Escape") {
        if (rightToolMode === "polygon" && polygonDraftPointCount > 0) {
          event.preventDefault()
          clearPolygonDraft()
          return
        }
        if (rightToolMode === "mask" && hasMaskDraft) {
          event.preventDefault()
          clearMaskTransientState()
          return
        }
        handleSelectToolClick()
        return
      }
      if (event.key === "Backspace" && rightToolMode === "polygon" && polygonDraftPointCount > 0) {
        event.preventDefault()
        popPolygonPoint()
        return
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return
      const targetIndex = resolveShapeIndexById(selectedShapeId ?? hoveredShapeId)
      if (targetIndex === null) return
      event.preventDefault()
      deleteShape(targetIndex)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    clearMaskTransientState,
    clearPolygonDraft,
    canRedo,
    canUndo,
    deleteShape,
    handleSelectToolClick,
    hasMaskDraft,
    hoveredShapeId,
    polygonDraftPointCount,
    popPolygonPoint,
    redo,
    rightToolMode,
    resolveShapeIndexById,
    selectedShapeId,
    undo,
  ])
}

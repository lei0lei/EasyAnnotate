/**
 * 模块：project-task-detail/use-task-shortcuts
 * 职责：标注页快捷键；上一张/下一张、切换选择模式、删除、撤销/重做、新建标注均走 app-config。
 * 使用 capture 阶段并 stopPropagation；首张/末张仍消费翻页键；在带 data-ea-app-chrome 的顶栏/侧栏内额外吞掉未处理的单字符键，避免 D/F 等触发列表 typeahead。
 * 「新建标注」在尚未从工具栏完成过一次标签确认前不响应快捷键。
 */
import { useEffect } from "react"
import { getEffectiveShortcutBinding } from "@/lib/app-shortcut-registry"
import { bindingMatchesEvent, isEditableKeyboardTarget } from "@/lib/keyboard-shortcut-match"
import type { RightToolMode } from "@/pages/project-task-detail/types"

/** 拦截默认行为并阻止向下传递，避免焦点在标题栏等控件上时被 Radix/Chromium 当作 typeahead 选中按钮 */
function consumeShortcutEvent(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
}

/** 用 activeElement + Element.closest：侧栏内焦点可能在 SVG 等非 HTMLElement 上，仅用 HTMLElement 会漏判，导致 D/F 仍触发 nav typeahead 出现 focus ring */
function isInsideAppLayoutChrome(focusOwner: EventTarget | null): boolean {
  if (!focusOwner || !(focusOwner instanceof Node)) return false
  const el = focusOwner instanceof Element ? focusOwner : focusOwner.parentElement
  return Boolean(el?.closest("[data-ea-app-chrome]"))
}

/** 侧边栏/顶栏里容易触发列表 typeahead 的单键（不含空格，避免挡掉按钮/链接的 Space 激活） */
function isLikelyChromeTypeaheadKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const k = event.key
  return k.length === 1 && k !== " "
}

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
  canGoPrevImage: boolean
  canGoNextImage: boolean
  goPrevImage: () => void
  goNextImage: () => void
  canRepeatNewAnnotation: boolean
  repeatNewAnnotation: () => void
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
  canGoPrevImage,
  canGoNextImage,
  goPrevImage,
  goNextImage,
  canRepeatNewAnnotation,
  repeatNewAnnotation,
}: UseTaskShortcutsParams) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return

      const focusInAppChrome = isInsideAppLayoutChrome(document.activeElement)

      const undoBinding = getEffectiveShortcutBinding("undo")
      if (bindingMatchesEvent(undoBinding, event)) {
        consumeShortcutEvent(event)
        if (canUndo) undo()
        return
      }
      const redoBinding = getEffectiveShortcutBinding("redo")
      if (bindingMatchesEvent(redoBinding, event)) {
        consumeShortcutEvent(event)
        if (canRedo) redo()
        return
      }

      const prevImgBinding = getEffectiveShortcutBinding("img-prev")
      if (bindingMatchesEvent(prevImgBinding, event)) {
        consumeShortcutEvent(event)
        if (canGoPrevImage) goPrevImage()
        return
      }
      const nextImgBinding = getEffectiveShortcutBinding("img-next")
      if (bindingMatchesEvent(nextImgBinding, event)) {
        consumeShortcutEvent(event)
        if (canGoNextImage) goNextImage()
        return
      }

      const newAnnBinding = getEffectiveShortcutBinding("new-annotation")
      if (bindingMatchesEvent(newAnnBinding, event)) {
        if (canRepeatNewAnnotation) {
          consumeShortcutEvent(event)
          repeatNewAnnotation()
        }
        return
      }

      const selectBinding = getEffectiveShortcutBinding("select-tool")
      if (bindingMatchesEvent(selectBinding, event)) {
        if (rightToolMode === "polygon" && polygonDraftPointCount > 0) {
          consumeShortcutEvent(event)
          clearPolygonDraft()
          return
        }
        if (rightToolMode === "mask" && hasMaskDraft) {
          consumeShortcutEvent(event)
          clearMaskTransientState()
          return
        }
        consumeShortcutEvent(event)
        handleSelectToolClick()
        return
      }

      if (event.key === "Backspace" && rightToolMode === "polygon" && polygonDraftPointCount > 0) {
        consumeShortcutEvent(event)
        popPolygonPoint()
        return
      }

      const delBinding = getEffectiveShortcutBinding("del")
      if (!bindingMatchesEvent(delBinding, event)) {
        if (focusInAppChrome && isLikelyChromeTypeaheadKey(event)) {
          consumeShortcutEvent(event)
        }
        return
      }
      const targetIndex = resolveShapeIndexById(selectedShapeId ?? hoveredShapeId)
      if (targetIndex === null) {
        if (focusInAppChrome && isLikelyChromeTypeaheadKey(event)) {
          consumeShortcutEvent(event)
        }
        return
      }
      consumeShortcutEvent(event)
      deleteShape(targetIndex)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [
    clearMaskTransientState,
    clearPolygonDraft,
    canGoNextImage,
    canGoPrevImage,
    canRedo,
    canRepeatNewAnnotation,
    canUndo,
    deleteShape,
    goNextImage,
    goPrevImage,
    handleSelectToolClick,
    repeatNewAnnotation,
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

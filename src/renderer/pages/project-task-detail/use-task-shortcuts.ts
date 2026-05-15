/**
 * 模块：project-task-detail/use-task-shortcuts
 * 职责：标注页快捷键；上一张/下一张、切换选择模式、删除、撤销/重做、新建标注均走 app-config。
 * 使用 capture 阶段并 stopPropagation；首张/末张仍消费翻页键；在带 data-ea-app-chrome 的顶栏/侧栏内额外吞掉未处理的单字符键，避免 D/F 等触发列表 typeahead。
 * 「新建标注」在尚未从工具栏完成过一次标签确认前不响应快捷键（SAM2 用 N 续标除外，见 tryResumeSam2AfterCommit）。
 * AI 工具（SAM2）：与「切换选择模式」同键（默认 Escape）时，若本轮有点/预览则先撤销本轮；否则再收起 AI 并进入选择。新建标注键（默认 N）在 SAM2 态下用于确认当前预览 mask 并开始下一轮。
 * 标签类 `<select>` 不视为「输入框」：焦点在其上时仍响应上一张/下一张等全局快捷键。
 */
import { useEffect } from "react"
import { getEffectiveShortcutBinding } from "@/lib/app-shortcut-registry"
import { bindingMatchesEvent } from "@/lib/keyboard-shortcut-match"
import type { RightToolMode } from "@/pages/project-task-detail/types"

/**
 * 仅在「真·文本输入」控件上让出全局快捷键（INPUT/TEXTAREA/contenteditable）。
 * SAM2 面板的 `<select>` 不算：否则焦点在标签下拉上时整段 return，翻页等快捷键永远不触发。
 */
function shouldDeferGlobalShortcutsToNativeControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === "TEXTAREA") return true
  if (tag === "INPUT") return true
  return false
}

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
  /** 与 select-tool 同键按下时先执行：关闭 SAM2 面板、退出 SAM2 标注态等 */
  dismissAiToolUi?: () => void
  /** SAM2 标注态：Escape 优先撤销本轮（点/预览），不退出工具 */
  sam2AnnotatingActive?: boolean
  sam2HasCancelableRound?: boolean
  cancelSam2Round?: () => void
  /** SAM2 标注态：N（new-annotation）确认当前预览 mask 并开始下一轮 */
  commitSam2DraftAndNew?: () => void
  /** SAM2：上次用 N 提交并进入选择后，再按 N 可回到 SAM2 标注并沿用面板中的各项设置 */
  tryResumeSam2AfterCommit?: () => boolean
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
  dismissAiToolUi,
  sam2AnnotatingActive,
  sam2HasCancelableRound,
  cancelSam2Round,
  commitSam2DraftAndNew,
  tryResumeSam2AfterCommit,
}: UseTaskShortcutsParams) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const selectBinding = getEffectiveShortcutBinding("select-tool")
      const matchesSelectTool = bindingMatchesEvent(selectBinding, event)
      const inSam2PickerPanel =
        event.target instanceof Node &&
        Boolean(document.querySelector("[data-ea-sam2-picker-panel]")?.contains(event.target))
      if (shouldDeferGlobalShortcutsToNativeControl(event.target) && !(matchesSelectTool && inSam2PickerPanel)) return

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
        if (sam2AnnotatingActive && commitSam2DraftAndNew) {
          consumeShortcutEvent(event)
          commitSam2DraftAndNew()
          return
        }
        if (tryResumeSam2AfterCommit?.()) {
          consumeShortcutEvent(event)
          return
        }
        if (canRepeatNewAnnotation) {
          consumeShortcutEvent(event)
          repeatNewAnnotation()
        }
        return
      }

      if (matchesSelectTool) {
        if (sam2AnnotatingActive && sam2HasCancelableRound && cancelSam2Round) {
          consumeShortcutEvent(event)
          cancelSam2Round()
          return
        }
        dismissAiToolUi?.()
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
    dismissAiToolUi,
    sam2AnnotatingActive,
    sam2HasCancelableRound,
    cancelSam2Round,
    clearMaskTransientState,
    clearPolygonDraft,
    commitSam2DraftAndNew,
    tryResumeSam2AfterCommit,
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

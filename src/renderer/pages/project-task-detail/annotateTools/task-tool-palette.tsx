/**
 * 模块：project-task-detail/annotateTools/task-tool-palette
 * 职责：组合并渲染右侧标注工具栏，并在当前工具旁展示标签选择弹出框。
 * 边界：仅做工具按钮编排，不处理具体工具逻辑。
 */
import { useCallback, useEffect, useRef, type RefObject } from "react"
import { TaskRectLabelPicker } from "@/pages/project-task-detail/components"
import { Box3dToolButton } from "./box3d-tool-button"
import { MaskToolButton } from "./circle-tool-button"
import { KeypointToolButton } from "./keypoint-tool-button"
import { PolygonToolButton } from "./polygon-tool-button"
import { RectToolButton } from "./rect-tool-button"
import { RotRectToolButton } from "./rot-rect-tool-button"
import { SelectToolButton } from "./select-tool-button"
import { SkeletonToolButton } from "./skeleton-tool-button"
import type { TaskToolPaletteProps } from "./types"

type ToolRefKey = "rectangle" | "rotation" | "polygon" | "mask" | "keypoint" | "box3d" | "skeleton"

export function TaskToolPalette({
  rightToolMode,
  onSelectTool,
  onStartRectTool,
  onStartRotRectTool,
  onStartPolygonTool,
  onStartMaskTool,
  onStartKeypointTool,
  onStartBox3dTool,
  onStartSkeletonTool,
  onClearSelection,
  rectPickerProps,
}: TaskToolPaletteProps) {
  const toolbarShellRef = useRef<HTMLDivElement | null>(null)
  const refRect = useRef<HTMLDivElement | null>(null)
  const refRotRect = useRef<HTMLDivElement | null>(null)
  const refPolygon = useRef<HTMLDivElement | null>(null)
  const refMask = useRef<HTMLDivElement | null>(null)
  const refKeypoint = useRef<HTMLDivElement | null>(null)
  const refBox3d = useRef<HTMLDivElement | null>(null)
  const refSkeleton = useRef<HTMLDivElement | null>(null)

  const getAnchor = useCallback((): HTMLElement | null => {
    if (!rectPickerProps.rectPickerOpen) return null
    const t = rectPickerProps.drawShapeType
    const map: Record<ToolRefKey, RefObject<HTMLDivElement | null>> = {
      rectangle: refRect,
      rotation: refRotRect,
      polygon: refPolygon,
      mask: refMask,
      keypoint: refKeypoint,
      box3d: refBox3d,
      skeleton: refSkeleton,
    }
    if (t in map) {
      return map[t as ToolRefKey].current
    }
    return null
  }, [rectPickerProps.drawShapeType, rectPickerProps.rectPickerOpen])

  useEffect(() => {
    if (!rectPickerProps.rectPickerOpen) return
    const onCancel = rectPickerProps.onCancel
    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (toolbarShellRef.current?.contains(target)) return
      const panel = document.querySelector("[data-ea-label-picker-panel]")
      if (panel?.contains(target)) return
      onCancel()
    }
    document.addEventListener("pointerdown", onPointerDownCapture, true)
    return () => document.removeEventListener("pointerdown", onPointerDownCapture, true)
  }, [rectPickerProps.onCancel, rectPickerProps.rectPickerOpen])

  return (
    <div ref={toolbarShellRef} className="absolute top-1/2 right-4 z-50 -translate-y-1/2" data-ea-task-tool-palette="">
      <TaskRectLabelPicker {...rectPickerProps} getAnchor={getAnchor} />
      <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-background/95 p-2 shadow-sm">
        <SelectToolButton active={rightToolMode === "select"} onSelectTool={onSelectTool} />
        <div ref={refRect} className="inline-flex">
          <RectToolButton active={rightToolMode === "rect"} onStartRectTool={onStartRectTool} onClearSelection={onClearSelection} />
        </div>
        <div ref={refRotRect} className="inline-flex">
          <RotRectToolButton
            active={rightToolMode === "rotRect"}
            onStartRotRectTool={onStartRotRectTool}
            onClearSelection={onClearSelection}
          />
        </div>
        <div ref={refPolygon} className="inline-flex">
          <PolygonToolButton
            active={rightToolMode === "polygon"}
            onStartPolygonTool={onStartPolygonTool}
            onClearSelection={onClearSelection}
          />
        </div>
        <div ref={refMask} className="inline-flex">
          <MaskToolButton active={rightToolMode === "mask"} onStartMaskTool={onStartMaskTool} />
        </div>
        <div ref={refKeypoint} className="inline-flex">
          <KeypointToolButton active={rightToolMode === "keypoint"} onStartKeypointTool={onStartKeypointTool} />
        </div>
        <div ref={refBox3d} className="inline-flex">
          <Box3dToolButton active={rightToolMode === "box3d"} onStartBox3dTool={onStartBox3dTool} />
        </div>
        <div ref={refSkeleton} className="inline-flex">
          <SkeletonToolButton active={rightToolMode === "skeleton"} onStartSkeletonTool={onStartSkeletonTool} />
        </div>
      </div>
    </div>
  )
}

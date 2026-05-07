import { useCallback, useEffect, useMemo, useReducer, useState } from "react"
import type { RightToolMode } from "@/pages/project-task-detail/types"
import {
  getActiveTool,
  getDrawShapeType,
  getToolDraft,
  getToolWorkflowPhase,
  initialToolState,
  isRectDrawingEnabled,
  isRectPickerOpen,
  toolReducer,
  type DrawShapeWithPolygon,
} from "@/pages/project-task-detail/tool-state"

type UseToolWorkflowBindingsParams = {
  annotationLabelOptionsPlain: string[]
  annotationLabelOptionsSkeleton: string[]
  clearToolTransientInteractions: () => void
}

export function useToolWorkflowBindings({
  annotationLabelOptionsPlain,
  annotationLabelOptionsSkeleton,
  clearToolTransientInteractions,
}: UseToolWorkflowBindingsParams) {
  const [toolState, dispatchTool] = useReducer(toolReducer, initialToolState)
  const [rectPendingLabel, setRectPendingLabel] = useState("")
  /** 本次 Mask 流程在点 OK 进入绘制时锁定的标签；到离开「mask + drawing」或取消/选工具前不变。 */
  const [maskDrawingSessionLabel, setMaskDrawingSessionLabel] = useState<string | null>(null)

  const rightToolMode = getActiveTool(toolState)
  const drawShapeType = getDrawShapeType(toolState)

  const annotationLabelsAllowedForDrawShape = useMemo(
    () => (drawShapeType === "skeleton" ? annotationLabelOptionsSkeleton : annotationLabelOptionsPlain),
    [annotationLabelOptionsPlain, annotationLabelOptionsSkeleton, drawShapeType],
  )
  const { rectFirstPoint, rectHoverPoint, polygonDraftPoints, polygonHoverPoint } = getToolDraft(toolState)
  const toolWorkflowPhase = getToolWorkflowPhase(toolState)
  const rectPickerOpen = isRectPickerOpen(toolState)
  const rectDrawingEnabled = isRectDrawingEnabled(toolState)
  const rectDrawShapeType: "rectangle" | "rotation" = drawShapeType === "rotation" ? "rotation" : "rectangle"

  const handleSelectToolClick = useCallback(() => {
    setMaskDrawingSessionLabel(null)
    dispatchTool({ type: "exitToEditing" })
    clearToolTransientInteractions()
  }, [clearToolTransientInteractions])

  const handleRectPickerConfirm = useCallback(() => {
    const label = rectPendingLabel.trim()
    if (!label) return
    if (drawShapeType === "mask") {
      setMaskDrawingSessionLabel(label)
    } else {
      setMaskDrawingSessionLabel(null)
    }
    dispatchTool({ type: "enterDrawing" })
  }, [rectPendingLabel, drawShapeType])

  const handleRectPickerCancel = useCallback(() => {
    setMaskDrawingSessionLabel(null)
    dispatchTool({ type: "cancelPicking" })
  }, [])

  /** 跳过标签弹窗，直接进入绘制（与点「确定」后状态一致） */
  const startDrawingWithPreset = useCallback(
    (params: {
      mode: Exclude<RightToolMode, "select" | "circle" | "text">
      drawShapeType: DrawShapeWithPolygon
      label: string
    }) => {
      const t = params.label.trim()
      const allowed = params.mode === "skeleton" ? annotationLabelOptionsSkeleton : annotationLabelOptionsPlain
      if (!t || !allowed.includes(t)) return
      setRectPendingLabel(t)
      if (params.drawShapeType === "mask") {
        setMaskDrawingSessionLabel(t)
      } else {
        setMaskDrawingSessionLabel(null)
      }
      dispatchTool({ type: "enterPickingLabel", mode: params.mode, drawShapeType: params.drawShapeType })
      dispatchTool({ type: "enterDrawing" })
    },
    [annotationLabelOptionsPlain, annotationLabelOptionsSkeleton, dispatchTool],
  )

  const handleStartMaskTool = useCallback(() => {
    setMaskDrawingSessionLabel(null)
    dispatchTool({ type: "enterPickingLabel", mode: "mask", drawShapeType: "mask" })
  }, [])

  const handleStartKeypointTool = useCallback(() => {
    setMaskDrawingSessionLabel(null)
    dispatchTool({ type: "enterPickingLabel", mode: "keypoint", drawShapeType: "keypoint" })
  }, [])

  const handleStartBox3dTool = useCallback(() => {
    setMaskDrawingSessionLabel(null)
    dispatchTool({ type: "enterPickingLabel", mode: "box3d", drawShapeType: "box3d" })
  }, [])

  const handleStartSkeletonTool = useCallback(() => {
    setMaskDrawingSessionLabel(null)
    dispatchTool({ type: "enterPickingLabel", mode: "skeleton", drawShapeType: "skeleton" })
  }, [])

  useEffect(() => {
    if (!rectPendingLabel || !annotationLabelsAllowedForDrawShape.includes(rectPendingLabel)) {
      setRectPendingLabel(annotationLabelsAllowedForDrawShape[0] ?? "")
    }
  }, [annotationLabelsAllowedForDrawShape, rectPendingLabel])

  useEffect(() => {
    if (!(toolWorkflowPhase === "drawing" && drawShapeType === "mask")) {
      setMaskDrawingSessionLabel(null)
    }
  }, [toolWorkflowPhase, drawShapeType])

  return useMemo(
    () => ({
      dispatchTool,
      rightToolMode,
      drawShapeType,
      rectFirstPoint,
      rectHoverPoint,
      polygonDraftPoints,
      polygonHoverPoint,
      toolWorkflowPhase,
      rectPickerOpen,
      rectDrawingEnabled,
      rectDrawShapeType,
      handleSelectToolClick,
      handleRectPickerConfirm,
      handleRectPickerCancel,
      handleStartKeypointTool,
      handleStartBox3dTool,
      handleStartSkeletonTool,
      handleStartMaskTool,
      rectPendingLabel,
      setRectPendingLabel,
      maskDrawingSessionLabel,
      startDrawingWithPreset,
    }),
    [
      drawShapeType,
      handleRectPickerCancel,
      handleRectPickerConfirm,
      handleSelectToolClick,
      handleStartBox3dTool,
      handleStartKeypointTool,
      handleStartSkeletonTool,
      handleStartMaskTool,
      maskDrawingSessionLabel,
      rectPendingLabel,
      startDrawingWithPreset,
      polygonDraftPoints,
      polygonHoverPoint,
      rectDrawingEnabled,
      rectDrawShapeType,
      rectFirstPoint,
      rectHoverPoint,
      rectPickerOpen,
      rightToolMode,
      toolWorkflowPhase,
    ],
  )
}

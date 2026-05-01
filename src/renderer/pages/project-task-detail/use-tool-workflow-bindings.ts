import { useCallback, useEffect, useMemo, useReducer, useState } from "react"
import {
  getActiveTool,
  getDrawShapeType,
  getToolDraft,
  getToolWorkflowPhase,
  initialToolState,
  isRectDrawingEnabled,
  isRectPickerOpen,
  toolReducer,
} from "@/pages/project-task-detail/tool-state"

type UseToolWorkflowBindingsParams = {
  annotationLabelOptions: string[]
  clearToolTransientInteractions: () => void
}

export function useToolWorkflowBindings({ annotationLabelOptions, clearToolTransientInteractions }: UseToolWorkflowBindingsParams) {
  const [toolState, dispatchTool] = useReducer(toolReducer, initialToolState)
  const [rectPendingLabel, setRectPendingLabel] = useState("")

  const rightToolMode = getActiveTool(toolState)
  const drawShapeType = getDrawShapeType(toolState)
  const { rectFirstPoint, rectHoverPoint, polygonDraftPoints, polygonHoverPoint } = getToolDraft(toolState)
  const toolWorkflowPhase = getToolWorkflowPhase(toolState)
  const rectPickerOpen = isRectPickerOpen(toolState)
  const rectDrawingEnabled = isRectDrawingEnabled(toolState)
  const rectDrawShapeType: "rectangle" | "rotation" = drawShapeType === "rotation" ? "rotation" : "rectangle"

  const handleSelectToolClick = useCallback(() => {
    dispatchTool({ type: "exitToEditing" })
    clearToolTransientInteractions()
  }, [clearToolTransientInteractions])

  const handleRectPickerConfirm = useCallback(() => {
    if (!rectPendingLabel) return
    dispatchTool({ type: "enterDrawing" })
  }, [rectPendingLabel])

  const handleRectPickerCancel = useCallback(() => {
    dispatchTool({ type: "cancelPicking" })
  }, [])

  const handleStartMaskTool = useCallback(() => {
    dispatchTool({ type: "enterPickingLabel", mode: "mask", drawShapeType: "mask" })
  }, [])

  const handleStartKeypointTool = useCallback(() => {
    dispatchTool({ type: "enterPickingLabel", mode: "keypoint", drawShapeType: "keypoint" })
  }, [])

  const handleStartBox3dTool = useCallback(() => {
    dispatchTool({ type: "enterPickingLabel", mode: "box3d", drawShapeType: "box3d" })
  }, [])

  const handleStartSkeletonTool = useCallback(() => {
    dispatchTool({ type: "enterPickingLabel", mode: "skeleton", drawShapeType: "skeleton" })
  }, [])

  useEffect(() => {
    if (!rectPendingLabel || !annotationLabelOptions.includes(rectPendingLabel)) {
      setRectPendingLabel(annotationLabelOptions[0] ?? "")
    }
  }, [annotationLabelOptions, rectPendingLabel])

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
      rectPendingLabel,
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

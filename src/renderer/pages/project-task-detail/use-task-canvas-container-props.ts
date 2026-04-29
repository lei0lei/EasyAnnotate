import { useMemo } from "react"
import type { TaskCanvasContainerProps } from "@/pages/project-task-detail/canvas-container"

type UseTaskCanvasContainerPropsParams = TaskCanvasContainerProps

export function useTaskCanvasContainerProps(params: UseTaskCanvasContainerPropsParams) {
  return useMemo(() => params, [params])
}

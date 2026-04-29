/**
 * 模块：project-task-detail/use-task-session-state
 * 职责：聚合任务会话层只读状态（当前文件标识与当前标注文档）。
 * 边界：仅做状态投影，不执行副作用或持久化。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { useMemo } from "react"

type UseTaskSessionStateParams = {
  activeImagePath: string
  fallbackFileId: string
  annotationDoc: XAnyLabelFile | null
  panelDoc: XAnyLabelFile | null
}

export function useTaskSessionState({ activeImagePath, fallbackFileId, annotationDoc, panelDoc }: UseTaskSessionStateParams) {
  return useMemo(
    () => ({
      currentFileId: activeImagePath || fallbackFileId,
      currentDoc: annotationDoc,
      currentPanelDoc: panelDoc,
    }),
    [activeImagePath, fallbackFileId, annotationDoc, panelDoc],
  )
}

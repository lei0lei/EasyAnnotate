/**
 * 模块：project-task-detail/use-task-data-sync
 * 职责：负责标注文档读取/写入与图片元信息同步。
 * 边界：处理数据层同步，不负责 UI 展示。
 */
import { useCallback, useEffect } from "react"
import { getImageFileInfo, writeImageAnnotation } from "@/lib/projects-api"
import { type XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { ShapeDragAction } from "@/pages/project-task-detail/types"
import type { AnnotationDocRef, ImageFileInfo } from "@/pages/project-task-detail/hook-shared"
import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"

type UseTaskDataSyncParams = {
  activeImagePath: string
  annotationDoc: XAnyLabelFile | null
  shapeDragAction: ShapeDragAction | null
  annotationDocRef: AnnotationDocRef
  setPanelDoc: (value: XAnyLabelFile | null) => void
  setImageFileInfo: (value: ImageFileInfo) => void
}

export function useTaskDataSync(params: UseTaskDataSyncParams) {
  const {
    activeImagePath,
    annotationDoc,
    shapeDragAction,
    annotationDocRef,
    setPanelDoc,
    setImageFileInfo,
  } = params

  useEffect(() => {
    annotationDocRef.current = annotationDoc
  }, [annotationDoc, annotationDocRef])

  useEffect(() => {
    if (!shapeDragAction) setPanelDoc(annotationDoc)
  }, [annotationDoc, setPanelDoc, shapeDragAction])

  useEffect(() => {
    let alive = true
    if (!activeImagePath) {
      setImageFileInfo({ exists: false, sizeBytes: 0, format: "", channelCount: 0, extension: "", errorMessage: "" })
      return
    }
    void getImageFileInfo(activeImagePath).then((result) => {
      if (!alive) return
      setImageFileInfo(result)
    })
    return () => {
      alive = false
    }
  }, [activeImagePath, setImageFileInfo])

  const persistAnnotation = useCallback(
    (nextDoc: XAnyLabelFile) => {
      if (!activeImagePath) return
      const normalized = normalizeDocPointsToInt(nextDoc)
      void writeImageAnnotation({
        imagePath: activeImagePath,
        jsonText: JSON.stringify(normalized, null, 2),
      })
    },
    [activeImagePath],
  )

  return { persistAnnotation }
}

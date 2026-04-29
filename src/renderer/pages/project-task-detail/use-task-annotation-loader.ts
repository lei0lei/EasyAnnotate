/**
 * 模块：project-task-detail/use-task-annotation-loader
 * 职责：在切换图片后读取标注，并通过命令入口注入文档。
 * 边界：仅负责加载与归一化，不处理持久化写盘。
 */
import { useEffect } from "react"
import { readImageAnnotation } from "@/lib/projects-api"
import { normalizeXAnyLabelDoc } from "@/lib/xanylabeling-format"
import type { ImageSize } from "@/pages/project-task-detail/hook-shared"
import { ensureDocHasStableShapeIds } from "@/pages/project-task-detail/shape-identity"
import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"

type UseTaskAnnotationLoaderParams = {
  currentFileId: string
  imageNaturalSize: ImageSize
  replaceDoc: (nextDoc: ReturnType<typeof normalizeDocPointsToInt> | null, options?: { resetHistory?: boolean; clearVisibility?: boolean }) => void
}

export function useTaskAnnotationLoader({ currentFileId, imageNaturalSize, replaceDoc }: UseTaskAnnotationLoaderParams) {
  useEffect(() => {
    let alive = true
    if (!currentFileId || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0) return
    void readImageAnnotation(currentFileId).then((result) => {
      if (!alive) return
      if (result.errorMessage) return
      const doc = normalizeXAnyLabelDoc({
        imagePath: currentFileId,
        imageWidth: imageNaturalSize.width,
        imageHeight: imageNaturalSize.height,
        rawJsonText: result.exists ? result.jsonText : "",
      })
      replaceDoc(ensureDocHasStableShapeIds(normalizeDocPointsToInt(doc)), { resetHistory: true, clearVisibility: true })
    })
    return () => {
      alive = false
    }
  }, [currentFileId, imageNaturalSize.height, imageNaturalSize.width, replaceDoc])
}

/**
 * 模块：project-task-detail/use-task-annotation-loader
 * 职责：在切换图片后读取标注，并通过命令入口注入文档。
 * 边界：仅负责加载与归一化，不处理持久化写盘。
 */
import { useEffect } from "react"
import { readImageAnnotation } from "@/lib/projects-api"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { normalizeXAnyLabelDoc } from "@/lib/xanylabeling-format"
import type { ImageSize } from "@/pages/project-task-detail/hook-shared"
import { ensureDocHasStableShapeIds } from "@/pages/project-task-detail/shape-identity"
import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"

type UseTaskAnnotationLoaderParams = {
  currentFileId: string
  imageNaturalSize: ImageSize
  replaceDoc: (nextDoc: ReturnType<typeof normalizeDocPointsToInt> | null, options?: { resetHistory?: boolean; clearVisibility?: boolean }) => void
}

function remapDocPointsToCurrentImageSize(doc: XAnyLabelFile, nextWidth: number, nextHeight: number): XAnyLabelFile {
  const prevWidth = Math.max(1, Number(doc.imageWidth) || 1)
  const prevHeight = Math.max(1, Number(doc.imageHeight) || 1)
  const targetWidth = Math.max(1, nextWidth)
  const targetHeight = Math.max(1, nextHeight)
  if (prevWidth === targetWidth && prevHeight === targetHeight) {
    return {
      ...doc,
      imageWidth: targetWidth,
      imageHeight: targetHeight,
    }
  }
  const scaleX = targetWidth / prevWidth
  const scaleY = targetHeight / prevHeight
  return {
    ...doc,
    imageWidth: targetWidth,
    imageHeight: targetHeight,
    shapes: doc.shapes.map((shape) => ({
      ...shape,
      points: shape.points.map((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) return pt
        const x = Number(pt[0])
        const y = Number(pt[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) return pt
        return [x * scaleX, y * scaleY]
      }),
    })),
  }
}

export function useTaskAnnotationLoader({ currentFileId, imageNaturalSize, replaceDoc }: UseTaskAnnotationLoaderParams) {
  useEffect(() => {
    let alive = true
    if (!currentFileId || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0) return
    void readImageAnnotation(currentFileId).then((result) => {
      if (!alive) return
      // 标注读取失败（例如文件过大被主进程保护拦截）时，不应让 doc 保持 null。
      // 否则 SAM 点位与 embeddings 可见，但预览 mask 不会进入渲染链路。
      const rawJsonText = result.errorMessage ? "" : result.exists ? result.jsonText : ""
      const doc = normalizeXAnyLabelDoc({
        imagePath: currentFileId,
        imageWidth: imageNaturalSize.width,
        imageHeight: imageNaturalSize.height,
        rawJsonText,
      })
      // 当标注中的尺寸基准与当前图片真实尺寸不一致时（如导入数据坐标系差异），按比例重映射点位后再渲染。
      const remappedDoc = remapDocPointsToCurrentImageSize(doc, imageNaturalSize.width, imageNaturalSize.height)
      replaceDoc(ensureDocHasStableShapeIds(normalizeDocPointsToInt(remappedDoc)), {
        resetHistory: true,
        clearVisibility: true,
      })
    })
    return () => {
      alive = false
    }
  }, [currentFileId, imageNaturalSize.height, imageNaturalSize.width, replaceDoc])
}

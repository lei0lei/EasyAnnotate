/**
 * 模块：project-task-detail/use-task-file-actions
 * 职责：封装图片与标注文件动作（下载、删图、删标注）。
 * 边界：仅处理文件动作，不处理键盘与画布交互。
 */
import { deleteImageAnnotation, deleteTaskImage, downloadTaskImage } from "@/lib/projects-api"
import { createXAnyLabelTemplate, type XAnyLabelFile } from "@/lib/xanylabeling-format"

type UseTaskFileActionsParams = {
  currentFileId: string
  fallbackFilePath: string
  imageNaturalSize: { width: number; height: number }
  replaceDoc: (nextDoc: XAnyLabelFile | null, options?: { resetHistory?: boolean; clearVisibility?: boolean }) => void
  setSelectedShapeIndex: (index: number | null) => void
  setHoveredShapeIndex: (index: number | null) => void
  setHiddenShapeIndexes: (indexes: number[]) => void
  setHiddenClassLabels: (labels: string[]) => void
  setError: (value: string | null) => void
  reloadTaskFiles: () => Promise<void>
}

export function useTaskFileActions({
  currentFileId,
  fallbackFilePath,
  imageNaturalSize,
  replaceDoc,
  setSelectedShapeIndex,
  setHoveredShapeIndex,
  setHiddenShapeIndexes,
  setHiddenClassLabels,
  setError,
  reloadTaskFiles,
}: UseTaskFileActionsParams) {
  const clearCurrentImageShapes = () => {
    const nextDoc =
      currentFileId && imageNaturalSize.width > 0 && imageNaturalSize.height > 0
        ? createXAnyLabelTemplate({
            imagePath: currentFileId,
            imageWidth: imageNaturalSize.width,
            imageHeight: imageNaturalSize.height,
          })
        : null
    replaceDoc(nextDoc, { resetHistory: true, clearVisibility: true })
    setSelectedShapeIndex(null)
    setHoveredShapeIndex(null)
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
  }

  const handleDeleteCurrentAnnotation = async () => {
    if (!currentFileId) return
    const result = await deleteImageAnnotation(currentFileId)
    if (result.errorMessage) {
      setError(`删除标注失败：${result.errorMessage}`)
      return
    }
    clearCurrentImageShapes()
  }

  const handleDownloadCurrentImage = async () => {
    const targetPath = currentFileId || fallbackFilePath
    if (!targetPath) return
    const result = await downloadTaskImage(targetPath)
    if (result.errorMessage) {
      setError(`下载图片失败：${result.errorMessage}`)
    }
  }

  const handleDeleteCurrentImage = async () => {
    const targetPath = currentFileId || fallbackFilePath
    if (!targetPath) return
    const result = await deleteTaskImage(targetPath)
    if (result.errorMessage) {
      setError(`删除图片失败：${result.errorMessage}`)
      return
    }
    clearCurrentImageShapes()
    await reloadTaskFiles()
  }

  return {
    handleDeleteCurrentAnnotation,
    handleDownloadCurrentImage,
    handleDeleteCurrentImage,
  }
}

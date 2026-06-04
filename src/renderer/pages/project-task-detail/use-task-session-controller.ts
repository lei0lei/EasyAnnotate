/**
 * 模块：project-task-detail/use-task-session-controller
 * 职责：封装任务会话层动作（翻页、删图、删标注）并提供 Header 需要的导航状态。
 * 边界：只处理当前任务文件会话，不涉及 Canvas/Sidebar 具体实现。
 */
import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react"

type UseTaskSessionControllerParams = {
  filesLength: number
  totalFileCount: number
  currentIndex: number
  currentFileId: string
  setCurrentIndex: Dispatch<SetStateAction<number>>
  ensureFilesLoadedThroughIndex: (targetIndex: number) => Promise<number>
  deleteCurrentFile: () => Promise<void>
  deleteCurrentAnnotation: () => Promise<void>
}

export function useTaskSessionController({
  filesLength,
  totalFileCount,
  currentIndex,
  currentFileId,
  setCurrentIndex,
  ensureFilesLoadedThroughIndex,
  deleteCurrentFile,
  deleteCurrentAnnotation,
}: UseTaskSessionControllerParams) {
  const canGoPrev = currentIndex > 0
  const canGoNext = totalFileCount > 0 && currentIndex < totalFileCount - 1

  const nextFile = useCallback(async () => {
    if (totalFileCount <= 0) return
    const nextIndex = Math.min(totalFileCount - 1, currentIndex + 1)
    if (nextIndex >= filesLength) {
      const maxIndex = await ensureFilesLoadedThroughIndex(nextIndex)
      setCurrentIndex(maxIndex)
      return
    }
    setCurrentIndex(nextIndex)
  }, [currentIndex, ensureFilesLoadedThroughIndex, filesLength, setCurrentIndex, totalFileCount])

  const prevFile = useCallback(() => {
    setCurrentIndex((index) => Math.max(0, index - 1))
  }, [setCurrentIndex])

  const jumpToImageOneBased = useCallback(
    async (oneBased: number) => {
      if (totalFileCount <= 0) return
      const clamped = Math.min(totalFileCount, Math.max(1, Math.floor(oneBased)))
      const targetIndex = clamped - 1
      if (targetIndex >= filesLength) {
        const maxIndex = await ensureFilesLoadedThroughIndex(targetIndex)
        setCurrentIndex(maxIndex)
        return
      }
      setCurrentIndex(targetIndex)
    },
    [ensureFilesLoadedThroughIndex, filesLength, setCurrentIndex, totalFileCount],
  )

  const deleteCurrentFileAction = useCallback(async () => {
    await deleteCurrentFile()
  }, [deleteCurrentFile])

  const deleteCurrentAnnotationAction = useCallback(async () => {
    await deleteCurrentAnnotation()
  }, [deleteCurrentAnnotation])

  return useMemo(
    () => ({
      currentFileId,
      canGoPrev,
      canGoNext,
      nextFile,
      prevFile,
      jumpToImageOneBased,
      deleteCurrentFile: deleteCurrentFileAction,
      deleteCurrentAnnotation: deleteCurrentAnnotationAction,
    }),
    [
      currentFileId,
      canGoPrev,
      canGoNext,
      nextFile,
      prevFile,
      jumpToImageOneBased,
      deleteCurrentFileAction,
      deleteCurrentAnnotationAction,
    ],
  )
}

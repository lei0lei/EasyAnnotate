/**
 * 模块：project-task-detail/use-task-session-controller
 * 职责：封装任务会话层动作（翻页、删图、删标注）并提供 Header 需要的导航状态。
 * 边界：只处理当前任务文件会话，不涉及 Canvas/Sidebar 具体实现。
 */
import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react"

type UseTaskSessionControllerParams = {
  filesLength: number
  currentIndex: number
  currentFileId: string
  setCurrentIndex: Dispatch<SetStateAction<number>>
  deleteCurrentFile: () => Promise<void>
  deleteCurrentAnnotation: () => Promise<void>
}

export function useTaskSessionController({
  filesLength,
  currentIndex,
  currentFileId,
  setCurrentIndex,
  deleteCurrentFile,
  deleteCurrentAnnotation,
}: UseTaskSessionControllerParams) {
  const canGoPrev = currentIndex > 0
  const canGoNext = filesLength > 0 && currentIndex < filesLength - 1

  const nextFile = useCallback(() => {
    setCurrentIndex((index) => {
      if (filesLength <= 0) return 0
      return Math.min(filesLength - 1, index + 1)
    })
  }, [filesLength, setCurrentIndex])

  const prevFile = useCallback(() => {
    setCurrentIndex((index) => Math.max(0, index - 1))
  }, [setCurrentIndex])

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
      deleteCurrentFile: deleteCurrentFileAction,
      deleteCurrentAnnotation: deleteCurrentAnnotationAction,
    }),
    [
      currentFileId,
      canGoPrev,
      canGoNext,
      nextFile,
      prevFile,
      deleteCurrentFileAction,
      deleteCurrentAnnotationAction,
    ],
  )
}

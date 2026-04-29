/**
 * 模块：project-task-detail/header-container
 * 职责：组装顶部信息条数据与事件（翻页、下载、删除）。
 * 边界：容器层组件，不直接操作底层 API。
 */
import { TaskDetailHeader } from "@/pages/project-task-detail/components"

export type TaskHeaderContainerProps = {
  projectId: string | undefined
  taskName: string
  currentFileName: string
  progressText: string
  canGoPrev: boolean
  canGoNext: boolean
  onPrevFile: () => void
  onNextFile: () => void
  onDownloadCurrentImage: () => Promise<void>
  onDeleteCurrentAnnotation: () => Promise<void>
  onDeleteCurrentImage: () => Promise<void>
}

export function TaskHeaderContainer({
  projectId,
  taskName,
  currentFileName,
  progressText,
  canGoPrev,
  canGoNext,
  onPrevFile,
  onNextFile,
  onDownloadCurrentImage,
  onDeleteCurrentAnnotation,
  onDeleteCurrentImage,
}: TaskHeaderContainerProps) {
  return (
    <TaskDetailHeader
      projectId={projectId}
      taskName={taskName}
      currentFileName={currentFileName}
      progressText={progressText}
      canGoPrev={canGoPrev}
      canGoNext={canGoNext}
      onPrev={onPrevFile}
      onNext={onNextFile}
      onDownloadCurrentImage={() => {
        void onDownloadCurrentImage()
      }}
      onDeleteCurrentAnnotation={() => {
        void onDeleteCurrentAnnotation()
      }}
      onDeleteCurrentImage={() => {
        void onDeleteCurrentImage()
      }}
    />
  )
}

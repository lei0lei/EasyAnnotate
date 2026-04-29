/**
 * 模块：project-task-detail/use-task-derived-state
 * 职责：集中计算任务详情页纯派生数据（任务名、文件信息、路径候选、标签映射）。
 * 边界：仅做派生计算，不管理可变状态与副作用。
 */
import { readTasks } from "@/lib/project-tasks-storage"
import type { ProjectItem, TaskFileItem } from "@/lib/projects-api"
import { fileNameFromPath, normalizeTagColor, resolveTaskImagePath } from "@/pages/project-task-detail/utils"
import { useMemo } from "react"

type UseTaskDerivedStateParams = {
  projectId: string | undefined
  taskId: string | undefined
  project: ProjectItem | undefined
  files: TaskFileItem[]
  currentIndex: number
}

export function useTaskDerivedState({ projectId, taskId, project, files, currentIndex }: UseTaskDerivedStateParams) {
  const taskName = useMemo(() => {
    if (!projectId || !taskId) return taskId ?? "—"
    const task = readTasks(projectId).find((item) => item.id === taskId)
    return task?.name ?? taskId
  }, [projectId, taskId])

  const currentFile = files[currentIndex]
  const currentFileName = fileNameFromPath(currentFile?.filePath ?? "")
  const progressText = files.length > 0 ? `${currentIndex + 1}/${files.length}` : "0/0"
  const resolvedImagePath = resolveTaskImagePath(project, taskId, currentFile)
  const fallbackImagePath = currentFile?.filePath ?? ""

  const imagePathCandidates = useMemo(
    () => Array.from(new Set([resolvedImagePath, fallbackImagePath].map((item) => item.trim()).filter(Boolean))),
    [resolvedImagePath, fallbackImagePath],
  )

  const annotationLabelOptions = useMemo(() => {
    const fromTags = (project?.tags ?? []).map((item) => item.name.trim()).filter(Boolean)
    return fromTags.length > 0 ? fromTags : ["default"]
  }, [project?.tags])

  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const tag of project?.tags ?? []) {
      const key = tag.name.trim()
      if (!key) continue
      map.set(key, normalizeTagColor(tag.color))
    }
    return map
  }, [project?.tags])

  return {
    taskName,
    currentFile,
    currentFileName,
    progressText,
    imagePathCandidates,
    annotationLabelOptions,
    labelColorMap,
  }
}

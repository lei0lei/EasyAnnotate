/**
 * 模块：project-task-detail/use-task-derived-state
 * 职责：集中计算任务详情页纯派生数据（任务名、文件信息、路径候选、标签映射）。
 * 边界：仅做派生计算，不管理可变状态与副作用。
 */
import { loadTasks } from "@/lib/project-tasks-storage"
import type { ProjectItem, TaskFileItem } from "@/lib/projects-api"
import { fileNameFromPath, normalizeTagColor, resolveTaskImagePath } from "@/pages/project-task-detail/utils"
import { useEffect, useMemo, useState } from "react"

type UseTaskDerivedStateParams = {
  projectId: string | undefined
  taskId: string | undefined
  project: ProjectItem | undefined
  files: TaskFileItem[]
  currentIndex: number
}

export function useTaskDerivedState({ projectId, taskId, project, files, currentIndex }: UseTaskDerivedStateParams) {
  const [taskRecordName, setTaskRecordName] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !taskId) {
      setTaskRecordName(null)
      return
    }
    let alive = true
    void loadTasks(projectId).then((tasks) => {
      if (!alive) return
      setTaskRecordName(tasks.find((item) => item.id === taskId)?.name ?? null)
    })
    return () => {
      alive = false
    }
  }, [projectId, taskId])

  const taskName = !projectId || !taskId ? (taskId ?? "—") : (taskRecordName ?? taskId)

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
    return (project?.tags ?? []).map((item) => item.name.trim()).filter(Boolean)
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

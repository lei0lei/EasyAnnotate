import { listProjectTasks, saveProjectTasks, type ProjectTaskItem } from "@/lib/projects-api"

export type TaskItem = ProjectTaskItem

const TASK_COLORS = ["#334155", "#3f3f46", "#14532d", "#1e3a8a", "#78350f", "#4a044e"]

function legacyTasksStorageKey(projectId: string): string {
  return `easyannotate:project:${projectId}:tasks`
}

/** 仅清除旧版 localStorage 键（例如删除项目后） */
export function removeLegacyTasksStorageKey(projectId: string): void {
  try {
    localStorage.removeItem(legacyTasksStorageKey(projectId))
  } catch {
    // ignore
  }
}

/** 从磁盘（及一次性 localStorage 迁移）加载项目任务列表 */
function dedupeTasksById(tasks: TaskItem[]): TaskItem[] {
  const byId = new Map<string, TaskItem>()
  for (const task of tasks) {
    const prev = byId.get(task.id)
    if (!prev) {
      byId.set(task.id, task)
      continue
    }
    const preferCurrent =
      task.fileCount > prev.fileCount ||
      (task.fileCount === prev.fileCount && task.updatedAt.localeCompare(prev.updatedAt) > 0)
    if (preferCurrent) {
      byId.set(task.id, {
        ...task,
        annotatedFileCount: Math.max(task.annotatedFileCount ?? 0, prev.annotatedFileCount ?? 0) || undefined,
      })
    } else {
      byId.set(task.id, {
        ...prev,
        annotatedFileCount: Math.max(task.annotatedFileCount ?? 0, prev.annotatedFileCount ?? 0) || undefined,
      })
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function loadTasks(projectId: string): Promise<TaskItem[]> {
  const raw = await listProjectTasks(projectId)
  const deduped = dedupeTasksById(raw)
  if (deduped.length < raw.length) {
    try {
      await saveProjectTasks(projectId, deduped)
    } catch {
      /* ignore heal failure */
    }
  }
  return deduped
}

export async function persistTasks(projectId: string, tasks: TaskItem[]): Promise<void> {
  const { errorMessage } = await saveProjectTasks(projectId, dedupeTasksById(tasks))
  if (errorMessage) {
    throw new Error(errorMessage)
  }
}

export async function clearTasks(projectId: string): Promise<void> {
  await persistTasks(projectId, [])
  try {
    localStorage.removeItem(legacyTasksStorageKey(projectId))
  } catch {
    // ignore
  }
}

export async function createTask(
  projectId: string,
  input: {
    id?: string
    name: string
    subset: string
    fileCount: number
  },
): Promise<TaskItem> {
  const now = new Date().toISOString()
  const existing = await loadTasks(projectId)
  const id =
    input.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
  const existingIndex = existing.findIndex((task) => task.id === id)
  if (existingIndex >= 0) {
    const prev = existing[existingIndex]!
    const updated: TaskItem = {
      ...prev,
      name: input.name.trim(),
      subset: input.subset.trim(),
      fileCount: Math.max(0, Math.floor(input.fileCount)),
      updatedAt: now,
    }
    const next = [...existing]
    next[existingIndex] = updated
    await persistTasks(projectId, dedupeTasksById(next))
    return updated
  }
  const task: TaskItem = {
    id,
    name: input.name.trim(),
    subset: input.subset.trim(),
    fileCount: Math.max(0, Math.floor(input.fileCount)),
    createdAt: now,
    updatedAt: now,
    coverColor: TASK_COLORS[existing.length % TASK_COLORS.length],
  }
  await persistTasks(projectId, dedupeTasksById([task, ...existing]))
  return task
}

export async function deleteTask(projectId: string, taskId: string): Promise<void> {
  const tasks = await loadTasks(projectId)
  await persistTasks(
    projectId,
    tasks.filter((task) => task.id !== taskId),
  )
}

export async function appendTaskFileCount(projectId: string, taskId: string, addedCount: number): Promise<boolean> {
  if (!Number.isFinite(addedCount) || addedCount <= 0) return false
  const delta = Math.floor(addedCount)
  const tasks = await loadTasks(projectId)
  let changed = false
  const now = new Date().toISOString()
  const next = tasks.map((task) => {
    if (task.id !== taskId) return task
    changed = true
    return {
      ...task,
      fileCount: Math.max(0, task.fileCount + delta),
      updatedAt: now,
    }
  })
  if (!changed) return false
  await persistTasks(projectId, next)
  return true
}

export async function updateTaskAnnotatedFileCount(
  projectId: string,
  taskId: string,
  annotatedFileCount: number,
): Promise<boolean> {
  const safeCount = Math.max(0, Math.floor(Number(annotatedFileCount) || 0))
  const tasks = await loadTasks(projectId)
  let changed = false
  const now = new Date().toISOString()
  const next = tasks.map((task) => {
    if (task.id !== taskId) return task
    if (task.annotatedFileCount === safeCount) return task
    changed = true
    return {
      ...task,
      annotatedFileCount: safeCount,
      updatedAt: now,
    }
  })
  if (!changed) return false
  await persistTasks(projectId, next)
  return true
}

export function formatTaskTime(value: string): string {
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    const hour = String(d.getHours()).padStart(2, "0")
    const minute = String(d.getMinutes()).padStart(2, "0")
    return `${year}-${month}-${day} ${hour}:${minute}`
  } catch {
    return value
  }
}

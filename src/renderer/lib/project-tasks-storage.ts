export type TaskItem = {
  id: string
  name: string
  subset: string
  fileCount: number
  createdAt: string
  updatedAt: string
  coverColor: string
}

const TASK_COLORS = ["#334155", "#3f3f46", "#14532d", "#1e3a8a", "#78350f", "#4a044e"]

function tasksStorageKey(projectId: string): string {
  return `easyannotate:project:${projectId}:tasks`
}

export function readTasks(projectId: string): TaskItem[] {
  try {
    const raw = localStorage.getItem(tasksStorageKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is TaskItem => {
        if (typeof item !== "object" || item === null) return false
        const t = item as Partial<TaskItem>
        return (
          typeof t.id === "string" &&
          typeof t.name === "string" &&
          (typeof t.subset === "string" || typeof t.subset === "undefined") &&
          (typeof t.fileCount === "number" || typeof t.fileCount === "undefined") &&
          typeof t.createdAt === "string" &&
          typeof t.updatedAt === "string" &&
          typeof t.coverColor === "string"
        )
      })
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        subset: typeof item.subset === "string" ? item.subset.trim() : "",
        fileCount: typeof item.fileCount === "number" && Number.isFinite(item.fileCount) ? Math.max(0, Math.floor(item.fileCount)) : 0,
      }))
      .filter((item) => item.name.length > 0)
  } catch {
    return []
  }
}

export function writeTasks(projectId: string, tasks: TaskItem[]): void {
  try {
    localStorage.setItem(tasksStorageKey(projectId), JSON.stringify(tasks))
  } catch {
    // Ignore localStorage write errors.
  }
}

export function clearTasks(projectId: string): void {
  try {
    localStorage.removeItem(tasksStorageKey(projectId))
  } catch {
    // Ignore localStorage remove errors.
  }
}

export function createTask(
  projectId: string,
  input: {
    id?: string
    name: string
    subset: string
    fileCount: number
  },
): TaskItem {
  const now = new Date().toISOString()
  const existing = readTasks(projectId)
  const id =
    input.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
  const task: TaskItem = {
    id,
    name: input.name.trim(),
    subset: input.subset.trim(),
    fileCount: Math.max(0, Math.floor(input.fileCount)),
    createdAt: now,
    updatedAt: now,
    coverColor: TASK_COLORS[existing.length % TASK_COLORS.length],
  }
  writeTasks(projectId, [task, ...existing])
  return task
}

export function deleteTask(projectId: string, taskId: string): void {
  const tasks = readTasks(projectId)
  writeTasks(
    projectId,
    tasks.filter((task) => task.id !== taskId),
  )
}

export function appendTaskFileCount(projectId: string, taskId: string, addedCount: number): boolean {
  if (!Number.isFinite(addedCount) || addedCount <= 0) return false
  const delta = Math.floor(addedCount)
  const tasks = readTasks(projectId)
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
  writeTasks(projectId, next)
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

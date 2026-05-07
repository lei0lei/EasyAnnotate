/**
 * 项目任务列表持久化：位于 globalConfigDir/project-tasks/<projectId>.json
 * 与 renderer TaskItem 字段对齐，供 dev / 安装包共用同一数据源。
 */
import fs from "node:fs"
import path from "node:path"
import { getDefaultGlobalConfigDir } from "./app-config-disk"

export type ProjectTaskRecord = {
  id: string
  name: string
  subset: string
  fileCount: number
  createdAt: string
  updatedAt: string
  coverColor: string
}

type TasksFileV1 = {
  version: 1
  tasks: ProjectTaskRecord[]
}

function resolveGlobalConfigDir(globalConfigDir: string): string {
  const dir = globalConfigDir.trim()
  return dir || getDefaultGlobalConfigDir()
}

function sanitizeFileSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

const TASKS_SUBDIR = "project-tasks"

function tasksFilePath(globalConfigDir: string, projectId: string): string {
  return path.join(resolveGlobalConfigDir(globalConfigDir), TASKS_SUBDIR, `${sanitizeFileSegment(projectId)}.json`)
}

function normalizeTaskRecords(raw: unknown): ProjectTaskRecord[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Partial<ProjectTaskRecord> => typeof item === "object" && item !== null)
    .map((t) => ({
      id: typeof t.id === "string" ? t.id : "",
      name: typeof t.name === "string" ? t.name.trim() : "",
      subset: typeof t.subset === "string" ? t.subset.trim() : "",
      fileCount:
        typeof t.fileCount === "number" && Number.isFinite(t.fileCount) ? Math.max(0, Math.floor(t.fileCount)) : 0,
      createdAt: typeof t.createdAt === "string" ? t.createdAt : "",
      updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : "",
      coverColor: typeof t.coverColor === "string" && t.coverColor.trim() ? t.coverColor.trim() : "#334155",
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0)
}

export function readProjectTasks(globalConfigDir: string, projectId: string): ProjectTaskRecord[] {
  const filePath = tasksFilePath(globalConfigDir, projectId)
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, "utf8")
    const data = JSON.parse(raw) as unknown
    if (typeof data !== "object" || data === null) return []
    const version = (data as { version?: unknown }).version
    const tasks = (data as { tasks?: unknown }).tasks
    if (version !== 1 || !Array.isArray(tasks)) return []
    return normalizeTaskRecords(tasks)
  } catch {
    return []
  }
}

export function writeProjectTasks(globalConfigDir: string, projectId: string, tasks: ProjectTaskRecord[]): void {
  const filePath = tasksFilePath(globalConfigDir, projectId)
  const normalized = normalizeTaskRecords(tasks)
  const payload: TasksFileV1 = { version: 1, tasks: normalized }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8")
}

export function deleteProjectTasksFile(globalConfigDir: string, projectId: string): void {
  try {
    const filePath = tasksFilePath(globalConfigDir, projectId)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // ignore
  }
}

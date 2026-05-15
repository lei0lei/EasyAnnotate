import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"

type ProjectRow = {
  id: string
  name: string
  root_dir: string
  created_at: string
  updated_at: string
}

type AnnotationRow = {
  id: string
  project_id: string
  image_path: string
  label: string
  bbox_json: string
  meta_json: string
  updated_at: string
}

type TaskFileRow = {
  id: string
  project_id: string
  task_id: string
  subset: string
  file_path: string
  created_at: string
}

type AnnotationStore = {
  projects: ProjectRow[]
  annotations: AnnotationRow[]
  taskFiles: TaskFileRow[]
}

const storeCache = new Map<string, AnnotationStore>()

/** 与主进程 `sanitizeSegment` 一致：任务目录名与 `image_path` 中的 `/data/tasks/<segment>/` 对齐 */
function sanitizeTaskSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

function resolveStoreFile(databaseDir: string): string {
  const baseDir = databaseDir.trim() ? databaseDir.trim() : path.resolve(process.cwd(), "data")
  fs.mkdirSync(baseDir, { recursive: true })
  return path.join(baseDir, "easyannotate-annotations.json")
}

function readStore(filePath: string): AnnotationStore {
  if (storeCache.has(filePath)) return storeCache.get(filePath)!
  if (!fs.existsSync(filePath)) {
    const empty: AnnotationStore = { projects: [], annotations: [], taskFiles: [] }
    storeCache.set(filePath, empty)
    return empty
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<AnnotationStore>
    const store: AnnotationStore = {
      projects: Array.isArray(parsed.projects) ? (parsed.projects as ProjectRow[]) : [],
      annotations: Array.isArray(parsed.annotations) ? (parsed.annotations as AnnotationRow[]) : [],
      taskFiles: Array.isArray(parsed.taskFiles) ? (parsed.taskFiles as TaskFileRow[]) : [],
    }
    storeCache.set(filePath, store)
    return store
  } catch {
    const empty: AnnotationStore = { projects: [], annotations: [], taskFiles: [] }
    storeCache.set(filePath, empty)
    return empty
  }
}

function writeStore(filePath: string, store: AnnotationStore): void {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8")
  storeCache.set(filePath, store)
}

export async function listAnnotationProjects(databaseDir: string): Promise<ProjectRow[]> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  return [...store.projects].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export async function upsertAnnotationProject(
  databaseDir: string,
  project: { id: string; name: string; rootDir: string; createdAt: string; updatedAt: string },
): Promise<void> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  const index = store.projects.findIndex((item) => item.id === project.id)
  const next: ProjectRow = {
    id: project.id,
    name: project.name,
    root_dir: project.rootDir,
    created_at: index >= 0 ? store.projects[index].created_at : project.createdAt,
    updated_at: project.updatedAt,
  }
  if (index >= 0) {
    store.projects[index] = next
  } else {
    store.projects.push(next)
  }
  writeStore(filePath, store)
}

export async function deleteAnnotationProject(databaseDir: string, id: string): Promise<void> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  store.projects = store.projects.filter((item) => item.id !== id)
  store.annotations = store.annotations.filter((item) => item.project_id !== id)
  store.taskFiles = store.taskFiles.filter((item) => item.project_id !== id)
  writeStore(filePath, store)
}

export async function listAnnotationsByProject(
  databaseDir: string,
  projectId: string,
): Promise<AnnotationRow[]> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  return store.annotations
    .filter((item) => item.project_id === projectId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export async function upsertAnnotation(
  databaseDir: string,
  annotation: {
    id: string
    projectId: string
    imagePath: string
    label: string
    bboxJson: string
    metaJson: string
    updatedAt: string
  },
): Promise<void> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  const index = store.annotations.findIndex((item) => item.id === annotation.id)
  const next: AnnotationRow = {
    id: annotation.id,
    project_id: annotation.projectId,
    image_path: annotation.imagePath,
    label: annotation.label,
    bbox_json: annotation.bboxJson,
    meta_json: annotation.metaJson,
    updated_at: annotation.updatedAt,
  }
  if (index >= 0) {
    store.annotations[index] = next
  } else {
    store.annotations.push(next)
  }
  writeStore(filePath, store)
}

export async function deleteAnnotation(databaseDir: string, id: string): Promise<void> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  store.annotations = store.annotations.filter((item) => item.id !== id)
  writeStore(filePath, store)
}

export async function replaceTaskFilesForTask(
  databaseDir: string,
  input: {
    projectId: string
    taskId: string
    subset: string
    filePaths: string[]
    createdAt: string
  },
): Promise<void> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  store.taskFiles = store.taskFiles.filter(
    (item) => !(item.project_id === input.projectId && item.task_id === input.taskId),
  )
  for (const taskFilePath of input.filePaths) {
    store.taskFiles.push({
      id: randomUUID(),
      project_id: input.projectId,
      task_id: input.taskId,
      subset: input.subset,
      file_path: taskFilePath,
      created_at: input.createdAt,
    })
  }
  writeStore(filePath, store)
}

export async function listTaskFilesByTask(
  databaseDir: string,
  projectId: string,
  taskId: string,
): Promise<TaskFileRow[]> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  return store.taskFiles
    .filter((item) => item.project_id === projectId && item.task_id === taskId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.file_path.localeCompare(b.file_path))
}

/** 仅移除索引库中属于该任务（按图片路径）的标注记录，不删任务文件表、不删磁盘 JSON */
export async function deleteAnnotationsForTask(databaseDir: string, projectId: string, taskId: string): Promise<void> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  const taskMarker = `/data/tasks/${sanitizeTaskSegment(taskId)}/`
  store.annotations = store.annotations.filter((item) => {
    if (item.project_id !== projectId) return true
    const normalizedPath = item.image_path.replace(/\\/g, "/")
    return !normalizedPath.includes(taskMarker)
  })
  writeStore(filePath, store)
}

export async function deleteTaskArtifacts(databaseDir: string, projectId: string, taskId: string): Promise<void> {
  const filePath = resolveStoreFile(databaseDir)
  const store = readStore(filePath)
  const taskMarker = `/data/tasks/${sanitizeTaskSegment(taskId)}/`
  store.taskFiles = store.taskFiles.filter((item) => !(item.project_id === projectId && item.task_id === taskId))
  store.annotations = store.annotations.filter((item) => {
    if (item.project_id !== projectId) return true
    const normalizedPath = item.image_path.replace(/\\/g, "/")
    return !normalizedPath.includes(taskMarker)
  })
  writeStore(filePath, store)
}

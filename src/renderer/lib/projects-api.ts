import type { ProjectItem as ProtoProjectItem, ProjectTag as ProtoProjectTag, SkeletonTemplatePb } from "@/gen/app"
import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import {
  createEmptySkeletonTemplate,
  normalizeSkeletonTemplateSpec,
  type SkeletonTemplateSpec,
} from "@/lib/skeleton-template"

export type ProjectItem = {
  id: string
  name: string
  projectInfo: string
  projectType: string
  storageType: string
  localPath: string
  remoteIp: string
  remotePort: string
  updatedAt: string
  configFilePath: string
  tags: ProjectTag[]
}

export type ProjectTag = {
  name: string
  color: string
  /** 未设置或 `plain` 为普通类标签；`skeleton` 为骨架模板类标签 */
  kind?: "plain" | "skeleton"
  /** 当 `kind === "skeleton"` 时携带关节图模板 */
  skeletonTemplate?: SkeletonTemplateSpec
}

export type TaskFileItem = {
  id: string
  projectId: string
  taskId: string
  subset: string
  filePath: string
  createdAt: string
}

export type ExportJobItem = {
  id: string
  projectId: string
  taskId: string
  versionName: string
  exportFormat: string
  keepProjectStructure: boolean
  outputDir: string
  status: string
  progress: number
  message: string
  createdAt: string
  updatedAt: string
}

function globalConfigDir(): string {
  return loadAppConfig().storagePaths.globalConfigDir
}

function skeletonSpecToProto(spec: SkeletonTemplateSpec): SkeletonTemplatePb {
  const n = normalizeSkeletonTemplateSpec(spec)
  return {
    version: n.version,
    points: n.points.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y })),
    edges: n.edges.map((e) => ({ from: e.from, to: e.to })),
  }
}

function protoTemplateToSpec(pb: SkeletonTemplatePb | undefined): SkeletonTemplateSpec {
  if (!pb) return createEmptySkeletonTemplate()
  return normalizeSkeletonTemplateSpec({
    version: 1,
    points: pb.points.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y })),
    edges: pb.edges.map((e) => ({ from: e.from, to: e.to })),
  })
}

/** IPC / protobuf 仅序列化 ProtoProjectTag 上的字段，须与 mapProject 对称 */
function projectTagsToProto(tags: ProjectTag[]): ProtoProjectTag[] {
  return tags.map((t) => {
    if (t.kind === "skeleton") {
      return {
        name: t.name,
        color: t.color,
        kind: "skeleton",
        skeletonTemplate: skeletonSpecToProto(t.skeletonTemplate ?? createEmptySkeletonTemplate()),
      }
    }
    return {
      name: t.name,
      color: t.color,
      kind: "",
      skeletonTemplate: undefined,
    }
  })
}

function mapProject(project: ProtoProjectItem | undefined): ProjectItem {
  if (!project) {
    return {
      id: "",
      name: "",
      projectInfo: "",
      projectType: "",
      storageType: "",
      localPath: "",
      remoteIp: "",
      remotePort: "",
      updatedAt: "",
      configFilePath: "",
      tags: [],
    }
  }
  const rawTags = Array.isArray(project.tags) ? project.tags : []
  const seen = new Set<string>()
  const tags: ProjectTag[] = []
  for (const item of rawTags) {
    if (!item || typeof item.name !== "string") continue
    const name = item.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const color =
      typeof item.color === "string" && /^#[0-9a-fA-F]{6}$/.test(item.color.trim())
        ? item.color.trim().toLowerCase()
        : "#22c55e"
    const kindRaw = typeof item.kind === "string" ? item.kind.trim() : ""
    if (kindRaw === "skeleton") {
      const template = protoTemplateToSpec(item.skeletonTemplate)
      tags.push({ name, color, kind: "skeleton", skeletonTemplate: template })
    } else {
      tags.push({ name, color, kind: "plain" })
    }
  }

  return {
    id: project?.id ?? "",
    name: project?.name ?? "",
    projectInfo: project?.projectInfo ?? "",
    projectType: project?.projectType ?? "",
    storageType: project?.storageType ?? "",
    localPath: project?.localPath ?? "",
    remoteIp: project?.remoteIp ?? "",
    remotePort: project?.remotePort ?? "",
    updatedAt: project?.updatedAt ?? "",
    configFilePath: project?.configFilePath ?? "",
    tags,
  }
}

export async function createProject(payload: {
  name: string
  projectInfo: string
  projectType: string
  storageType: string
  localPath: string
  remoteIp: string
  remotePort: string
  tags?: ProjectTag[]
}): Promise<{ project?: ProjectItem; errorMessage: string }> {
  const response = await ipc.app.CreateProject({
    globalConfigDir: globalConfigDir(),
    ...payload,
    tags: projectTagsToProto(payload.tags ?? []),
  })
  if (response.errorMessage) {
    return { errorMessage: response.errorMessage }
  }
  return { project: mapProject(response.project), errorMessage: "" }
}

export async function listProjects(): Promise<ProjectItem[]> {
  const response = await ipc.app.ListProjects({
    globalConfigDir: globalConfigDir(),
  })
  return response.projects.map(mapProject)
}

export async function getProject(id: string): Promise<ProjectItem | undefined> {
  const response = await ipc.app.GetProject({
    globalConfigDir: globalConfigDir(),
    id,
  })
  if (!response.found) return undefined
  return mapProject(response.project)
}

export async function updateProject(payload: {
  id: string
  name: string
  projectInfo: string
  tags: ProjectTag[]
}): Promise<{ project?: ProjectItem; found: boolean; errorMessage: string }> {
  const response = await ipc.app.UpdateProject({
    globalConfigDir: globalConfigDir(),
    id: payload.id,
    name: payload.name,
    projectInfo: payload.projectInfo,
    tags: projectTagsToProto(payload.tags),
  })
  if (!response.found) {
    return { found: false, errorMessage: response.errorMessage || "" }
  }
  return {
    project: mapProject(response.project),
    found: true,
    errorMessage: response.errorMessage || "",
  }
}

export async function deleteProject(id: string): Promise<{ found: boolean; errorMessage: string }> {
  const response = await ipc.app.DeleteProject({
    globalConfigDir: globalConfigDir(),
    id,
  })
  return {
    found: response.found,
    errorMessage: response.errorMessage || "",
  }
}

export async function saveTaskFiles(payload: {
  projectId: string
  taskId: string
  subset: string
  files: { sourcePath: string; fileName: string; content?: Uint8Array }[]
}): Promise<{ errorMessage: string; savedPaths: string[] }> {
  const response = await ipc.app.SaveTaskFiles({
    globalConfigDir: globalConfigDir(),
    databaseDir: "",
    projectId: payload.projectId,
    taskId: payload.taskId,
    subset: payload.subset,
    files: payload.files.map((file) => ({
      sourcePath: file.sourcePath,
      fileName: file.fileName,
      content: file.content ?? new Uint8Array(),
    })),
  })
  return {
    errorMessage: response.errorMessage || "",
    savedPaths: response.savedPaths ?? [],
  }
}

export async function listTaskFiles(payload: {
  projectId: string
  taskId: string
}): Promise<{ files: TaskFileItem[]; errorMessage: string }> {
  const response = await ipc.app.ListTaskFiles({
    globalConfigDir: globalConfigDir(),
    projectId: payload.projectId,
    taskId: payload.taskId,
    databaseDir: "",
  })
  const files = (response.files ?? []).map((item) => ({
    id: item.id ?? "",
    projectId: item.projectId ?? "",
    taskId: item.taskId ?? "",
    subset: item.subset ?? "",
    filePath: item.filePath ?? "",
    createdAt: item.createdAt ?? "",
  }))
  return {
    files,
    errorMessage: response.errorMessage || "",
  }
}

export async function deleteTaskData(payload: {
  projectId: string
  taskId: string
}): Promise<{ errorMessage: string }> {
  const response = await ipc.app.SaveTaskFiles({
    globalConfigDir: globalConfigDir(),
    databaseDir: "",
    projectId: payload.projectId,
    taskId: payload.taskId,
    subset: "__DELETE_TASK__",
    files: [],
  })
  return { errorMessage: response.errorMessage || "" }
}

export async function readImageFile(path: string): Promise<{ content?: Uint8Array; errorMessage: string }> {
  const response = await ipc.app.ReadImageFile({ path })
  if (response.errorMessage) {
    return { errorMessage: response.errorMessage }
  }
  return { content: response.content, errorMessage: "" }
}

export async function readImageAnnotation(imagePath: string): Promise<{ jsonText: string; exists: boolean; errorMessage: string }> {
  const response = await ipc.app.ReadImageAnnotation({ imagePath })
  return {
    jsonText: response.jsonText || "",
    exists: response.exists,
    errorMessage: response.errorMessage || "",
  }
}

export async function writeImageAnnotation(payload: {
  imagePath: string
  jsonText: string
}): Promise<{ jsonPath: string; errorMessage: string }> {
  const response = await ipc.app.WriteImageAnnotation({
    imagePath: payload.imagePath,
    jsonText: payload.jsonText,
  })
  return {
    jsonPath: response.jsonPath || "",
    errorMessage: response.errorMessage || "",
  }
}

export async function deleteImageAnnotation(imagePath: string): Promise<{ errorMessage: string }> {
  const response = await ipc.app.DeleteImageAnnotation({ imagePath })
  return { errorMessage: response.errorMessage || "" }
}

export async function getImageFileInfo(path: string): Promise<{
  exists: boolean
  sizeBytes: number
  format: string
  channelCount: number
  extension: string
  errorMessage: string
}> {
  const response = await ipc.app.GetImageFileInfo({ path })
  return {
    exists: response.exists,
    sizeBytes: Number(response.sizeBytes || 0),
    format: response.format || "",
    channelCount: Number(response.channelCount || 0),
    extension: response.extension || "",
    errorMessage: response.errorMessage || "",
  }
}

export async function deleteTaskImage(imagePath: string): Promise<{
  deleted: boolean
  annotationDeleted: boolean
  errorMessage: string
}> {
  const response = await ipc.app.DeleteTaskImage({ imagePath })
  return {
    deleted: response.deleted,
    annotationDeleted: response.annotationDeleted,
    errorMessage: response.errorMessage || "",
  }
}

export async function downloadTaskImage(imagePath: string): Promise<{
  canceled: boolean
  savedPath: string
  errorMessage: string
}> {
  const response = await ipc.app.DownloadTaskImage({ imagePath })
  return {
    canceled: response.canceled,
    savedPath: response.savedPath || "",
    errorMessage: response.errorMessage || "",
  }
}

export async function startDatasetExport(payload: {
  projectId: string
  taskId?: string
  exportFormat: string
  keepProjectStructure: boolean
  trainBoundary: number
  valBoundary: number
  versionName: string
  taskNames?: Array<{ taskId: string; taskName: string }>
}): Promise<{ canceled: boolean; jobId: string; errorMessage: string }> {
  const response = await ipc.app.StartDatasetExport({
    globalConfigDir: globalConfigDir(),
    projectId: payload.projectId,
    taskId: payload.taskId || "",
    exportFormat: payload.exportFormat,
    keepProjectStructure: payload.keepProjectStructure,
    trainBoundary: Math.floor(payload.trainBoundary),
    valBoundary: Math.floor(payload.valBoundary),
    versionName: payload.versionName,
    taskNames: payload.taskNames ?? [],
  })
  return {
    canceled: response.canceled,
    jobId: response.jobId || "",
    errorMessage: response.errorMessage || "",
  }
}

/** 任务列表元数据（持久化于全局配置目录下的 project-tasks/） */
export type ProjectTaskItem = {
  id: string
  name: string
  subset: string
  fileCount: number
  createdAt: string
  updatedAt: string
  coverColor: string
}

function legacyTasksStorageKey(projectId: string): string {
  return `easyannotate:project:${projectId}:tasks`
}

function normalizeTasksFromJson(parsed: unknown): ProjectTaskItem[] {
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((item): item is Partial<ProjectTaskItem> => typeof item === "object" && item !== null)
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      name: typeof item.name === "string" ? item.name.trim() : "",
      subset: typeof item.subset === "string" ? item.subset.trim() : "",
      fileCount:
        typeof item.fileCount === "number" && Number.isFinite(item.fileCount) ? Math.max(0, Math.floor(item.fileCount)) : 0,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
      coverColor: typeof item.coverColor === "string" && item.coverColor.trim() ? item.coverColor.trim() : "#334155",
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0)
}

function mapProtoTasksToItems(
  tasks: Array<{
    id?: string
    name?: string
    subset?: string
    fileCount?: number
    createdAt?: string
    updatedAt?: string
    coverColor?: string
  }>,
): ProjectTaskItem[] {
  return (tasks ?? []).map((t) => ({
    id: t.id ?? "",
    name: (t.name ?? "").trim(),
    subset: (t.subset ?? "").trim(),
    fileCount: Math.max(0, Math.floor(Number(t.fileCount) || 0)),
    createdAt: t.createdAt ?? "",
    updatedAt: t.updatedAt ?? "",
    coverColor: (t.coverColor ?? "").trim() || "#334155",
  }))
}

async function saveProjectTasksToDisk(
  projectId: string,
  tasks: ProjectTaskItem[],
): Promise<{ errorMessage: string }> {
  const response = await ipc.app.SaveProjectTasks({
    globalConfigDir: globalConfigDir(),
    projectId,
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      subset: t.subset,
      fileCount: t.fileCount,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      coverColor: t.coverColor,
    })),
  })
  return { errorMessage: response.errorMessage || "" }
}

async function tryMigrateLegacyTasksFromLocalStorage(projectId: string): Promise<ProjectTaskItem[]> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(legacyTasksStorageKey(projectId))
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const migrated = normalizeTasksFromJson(JSON.parse(raw) as unknown)
    if (migrated.length === 0) return []
    const { errorMessage } = await saveProjectTasksToDisk(projectId, migrated)
    if (errorMessage) return []
    try {
      localStorage.removeItem(legacyTasksStorageKey(projectId))
    } catch {
      // ignore
    }
    return migrated
  } catch {
    return []
  }
}

export async function listProjectTasks(projectId: string): Promise<ProjectTaskItem[]> {
  const response = await ipc.app.ListProjectTasks({
    globalConfigDir: globalConfigDir(),
    projectId,
  })
  if (response.errorMessage) return []
  const fromDisk = mapProtoTasksToItems(response.tasks ?? [])
  if (fromDisk.length > 0) return fromDisk
  return tryMigrateLegacyTasksFromLocalStorage(projectId)
}

export async function saveProjectTasks(projectId: string, tasks: ProjectTaskItem[]): Promise<{ errorMessage: string }> {
  return saveProjectTasksToDisk(projectId, tasks)
}

export async function getProjectExportVersionsFromDisk(projectId: string): Promise<{
  jsonText: string
  exists: boolean
  errorMessage: string
}> {
  const response = await ipc.app.GetProjectExportVersions({
    globalConfigDir: globalConfigDir(),
    projectId,
  })
  return {
    jsonText: response.jsonText || "",
    exists: response.exists,
    errorMessage: response.errorMessage || "",
  }
}

export async function saveProjectExportVersionsToDisk(
  projectId: string,
  jsonText: string,
): Promise<{ errorMessage: string }> {
  const response = await ipc.app.SaveProjectExportVersions({
    globalConfigDir: globalConfigDir(),
    projectId,
    jsonText,
  })
  return { errorMessage: response.errorMessage || "" }
}

export async function listExportJobs(): Promise<ExportJobItem[]> {
  const response = await ipc.app.ListExportJobs({})
  return (response.jobs ?? []).map((job) => ({
    id: job.id || "",
    projectId: job.projectId || "",
    taskId: job.taskId || "",
    versionName: job.versionName || "",
    exportFormat: job.exportFormat || "",
    keepProjectStructure: job.keepProjectStructure,
    outputDir: job.outputDir || "",
    status: job.status || "",
    progress: Number(job.progress || 0),
    message: job.message || "",
    createdAt: job.createdAt || "",
    updatedAt: job.updatedAt || "",
  }))
}

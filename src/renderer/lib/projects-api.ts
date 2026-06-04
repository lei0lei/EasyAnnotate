import type { ProjectItem as ProtoProjectItem, ProjectTag as ProtoProjectTag, SkeletonTemplatePb } from "@/gen/app"
import { ipc } from "@/gen/ipc"
import { createXAnyLabelTemplate, normalizeXAnyLabelDoc } from "@/lib/xanylabeling-format"
import type { XAnyLabelShape } from "@/lib/xanylabeling-format"
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
  hasAnnotation: boolean
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

export type AnnotatedTaskImportJobItem = {
  id: string
  projectId: string
  taskId: string
  subset: string
  importFormat: string
  status: string
  progress: number
  message: string
  importedImageCount: number
  importedAnnotationCount: number
  detectedFormat: string
  createdAt: string
  updatedAt: string
}

export async function importAnnotatedTaskZip(payload: {
  projectId: string
  taskId: string
  subset: string
  zipPath: string
  importFormat: string
}): Promise<{
  errorMessage: string
  savedPaths: string[]
  importedImageCount: number
  importedAnnotationCount: number
  detectedFormat: string
}> {
  const response = await ipc.app.ImportAnnotatedTaskZip({
    globalConfigDir: globalConfigDir(),
    projectId: payload.projectId,
    taskId: payload.taskId,
    subset: payload.subset,
    zipPath: payload.zipPath,
    importFormat: payload.importFormat,
  })
  return {
    errorMessage: response.errorMessage || "",
    savedPaths: response.savedPaths ?? [],
    importedImageCount: Math.max(0, Math.floor(Number(response.importedImageCount) || 0)),
    importedAnnotationCount: Math.max(0, Math.floor(Number(response.importedAnnotationCount) || 0)),
    detectedFormat: response.detectedFormat || "",
  }
}

export async function startAnnotatedTaskZipImport(payload: {
  projectId: string
  taskId: string
  subset: string
  zipPath: string
  importFormat: string
}): Promise<{ errorMessage: string; jobId: string }> {
  const response = await ipc.app.StartAnnotatedTaskZipImport({
    globalConfigDir: globalConfigDir(),
    projectId: payload.projectId,
    taskId: payload.taskId,
    subset: payload.subset,
    zipPath: payload.zipPath,
    importFormat: payload.importFormat,
  })
  return {
    errorMessage: response.errorMessage || "",
    jobId: response.jobId || "",
  }
}

export const ANNOTATED_IMPORT_EXPORT_FORMAT = "annotated-import"
const IMPORT_JOB_META_SEP = "\n---IMPORT_META---\n"

export function parseAnnotatedImportJobFromExportJob(job: ExportJobItem): AnnotatedTaskImportJobItem | null {
  if (job.exportFormat !== ANNOTATED_IMPORT_EXPORT_FORMAT) return null
  const [statusMessage, meta = ""] = (job.message || "").split(IMPORT_JOB_META_SEP)
  const [importedImageCountRaw, importedAnnotationCountRaw, detectedFormat = ""] = meta.split("|")
  return mapAnnotatedImportJobFields({
    id: job.id,
    projectId: job.projectId,
    taskId: job.taskId,
    subset: job.versionName || "",
    importFormat: job.outputDir || "",
    status: job.status || "",
    progress: job.progress,
    message: statusMessage || job.message || "",
    importedImageCount: importedImageCountRaw,
    importedAnnotationCount: importedAnnotationCountRaw,
    detectedFormat,
    createdAt: job.createdAt || "",
    updatedAt: job.updatedAt || "",
  })
}

function mapAnnotatedImportJobFields(input: {
  id: string
  projectId: string
  taskId: string
  subset: string
  importFormat: string
  status: string
  progress: number | string | undefined
  message: string
  importedImageCount: number | string | undefined
  importedAnnotationCount: number | string | undefined
  detectedFormat: string
  createdAt: string
  updatedAt: string
}): AnnotatedTaskImportJobItem {
  return {
    id: input.id,
    projectId: input.projectId,
    taskId: input.taskId,
    subset: input.subset,
    importFormat: input.importFormat,
    status: input.status,
    progress: Math.max(0, Math.min(100, Math.floor(Number(input.progress) || 0))),
    message: input.message,
    importedImageCount: Math.max(0, Math.floor(Number(input.importedImageCount) || 0)),
    importedAnnotationCount: Math.max(0, Math.floor(Number(input.importedAnnotationCount) || 0)),
    detectedFormat: input.detectedFormat,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

/** 轮询单个导入 job（只读一个 state 文件，避免 ListExportJobs 全量同步） */
export async function getAnnotatedTaskImportJob(jobId: string): Promise<AnnotatedTaskImportJobItem | null> {
  const trimmed = jobId.trim()
  if (!trimmed) return null
  try {
    const response = await ipc.app.GetAnnotatedTaskImportJob({ jobId: trimmed })
    if (response.errorMessage || !response.found || !response.job) return null
    const job = response.job
    return mapAnnotatedImportJobFields({
      id: job.id || "",
      projectId: job.projectId || "",
      taskId: job.taskId || "",
      subset: job.subset || "",
      importFormat: job.importFormat || "",
      status: job.status || "",
      progress: job.progress,
      message: job.message || "",
      importedImageCount: job.importedImageCount,
      importedAnnotationCount: job.importedAnnotationCount,
      detectedFormat: job.detectedFormat || "",
      createdAt: job.createdAt || "",
      updatedAt: job.updatedAt || "",
    })
  } catch {
    const exportJobs = await listExportJobs()
    const parsed = exportJobs
      .map(parseAnnotatedImportJobFromExportJob)
      .find((item) => item?.id === trimmed)
    return parsed ?? null
  }
}

export async function listAnnotatedTaskImportJobs(): Promise<AnnotatedTaskImportJobItem[]> {
  try {
    const response = await ipc.app.ListAnnotatedTaskImportJobs({})
    return (response.jobs ?? []).map((job) =>
      mapAnnotatedImportJobFields({
        id: job.id || "",
        projectId: job.projectId || "",
        taskId: job.taskId || "",
        subset: job.subset || "",
        importFormat: job.importFormat || "",
        status: job.status || "",
        progress: job.progress,
        message: job.message || "",
        importedImageCount: job.importedImageCount,
        importedAnnotationCount: job.importedAnnotationCount,
        detectedFormat: job.detectedFormat || "",
        createdAt: job.createdAt || "",
        updatedAt: job.updatedAt || "",
      }),
    )
  } catch {
    const exportJobs = await listExportJobs()
    return exportJobs
      .map(parseAnnotatedImportJobFromExportJob)
      .filter((job): job is AnnotatedTaskImportJobItem => job !== null)
  }
}

export async function countTaskImageZip(zipPath: string): Promise<{ errorMessage: string; imageCount: number }> {
  const response = await ipc.app.CountTaskImageZip({
    zipPath,
  })
  return {
    errorMessage: response.errorMessage || "",
    imageCount: Math.max(0, Math.floor(Number(response.imageCount) || 0)),
  }
}

export async function importTaskImageZip(payload: {
  projectId: string
  taskId: string
  subset: string
  zipPath: string
}): Promise<{ errorMessage: string; savedPaths: string[]; importedImageCount: number }> {
  const response = await ipc.app.ImportTaskImageZip({
    globalConfigDir: globalConfigDir(),
    projectId: payload.projectId,
    taskId: payload.taskId,
    subset: payload.subset,
    zipPath: payload.zipPath,
  })
  return {
    errorMessage: response.errorMessage || "",
    savedPaths: response.savedPaths ?? [],
    importedImageCount: Math.max(0, Math.floor(Number(response.importedImageCount) || 0)),
  }
}

export async function listTaskFiles(payload: {
  projectId: string
  taskId: string
  offset?: number
  limit?: number
}): Promise<{ files: TaskFileItem[]; hasMore: boolean; errorMessage: string }> {
  const response = await ipc.app.ListTaskFiles({
    globalConfigDir: globalConfigDir(),
    projectId: payload.projectId,
    taskId: payload.taskId,
    databaseDir: "",
    offset: Math.max(0, Math.floor(payload.offset ?? 0)),
    limit: Math.max(0, Math.floor(payload.limit ?? 0)),
  })
  const files = (response.files ?? []).map((item) => ({
    id: item.id ?? "",
    projectId: item.projectId ?? "",
    taskId: item.taskId ?? "",
    subset: item.subset ?? "",
    filePath: item.filePath ?? "",
    createdAt: item.createdAt ?? "",
    hasAnnotation: item.hasAnnotation === true,
  }))
  return {
    files,
    hasMore: response.hasMore === true,
    errorMessage: response.errorMessage || "",
  }
}

export async function listAllTaskFiles(payload: {
  projectId: string
  taskId: string
  pageSize?: number
}): Promise<{ files: TaskFileItem[]; errorMessage: string }> {
  const pageSize = Math.max(1, Math.floor(payload.pageSize ?? 200))
  let offset = 0
  const files: TaskFileItem[] = []
  const seen = new Set<string>()
  while (true) {
    const page = await listTaskFiles({
      projectId: payload.projectId,
      taskId: payload.taskId,
      offset,
      limit: pageSize,
    })
    if (page.errorMessage) {
      return { files, errorMessage: page.errorMessage }
    }
    let appended = 0
    for (const item of page.files) {
      const key = item.filePath || `${item.taskId}:${item.id}`
      if (seen.has(key)) continue
      seen.add(key)
      files.push(item)
      appended += 1
    }
    if (!page.hasMore) break
    if (page.files.length <= 0 || appended <= 0) break
    offset = files.length
  }
  return { files, errorMessage: "" }
}

export async function deleteTaskData(
  payload: {
    projectId: string
    taskId: string
  },
  options?: {
    onProgress?: (progress: number, message: string) => void
  },
): Promise<{ errorMessage: string }> {
  const started = await startTaskDelete(payload)
  if (!started.jobId) {
    return { errorMessage: started.errorMessage || "无法启动删除任务" }
  }
  const waited = await waitForTaskDeleteJob(started.jobId, options)
  if (waited.errorMessage) {
    return waited
  }
  if (started.errorMessage) {
    return { errorMessage: started.errorMessage }
  }
  return { errorMessage: "" }
}

export const TASK_DELETE_EXPORT_FORMAT = "task-delete"
const DELETE_JOB_META_SEP = "\n---DELETE_META---\n"

export type TaskDeleteJobItem = {
  id: string
  projectId: string
  taskId: string
  status: string
  progress: number
  message: string
  deletedFileCount: number
  totalFileCount: number
  errorMessage: string
  createdAt: string
  updatedAt: string
}

export function parseTaskDeleteJobFromExportJob(job: ExportJobItem): TaskDeleteJobItem | null {
  if (job.exportFormat !== TASK_DELETE_EXPORT_FORMAT) return null
  const [statusMessage, meta = ""] = (job.message || "").split(DELETE_JOB_META_SEP)
  const [deletedFileCountRaw, totalFileCountRaw, errorMessage = ""] = meta.split("|")
  return {
    id: job.id,
    projectId: job.projectId,
    taskId: job.taskId,
    status: job.status || "",
    progress: Math.max(0, Math.min(100, Math.floor(Number(job.progress) || 0))),
    message: statusMessage || job.message || "",
    deletedFileCount: Math.max(0, Math.floor(Number(deletedFileCountRaw) || 0)),
    totalFileCount: Math.max(0, Math.floor(Number(totalFileCountRaw) || 0)),
    errorMessage,
    createdAt: job.createdAt || "",
    updatedAt: job.updatedAt || "",
  }
}

export async function listTaskDeleteJobs(): Promise<TaskDeleteJobItem[]> {
  const exportJobs = await listExportJobs()
  return exportJobs
    .map(parseTaskDeleteJobFromExportJob)
    .filter((job): job is TaskDeleteJobItem => job !== null)
}

export async function startTaskDelete(payload: {
  projectId: string
  taskId: string
}): Promise<{ errorMessage: string; jobId: string }> {
  const response = await ipc.app.StartTaskDelete({
    globalConfigDir: globalConfigDir(),
    databaseDir: "",
    projectId: payload.projectId,
    taskId: payload.taskId,
  })
  return {
    errorMessage: response.errorMessage || "",
    jobId: response.jobId || "",
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export async function waitForTaskDeleteJob(
  jobId: string,
  options?: { onProgress?: (progress: number, message: string) => void },
): Promise<{ errorMessage: string }> {
  const deadline = Date.now() + 60 * 60 * 1000
  while (Date.now() < deadline) {
    let jobs: TaskDeleteJobItem[] = []
    try {
      jobs = await listTaskDeleteJobs()
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
    const current = jobs.find((item) => item.id === jobId)
    if (!current) {
      await sleepMs(400)
      continue
    }
    options?.onProgress?.(current.progress, current.message)
    if (current.status === "success") {
      return { errorMessage: "" }
    }
    if (current.status === "failed") {
      return { errorMessage: current.errorMessage || current.message || "删除失败" }
    }
    await sleepMs(500)
  }
  return { errorMessage: "删除任务超时" }
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

async function appendImageAnnotationShapesViaReadWrite(payload: {
  imagePath: string
  shapesJson: string
  imageWidth: number
  imageHeight: number
}): Promise<{ jsonPath: string; errorMessage: string }> {
  let incoming: XAnyLabelShape[] = []
  try {
    const parsed = JSON.parse(payload.shapesJson || "[]")
    if (!Array.isArray(parsed)) {
      return { jsonPath: "", errorMessage: "shapes_json 必须是 JSON 数组。" }
    }
    incoming = parsed as XAnyLabelShape[]
  } catch {
    return { jsonPath: "", errorMessage: "shapes_json 解析失败。" }
  }

  const normalizedIncoming = normalizeXAnyLabelDoc({
    imagePath: payload.imagePath,
    imageWidth: payload.imageWidth,
    imageHeight: payload.imageHeight,
    rawJsonText: JSON.stringify({
      version: "2.5.4",
      flags: {},
      shapes: incoming,
      description: null,
      imagePath: payload.imagePath,
      imageData: null,
      imageHeight: payload.imageHeight,
      imageWidth: payload.imageWidth,
    }),
  }).shapes

  const read = await readImageAnnotation(payload.imagePath)
  if (read.errorMessage) {
    return { jsonPath: "", errorMessage: read.errorMessage }
  }

  const doc = read.exists
    ? normalizeXAnyLabelDoc({
        imagePath: payload.imagePath,
        imageWidth: payload.imageWidth,
        imageHeight: payload.imageHeight,
        rawJsonText: read.jsonText,
      })
    : createXAnyLabelTemplate({
        imagePath: payload.imagePath,
        imageWidth: payload.imageWidth,
        imageHeight: payload.imageHeight,
      })

  doc.shapes = [...doc.shapes, ...normalizedIncoming]
  doc.imageWidth = payload.imageWidth
  doc.imageHeight = payload.imageHeight

  return writeImageAnnotation({
    imagePath: payload.imagePath,
    jsonText: JSON.stringify(doc),
  })
}

/** 主进程合并写入；若 IPC 未生成则回退为读/写（检测任务 JSON 通常较小）。 */
export async function appendImageAnnotationShapes(payload: {
  imagePath: string
  shapesJson: string
  imageWidth: number
  imageHeight: number
}): Promise<{ jsonPath: string; errorMessage: string }> {
  try {
    const response = await ipc.app.AppendImageAnnotationShapes({
      imagePath: payload.imagePath,
      shapesJson: payload.shapesJson,
      imageWidth: payload.imageWidth,
      imageHeight: payload.imageHeight,
    })
    if (!response.errorMessage) {
      return { jsonPath: response.jsonPath || "", errorMessage: "" }
    }
  } catch {
    // 旧版主进程未实现该 RPC 时回退
  }
  return appendImageAnnotationShapesViaReadWrite(payload)
}

export async function deleteImageAnnotation(imagePath: string): Promise<{ errorMessage: string }> {
  const response = await ipc.app.DeleteImageAnnotation({ imagePath })
  return { errorMessage: response.errorMessage || "" }
}

export async function deleteTaskAnnotations(payload: {
  projectId: string
  taskId: string
}): Promise<{ errorMessage: string }> {
  const response = await ipc.app.DeleteTaskAnnotations({
    globalConfigDir: globalConfigDir(),
    databaseDir: "",
    projectId: payload.projectId,
    taskId: payload.taskId,
  })
  return { errorMessage: response.errorMessage || "" }
}

export async function getImageFileInfo(path: string): Promise<{
  exists: boolean
  sizeBytes: number
  format: string
  channelCount: number
  extension: string
  width: number
  height: number
  errorMessage: string
}> {
  const response = await ipc.app.GetImageFileInfo({ path })
  return {
    exists: response.exists,
    sizeBytes: Number(response.sizeBytes || 0),
    format: response.format || "",
    channelCount: Number(response.channelCount || 0),
    extension: response.extension || "",
    width: Number(response.width || 0),
    height: Number(response.height || 0),
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
  compressToZip?: boolean
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
    compressToZip: payload.compressToZip === true,
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
  /** 已标注图片数（ZIP 导入等写入；未设置时由项目页延迟统计） */
  annotatedFileCount?: number
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
      annotatedFileCount:
        typeof item.annotatedFileCount === "number" && Number.isFinite(item.annotatedFileCount)
          ? Math.max(0, Math.floor(item.annotatedFileCount))
          : undefined,
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
    annotatedFileCount?: number
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
    annotatedFileCount: (() => {
      const n = Math.floor(Number(t.annotatedFileCount) || 0)
      return n > 0 ? n : undefined
    })(),
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
      annotatedFileCount: t.annotatedFileCount ?? 0,
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

export async function getProjectTaskAnnotatedCounts(
  projectId: string,
): Promise<{ counts: Record<string, number>; errorMessage: string }> {
  const response = await ipc.app.GetProjectTaskAnnotatedCounts({
    databaseDir: "",
    projectId,
  })
  if (response.errorMessage) {
    return { counts: {}, errorMessage: response.errorMessage }
  }
  const counts: Record<string, number> = {}
  for (const item of response.items ?? []) {
    const taskId = (item.taskId || "").trim()
    if (!taskId) continue
    counts[taskId] = Math.max(0, Math.floor(Number(item.annotatedImageCount) || 0))
  }
  return { counts, errorMessage: "" }
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

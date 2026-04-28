import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"

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
}

export type TaskFileItem = {
  id: string
  projectId: string
  taskId: string
  subset: string
  filePath: string
  createdAt: string
}

function globalConfigDir(): string {
  return loadAppConfig().storagePaths.globalConfigDir
}

function mapProject(project: Partial<ProjectItem> | undefined): ProjectItem {
  const rawTags = Array.isArray(project?.tags) ? project.tags : []
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
    tags.push({ name, color })
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
    tags: payload.tags ?? [],
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
    tags: payload.tags,
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

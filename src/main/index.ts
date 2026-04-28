import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipc, Theme } from '@mobrowser/api';
import { Person } from './gen/greet';
import {
  CreateProjectRequest,
  CreateProjectResponse,
  DefaultDatabaseDirResponse,
  DefaultGlobalConfigDirResponse,
  DeleteProjectRequest,
  DeleteProjectResponse,
  DeleteTaskImageRequest,
  DeleteTaskImageResponse,
  DownloadTaskImageRequest,
  DownloadTaskImageResponse,
  GetImageFileInfoRequest,
  GetImageFileInfoResponse,
  DeleteImageAnnotationRequest,
  DeleteImageAnnotationResponse,
  ListTaskFilesRequest,
  ListTaskFilesResponse,
  ReadImageAnnotationRequest,
  ReadImageAnnotationResponse,
  ReadImageFileRequest,
  ReadImageFileResponse,
  SaveTaskFilesRequest,
  SaveTaskFilesResponse,
  WriteImageAnnotationRequest,
  WriteImageAnnotationResponse,
  DeleteAnnotationProjectRequest,
  DeleteAnnotationRequest,
  GetProjectRequest,
  GetProjectResponse,
  ListAnnotationProjectsRequest,
  ListAnnotationsByProjectRequest,
  ListProjectsRequest,
  ValidateProjectDirectoryRequest,
  ValidateProjectDirectoryResponse,
  SelectDirectoryRequest,
  SelectFilesRequest,
  SaveAppConfigToDiskRequest,
  SelectFilesResponse,
  SetThemeRequest,
  UpdateProjectRequest,
  UpdateProjectResponse,
  UpsertAnnotationProjectRequest,
  UpsertAnnotationRequest,
} from './gen/app';
import { GreetService, AppService } from './gen/ipc_service';
import { installApplicationMenu } from "./app-menu";
import {
  deleteTaskArtifacts,
  deleteAnnotation,
  deleteAnnotationProject,
  listAnnotationProjects,
  listAnnotationsByProject,
  upsertAnnotation,
  upsertAnnotationProject,
} from "./annotation-sqlite";
import { getDefaultDatabaseDir, getDefaultGlobalConfigDir, saveAppConfigToDisk } from "./app-config-disk";
import { validateProjectDirectory } from "./project-directory";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "./project-storage";

function sanitizeSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

function buildUniqueFilePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName)
  const baseName = path.basename(fileName, ext)
  let candidate = path.join(dir, fileName)
  let index = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName}_${String(index).padStart(3, "0")}${ext}`)
    index += 1
  }
  return candidate
}

function collectTaskFiles(taskRootDir: string): Array<{ subset: string; filePath: string; createdAt: string }> {
  if (!fs.existsSync(taskRootDir)) return []
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"])
  const records: Array<{ subset: string; filePath: string; createdAt: string }> = []
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absPath)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!imageExts.has(ext)) continue
      const stat = fs.statSync(absPath)
      const relative = path.relative(taskRootDir, absPath)
      const segments = relative.split(path.sep).filter(Boolean)
      const subset = segments.length > 1 ? segments[0] : "default"
      records.push({
        subset,
        filePath: absPath,
        createdAt: stat.birthtime.toISOString(),
      })
    }
  }
  walk(taskRootDir)
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.filePath.localeCompare(b.filePath))
  return records
}

function resolveAnnotationJsonPath(imagePath: string): string {
  const parsed = path.parse(imagePath)
  return path.join(parsed.dir, `${parsed.name}.json`)
}

function readFileHeader(filePath: string, maxBytes = 256 * 1024): Buffer {
  const fd = fs.openSync(filePath, "r")
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    fs.closeSync(fd)
  }
}

function detectImageFormat(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "PNG"
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "JPEG"
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "WEBP"
  }
  if (buffer.length >= 6 && (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")) {
    return "GIF"
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "BMP"
  }
  if (buffer.length >= 4) {
    const little = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00
    const big = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a
    if (little || big) return "TIFF"
  }
  return "UNKNOWN"
}

function parsePngChannels(buffer: Buffer): number | null {
  if (buffer.length < 26) return null
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null
  const colorType = buffer[25]
  if (colorType === 0) return 1
  if (colorType === 2) return 3
  if (colorType === 3) return 1
  if (colorType === 4) return 2
  if (colorType === 6) return 4
  return null
}

function parseJpegChannels(buffer: Buffer): number | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 1 >= buffer.length) break
    const segmentLength = (buffer[offset] << 8) + buffer[offset + 1]
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    const isSOF =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    if (isSOF && segmentLength >= 8) {
      const componentsOffset = offset + 7
      if (componentsOffset < buffer.length) {
        return buffer[componentsOffset]
      }
      return null
    }
    offset += segmentLength
  }
  return null
}

function parseWebpChannels(buffer: Buffer): number | null {
  if (buffer.length < 16) return null
  const chunkType = buffer.toString("ascii", 12, 16)
  if (chunkType === "VP8X") {
    if (buffer.length < 21) return null
    const flags = buffer[20]
    return (flags & 0x10) !== 0 ? 4 : 3
  }
  if (chunkType === "VP8L") {
    if (buffer.length < 25) return null
    if (buffer[20] !== 0x2f) return null
    const bits = buffer.readUInt32LE(21)
    return ((bits >> 28) & 0x01) === 1 ? 4 : 3
  }
  if (chunkType === "VP8 ") {
    return buffer.includes(Buffer.from("ALPH")) ? 4 : 3
  }
  return null
}

function parseBmpChannels(buffer: Buffer): number | null {
  if (buffer.length < 30) return null
  const bitCount = buffer.readUInt16LE(28)
  if (bitCount <= 0) return null
  return Math.max(1, Math.ceil(bitCount / 8))
}

function detectImageChannelCount(buffer: Buffer, format: string): number | null {
  if (format === "PNG") return parsePngChannels(buffer)
  if (format === "JPEG") return parseJpegChannels(buffer)
  if (format === "WEBP") return parseWebpChannels(buffer)
  if (format === "BMP") return parseBmpChannels(buffer)
  if (format === "GIF") return 3
  return null
}

// Create a new window.
const win = new BrowserWindow()
installApplicationMenu(win)
win.browser.loadUrl(app.url)
win.setSize({ width: 800, height: 650 })
win.setWindowTitleVisible(false)
win.setWindowTitlebarVisible(false)
win.centerWindow()
win.show()

// Handle the IPC calls from the renderer process.
ipc.registerService(GreetService({
  async SayHello(person: Person) {
    return { value: `Hello, ${person.name}!` };
  },
}))

ipc.registerService(AppService({
  async SetTheme(request: SetThemeRequest) {
    app.setTheme(request.theme as Theme);
    return {};
  },
  async MinimizeWindow(_request) {
    win.minimize()
    return {}
  },
  async ToggleMaximizeWindow(_request) {
    if (win.isMaximized) {
      win.restore()
    } else {
      win.maximize()
    }
    return { isMaximized: win.isMaximized }
  },
  async CloseWindow(_request) {
    win.close()
    return {}
  },
  async GetWindowState(_request) {
    return { isMaximized: win.isMaximized }
  },
  async SelectDirectory(request: SelectDirectoryRequest) {
    try {
      const result = await app.showOpenDialog({
        parentWindow: win,
        title: request.title || "选择目录",
        ...(request.defaultPath ? { defaultPath: request.defaultPath } : {}),
        selectionPolicy: "directories",
        features: {
          allowMultiple: false,
          canCreateDirectories: true,
        },
      })
      return {
        canceled: result.canceled,
        path: result.paths[0] ?? "",
        errorMessage: "",
      }
    } catch (error) {
      return {
        canceled: true,
        path: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async SelectFiles(request: SelectFilesRequest): Promise<SelectFilesResponse> {
    try {
      const result = await app.showOpenDialog({
        parentWindow: win,
        title: request.title || "选择文件",
        ...(request.defaultPath ? { defaultPath: request.defaultPath } : {}),
        selectionPolicy: "files",
        features: {
          allowMultiple: true,
          canCreateDirectories: false,
        },
      })
      return {
        canceled: result.canceled,
        paths: result.paths ?? [],
        errorMessage: "",
      }
    } catch (error) {
      return {
        canceled: true,
        paths: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async ValidateProjectDirectory(request: ValidateProjectDirectoryRequest): Promise<ValidateProjectDirectoryResponse> {
    const validation = validateProjectDirectory(request.path)
    return {
      isEmpty: validation.isEmpty,
      errorMessage: validation.errorMessage,
    }
  },
  async CreateProject(request: CreateProjectRequest): Promise<CreateProjectResponse> {
    try {
      const project = createProject({
        globalConfigDir: request.globalConfigDir,
        name: request.name,
        projectInfo: request.projectInfo,
        projectType: request.projectType,
        storageType: request.storageType === "remote" ? "remote" : "local",
        localPath: request.localPath,
        remoteIp: request.remoteIp,
        remotePort: request.remotePort,
        tags: request.tags,
      })
      return {
        project: {
          id: project.id,
          name: project.name,
          projectInfo: project.projectInfo,
          projectType: project.projectType,
          storageType: project.storageType,
          localPath: project.localPath,
          remoteIp: project.remoteIp,
          remotePort: project.remotePort,
          updatedAt: project.updatedAt,
          configFilePath: project.configFilePath,
          tags: project.tags,
        },
        errorMessage: "",
      }
    } catch (error) {
      return {
        project: {
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
        },
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async ListProjects(request: ListProjectsRequest) {
    const projects = listProjects(request.globalConfigDir).map((project) => ({
      id: project.id,
      name: project.name,
      projectInfo: project.projectInfo,
      projectType: project.projectType,
      storageType: project.storageType,
      localPath: project.localPath,
      remoteIp: project.remoteIp,
      remotePort: project.remotePort,
      updatedAt: project.updatedAt,
      configFilePath: project.configFilePath,
      tags: project.tags,
    }))
    return { projects }
  },
  async GetProject(request: GetProjectRequest): Promise<GetProjectResponse> {
    const project = getProject(request.globalConfigDir, request.id)
    if (!project) {
      return {
        found: false,
        project: {
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
        },
      }
    }
    return {
      found: true,
      project: {
        id: project.id,
        name: project.name,
        projectInfo: project.projectInfo,
        projectType: project.projectType,
        storageType: project.storageType,
        localPath: project.localPath,
        remoteIp: project.remoteIp,
        remotePort: project.remotePort,
        updatedAt: project.updatedAt,
        configFilePath: project.configFilePath,
        tags: project.tags,
      },
    }
  },
  async UpdateProject(request: UpdateProjectRequest): Promise<UpdateProjectResponse> {
    try {
      const project = updateProject({
        globalConfigDir: request.globalConfigDir,
        id: request.id,
        name: request.name,
        projectInfo: request.projectInfo,
        tags: request.tags,
      })
      if (!project) {
        return {
          found: false,
          project: {
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
          },
          errorMessage: "",
        }
      }
      return {
        found: true,
        project: {
          id: project.id,
          name: project.name,
          projectInfo: project.projectInfo,
          projectType: project.projectType,
          storageType: project.storageType,
          localPath: project.localPath,
          remoteIp: project.remoteIp,
          remotePort: project.remotePort,
          updatedAt: project.updatedAt,
          configFilePath: project.configFilePath,
          tags: project.tags,
        },
        errorMessage: "",
      }
    } catch (error) {
      return {
        found: false,
        project: {
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
        },
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async DeleteProject(request: DeleteProjectRequest): Promise<DeleteProjectResponse> {
    try {
      const existing = getProject(request.globalConfigDir, request.id)
      const found = deleteProject(request.globalConfigDir, request.id)
      if (found && existing) {
        if (existing.storageType === "local" && existing.localPath) {
          fs.rmSync(existing.localPath, { recursive: true, force: true })
        }
        await deleteAnnotationProject("", request.id)
      }
      return {
        found,
        errorMessage: "",
      }
    } catch (error) {
      return {
        found: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async SaveTaskFiles(request: SaveTaskFilesRequest): Promise<SaveTaskFilesResponse> {
    try {
      const project = getProject(request.globalConfigDir, request.projectId)
      if (!project) {
        return { errorMessage: "项目不存在。", savedPaths: [] }
      }
      const rawSubset = (request.subset || "").trim()
      const baseRoot =
        project.storageType === "local" && project.localPath
          ? project.localPath
          : path.dirname(project.configFilePath)
      const taskRootDir = path.join(baseRoot, "data", "tasks", sanitizeSegment(request.taskId))
      if (rawSubset === "__DELETE_TASK__") {
        fs.rmSync(taskRootDir, { recursive: true, force: true })
        await deleteTaskArtifacts(request.databaseDir, request.projectId, request.taskId)
        return { errorMessage: "", savedPaths: [] }
      }
      const subset = sanitizeSegment(rawSubset || "default")
      const taskDir = path.join(taskRootDir, subset)
      fs.mkdirSync(taskDir, { recursive: true })

      const savedPaths: string[] = []
      for (const file of request.files) {
        const sourcePath = (file.sourcePath || "").trim()
        const fileName = path.basename(file.fileName || sourcePath).trim()
        if (!fileName) continue
        const targetPath = buildUniqueFilePath(taskDir, fileName)
        if (sourcePath) {
          try {
            fs.copyFileSync(sourcePath, targetPath)
            savedPaths.push(targetPath)
            continue
          } catch {
            // Fallback to content write when source path cannot be copied.
          }
        }
        const content = file.content
        if (content && content.length > 0) {
          fs.writeFileSync(targetPath, Buffer.from(content))
          savedPaths.push(targetPath)
        }
      }

      if (savedPaths.length === 0 && request.files.length > 0) {
        return {
          errorMessage: "没有可保存的有效文件（缺少路径且无文件内容）。",
          savedPaths: [],
        }
      }

      return { errorMessage: "", savedPaths }
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        savedPaths: [],
      }
    }
  },
  async ListTaskFiles(request: ListTaskFilesRequest): Promise<ListTaskFilesResponse> {
    try {
      const project = getProject(request.globalConfigDir, request.projectId)
      if (!project) {
        return { files: [], errorMessage: "项目不存在。" }
      }
      const baseRoot =
        project.storageType === "local" && project.localPath
          ? project.localPath
          : path.dirname(project.configFilePath)
      const taskRootDir = path.join(baseRoot, "data", "tasks", sanitizeSegment(request.taskId))
      const files = collectTaskFiles(taskRootDir).map((item, index) => ({
        id: `${request.taskId}-${index + 1}`,
        projectId: request.projectId,
        taskId: request.taskId,
        subset: item.subset,
        filePath: item.filePath,
        createdAt: item.createdAt,
      }))
      return { files, errorMessage: "" }
    } catch (error) {
      return {
        files: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async ReadImageFile(request: ReadImageFileRequest): Promise<ReadImageFileResponse> {
    try {
      const filePath = (request.path || "").trim()
      if (!filePath) {
        return { content: Buffer.alloc(0), errorMessage: "图片路径为空。" }
      }
      if (!fs.existsSync(filePath)) {
        return { content: Buffer.alloc(0), errorMessage: "图片文件不存在。" }
      }
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        return { content: Buffer.alloc(0), errorMessage: "图片路径不是文件。" }
      }
      const content = fs.readFileSync(filePath)
      return { content, errorMessage: "" }
    } catch (error) {
      return {
        content: Buffer.alloc(0),
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async ReadImageAnnotation(request: ReadImageAnnotationRequest): Promise<ReadImageAnnotationResponse> {
    try {
      const imagePath = (request.imagePath || "").trim()
      if (!imagePath) {
        return { jsonText: "", exists: false, errorMessage: "图片路径为空。" }
      }
      const jsonPath = resolveAnnotationJsonPath(imagePath)
      if (!fs.existsSync(jsonPath)) {
        return { jsonText: "", exists: false, errorMessage: "" }
      }
      const content = fs.readFileSync(jsonPath, "utf8")
      return {
        jsonText: content,
        exists: true,
        errorMessage: "",
      }
    } catch (error) {
      return {
        jsonText: "",
        exists: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async WriteImageAnnotation(request: WriteImageAnnotationRequest): Promise<WriteImageAnnotationResponse> {
    try {
      const imagePath = (request.imagePath || "").trim()
      if (!imagePath) {
        return { jsonPath: "", errorMessage: "图片路径为空。" }
      }
      const jsonText = request.jsonText || ""
      const jsonPath = resolveAnnotationJsonPath(imagePath)
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
      fs.writeFileSync(jsonPath, jsonText, "utf8")
      return { jsonPath, errorMessage: "" }
    } catch (error) {
      return {
        jsonPath: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async DeleteImageAnnotation(request: DeleteImageAnnotationRequest): Promise<DeleteImageAnnotationResponse> {
    try {
      const imagePath = (request.imagePath || "").trim()
      if (!imagePath) {
        return { errorMessage: "图片路径为空。" }
      }
      const jsonPath = resolveAnnotationJsonPath(imagePath)
      fs.rmSync(jsonPath, { force: true })
      return { errorMessage: "" }
    } catch (error) {
      return { errorMessage: error instanceof Error ? error.message : String(error) }
    }
  },
  async GetImageFileInfo(request: GetImageFileInfoRequest): Promise<GetImageFileInfoResponse> {
    try {
      const filePath = (request.path || "").trim()
      if (!filePath) {
        return { exists: false, sizeBytes: 0, format: "", channelCount: 0, extension: "", errorMessage: "图片路径为空。" }
      }
      if (!fs.existsSync(filePath)) {
        return { exists: false, sizeBytes: 0, format: "", channelCount: 0, extension: "", errorMessage: "" }
      }
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        return { exists: false, sizeBytes: 0, format: "", channelCount: 0, extension: "", errorMessage: "路径不是文件。" }
      }
      const extension = path.extname(filePath).toLowerCase()
      const header = readFileHeader(filePath)
      const format = detectImageFormat(header)
      const channelCount = detectImageChannelCount(header, format) ?? 0
      return {
        exists: true,
        sizeBytes: Math.floor(stat.size),
        format,
        channelCount,
        extension,
        errorMessage: "",
      }
    } catch (error) {
      return {
        exists: false,
        sizeBytes: 0,
        format: "",
        channelCount: 0,
        extension: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async DeleteTaskImage(request: DeleteTaskImageRequest): Promise<DeleteTaskImageResponse> {
    try {
      const imagePath = (request.imagePath || "").trim()
      if (!imagePath) {
        return { deleted: false, annotationDeleted: false, errorMessage: "图片路径为空。" }
      }
      if (!fs.existsSync(imagePath)) {
        return { deleted: false, annotationDeleted: false, errorMessage: "图片不存在。" }
      }
      const stat = fs.statSync(imagePath)
      if (!stat.isFile()) {
        return { deleted: false, annotationDeleted: false, errorMessage: "目标不是文件。" }
      }
      fs.rmSync(imagePath, { force: true })
      const jsonPath = resolveAnnotationJsonPath(imagePath)
      const annotationDeleted = fs.existsSync(jsonPath)
      fs.rmSync(jsonPath, { force: true })
      return { deleted: true, annotationDeleted, errorMessage: "" }
    } catch (error) {
      return {
        deleted: false,
        annotationDeleted: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async DownloadTaskImage(request: DownloadTaskImageRequest): Promise<DownloadTaskImageResponse> {
    try {
      const imagePath = (request.imagePath || "").trim()
      if (!imagePath) {
        return { canceled: true, savedPath: "", errorMessage: "图片路径为空。" }
      }
      if (!fs.existsSync(imagePath)) {
        return { canceled: true, savedPath: "", errorMessage: "图片不存在。" }
      }
      const stat = fs.statSync(imagePath)
      if (!stat.isFile()) {
        return { canceled: true, savedPath: "", errorMessage: "目标不是文件。" }
      }

      const dialogResult = await app.showOpenDialog({
        parentWindow: win,
        title: "选择图片保存目录",
        defaultPath: path.dirname(imagePath),
        selectionPolicy: "directories",
        features: {
          allowMultiple: false,
          canCreateDirectories: true,
        },
      })
      if (dialogResult.canceled || !dialogResult.paths[0]) {
        return { canceled: true, savedPath: "", errorMessage: "" }
      }

      const targetDir = dialogResult.paths[0]
      const targetPath = buildUniqueFilePath(targetDir, path.basename(imagePath))
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.copyFileSync(imagePath, targetPath)
      return { canceled: false, savedPath: targetPath, errorMessage: "" }
    } catch (error) {
      return {
        canceled: true,
        savedPath: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async GetDefaultDatabaseDir(_request): Promise<DefaultDatabaseDirResponse> {
    return { path: getDefaultDatabaseDir() }
  },
  async GetDefaultGlobalConfigDir(_request): Promise<DefaultGlobalConfigDirResponse> {
    return { path: getDefaultGlobalConfigDir() }
  },
  async SaveAppConfigToDisk(request: SaveAppConfigToDiskRequest) {
    saveAppConfigToDisk(request.globalConfigDir, request.appConfigJson)
    return {}
  },
  async ListAnnotationProjects(request: ListAnnotationProjectsRequest) {
    const projects = (await listAnnotationProjects(request.databaseDir)).map((project) => ({
      id: project.id,
      name: project.name,
      rootDir: project.root_dir,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    }))
    return { projects }
  },
  async UpsertAnnotationProject(request: UpsertAnnotationProjectRequest) {
    const project = request.project
    if (!project) return {}
    await upsertAnnotationProject(request.databaseDir, {
      id: project.id,
      name: project.name,
      rootDir: project.rootDir,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })
    return {}
  },
  async DeleteAnnotationProject(request: DeleteAnnotationProjectRequest) {
    await deleteAnnotationProject(request.databaseDir, request.id)
    return {}
  },
  async ListAnnotationsByProject(request: ListAnnotationsByProjectRequest) {
    const annotations = (await listAnnotationsByProject(request.databaseDir, request.projectId)).map((item) => ({
      id: item.id,
      projectId: item.project_id,
      imagePath: item.image_path,
      label: item.label,
      bboxJson: item.bbox_json,
      metaJson: item.meta_json,
      updatedAt: item.updated_at,
    }))
    return { annotations }
  },
  async UpsertAnnotation(request: UpsertAnnotationRequest) {
    const annotation = request.annotation
    if (!annotation) return {}
    await upsertAnnotation(request.databaseDir, {
      id: annotation.id,
      projectId: annotation.projectId,
      imagePath: annotation.imagePath,
      label: annotation.label,
      bboxJson: annotation.bboxJson,
      metaJson: annotation.metaJson,
      updatedAt: annotation.updatedAt,
    })
    return {}
  },
  async DeleteAnnotation(request: DeleteAnnotationRequest) {
    await deleteAnnotation(request.databaseDir, request.id)
    return {}
  },
}))

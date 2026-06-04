import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { app, BrowserWindow, ipc, Theme } from '@mobrowser/api';
import { Person } from './gen/greet';
import { parseImageDimensionsFromHeader } from './image-dimensions';
import { appendShapesToAnnotationJsonFile } from './xanylabel-annotation-merge';
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
  DownloadYoloTrainingModelRequest,
  DownloadYoloTrainingModelResponse,
  GetYoloModelDownloadStatusRequest,
  GetYoloModelDownloadStatusResponse,
  GetImageFileInfoRequest,
  GetImageFileInfoResponse,
  DeleteImageAnnotationRequest,
  DeleteImageAnnotationResponse,
  DeleteTaskAnnotationsRequest,
  DeleteTaskAnnotationsResponse,
  ListTaskFilesRequest,
  ListTaskFilesResponse,
  ListProjectTasksRequest,
  ListProjectTasksResponse,
  SaveProjectTasksRequest,
  SaveProjectTasksResponse,
  GetProjectExportVersionsRequest,
  GetProjectExportVersionsResponse,
  SaveProjectExportVersionsRequest,
  SaveProjectExportVersionsResponse,
  ReadImageAnnotationRequest,
  ReadImageAnnotationResponse,
  ReadImageFileRequest,
  ReadImageFileResponse,
  SaveTaskFilesRequest,
  SaveTaskFilesResponse,
  ImportTaskImageZipRequest,
  ImportTaskImageZipResponse,
  CountTaskImageZipRequest,
  CountTaskImageZipResponse,
  ImportAnnotatedTaskZipRequest,
  ImportAnnotatedTaskZipResponse,
  StartAnnotatedTaskZipImportRequest,
  StartAnnotatedTaskZipImportResponse,
  StartTaskDeleteRequest,
  StartTaskDeleteResponse,
  GetAnnotatedTaskImportJobRequest,
  GetAnnotatedTaskImportJobResponse,
  ListAnnotatedTaskImportJobsResponse,
  WriteImageAnnotationRequest,
  WriteImageAnnotationResponse,
  AppendImageAnnotationShapesRequest,
  AppendImageAnnotationShapesResponse,
  DeleteAnnotationProjectRequest,
  DeleteAnnotationRequest,
  GetProjectRequest,
  GetProjectResponse,
  GetProjectTaskAnnotatedCountsRequest,
  GetProjectTaskAnnotatedCountsResponse,
  ListExportJobsResponse,
  ListAnnotationProjectsRequest,
  ListAnnotationsByProjectRequest,
  ListProjectsRequest,
  StartDatasetExportRequest,
  StartDatasetExportResponse,
  ValidateProjectDirectoryRequest,
  ValidateProjectDirectoryResponse,
  SelectDirectoryRequest,
  SelectFilesRequest,
  SaveAppConfigToDiskRequest,
  GetAppConfigFromDiskRequest,
  GetAppConfigFromDiskResponse,
  MigrateGlobalConfigDirRequest,
  MigrateGlobalConfigDirResponse,
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
  deleteAnnotationsForTask,
  deleteTaskArtifacts,
  deleteAnnotation,
  deleteAnnotationProject,
  countAnnotatedImagesByTaskForProject,
  listAnnotationProjects,
  listAnnotationsByProject,
  upsertAnnotation,
  upsertAnnotationProject,
} from "./annotation-sqlite";
import {
  getDefaultDatabaseDir,
  getDefaultGlobalConfigDir,
  migrateGlobalConfigDir,
  readAppConfigFromDisk,
  saveAppConfigToDisk,
} from "./app-config-disk";
import { validateProjectDirectory } from "./project-directory";
import { protoProjectTagsToRecords, projectTagRecordsToProto } from "./project-tag-ipc";
import {
  deleteProjectExportVersionsFile,
  readProjectExportVersionsJson,
  writeProjectExportVersionsJson,
} from "./project-export-versions-disk";
import { deleteProjectTasksFile, readProjectTasks, writeProjectTasks } from "./project-tasks-disk";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "./project-storage";
import {
  buildUniqueExportFolderPath,
  buildUniqueZipPath,
  listDatasetExportJobsForIpc,
  startDatasetExportJob,
} from "./dataset-export";
import { runAnnotatedTaskZipImport } from "./annotated-task-import-core";
import {
  listAnnotatedTaskImportJobsAsExportJobsForIpc,
  startAnnotatedTaskImportJob,
  getAnnotatedImportJobRecord,
} from "./task-import";
import {
  listTaskDeleteJobsAsExportJobsForIpc,
  startTaskDeleteJob,
} from "./task-delete";
import { runTaskDelete } from "./task-delete-core";
import {
  probeLocalBackendHealth,
  startEmbeddedPythonBackend,
  stopEmbeddedPythonBackend,
} from "./local-backend-launcher";

function sanitizeSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

function resolveTaskRootDir(
  globalConfigDir: string,
  projectId: string,
  taskId: string,
): { taskRootDir: string; errorMessage: string } {
  const project = getProject(globalConfigDir, projectId)
  if (!project) {
    return { taskRootDir: "", errorMessage: "项目不存在。" }
  }
  const baseRoot =
    project.storageType === "local" && project.localPath
      ? project.localPath
      : path.dirname(project.configFilePath)
  return {
    taskRootDir: path.join(baseRoot, "data", "tasks", sanitizeSegment(taskId)),
    errorMessage: "",
  }
}

function maybeDecodePathValue(value: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(value)) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function decodeUtf8FromBytes(bytes: Uint8Array): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
    if (!decoded || decoded.includes("\ufffd")) return ""
    return decoded
  } catch {
    return ""
  }
}

function maybeRecoverUtf8Mojibake(value: string): string {
  const input = value || ""
  if (!input) return input
  const bytes = Uint8Array.from(input, (ch) => ch.charCodeAt(0) & 0xff)
  const decoded = decodeUtf8FromBytes(bytes)
  return decoded || input
}

function maybeRecoverUtf8FromUtf16Units(value: string): string {
  const input = value || ""
  if (!input) return input
  const bytes = new Uint8Array(input.length * 2)
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i)
    bytes[i * 2] = code & 0xff
    bytes[i * 2 + 1] = (code >> 8) & 0xff
  }
  const decoded = decodeUtf8FromBytes(bytes)
  return decoded || input
}

function maybeDecodeUnicodeEscapes(value: string): string {
  const input = value || ""
  if (!/\\u[0-9a-fA-F]{4}/.test(input)) return input
  try {
    return input.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  } catch {
    return input
  }
}

function normalizeIpcFilePath(rawPath: string): string {
  const input = (rawPath || "").trim()
  if (!input) return ""
  if (!/^file:\/\//i.test(input)) return maybeDecodePathValue(input)
  try {
    const parsed = new URL(input)
    let pathname = maybeDecodePathValue(parsed.pathname || "")
    if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1)
    }
    const normalizedPath = pathname.replace(/\//g, path.sep)
    if (parsed.host) {
      if (process.platform === "win32") {
        return `\\\\${parsed.host}${normalizedPath.startsWith(path.sep) ? "" : path.sep}${normalizedPath}`
      }
      return `//${parsed.host}${normalizedPath.startsWith(path.sep) ? "" : path.sep}${normalizedPath}`
    }
    return normalizedPath
  } catch {
    return maybeDecodePathValue(input)
  }
}

function pathExistsSafe(filePath: string): boolean {
  if (!filePath) return false
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

function resolveExistingIpcPath(rawPath: string): string {
  const trimmed = (rawPath || "").trim()
  if (!trimmed) return ""
  const attempts: string[] = []
  const seen = new Set<string>()
  const push = (candidate: string) => {
    const value = candidate.trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    attempts.push(value)
  }

  push(trimmed)
  push(maybeDecodePathValue(trimmed))
  push(maybeDecodeUnicodeEscapes(trimmed))

  const snapshot = [...attempts]
  for (const candidate of snapshot) {
    push(maybeRecoverUtf8Mojibake(candidate))
    push(maybeRecoverUtf8FromUtf16Units(candidate))
  }

  for (const candidate of attempts) {
    const normalized = normalizeIpcFilePath(candidate)
    if (pathExistsSafe(normalized)) return normalized
  }

  return normalizeIpcFilePath(attempts[0] || trimmed)
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

const YOLO_CHUNK_SIZE = 5 * 1024 * 1024
const YOLO_MODEL_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000
const YOLO_MODEL_CHUNK_TIMEOUT_MS = 15 * 60 * 1000
// 自动标注任务（尤其分割/点位密集）JSON 体积会显著增大，4MB 过于保守会导致“文件有标注但界面不显示”。
const MAX_ANNOTATION_JSON_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_IPC_BYTES = 24 * 1024 * 1024
const MAX_IMAGE_DECODE_PIXELS = 60 * 1024 * 1024

type YoloModelDownloadJob = {
  status: "pending" | "success" | "failed"
  savedPath: string
  errorMessage: string
  finishedAt?: number
}

const _yoloModelDownloadJobs = new Map<string, YoloModelDownloadJob>()

function pruneYoloModelDownloadJobs(): void {
  const cutoff = Date.now() - 30 * 60_000
  for (const [id, job] of _yoloModelDownloadJobs) {
    if (job.finishedAt != null && job.finishedAt < cutoff) {
      _yoloModelDownloadJobs.delete(id)
    }
  }
}

function startHttpModelDownloadJob(downloadId: string, url: string, targetPath: string): void {
  _yoloModelDownloadJobs.set(downloadId, { status: "pending", savedPath: "", errorMessage: "" })
  void (async () => {
    try {
      await downloadUrlToFile(url, targetPath)
      _yoloModelDownloadJobs.set(downloadId, {
        status: "success",
        savedPath: targetPath,
        errorMessage: "",
        finishedAt: Date.now(),
      })
    } catch (error) {
      _yoloModelDownloadJobs.set(downloadId, {
        status: "failed",
        savedPath: "",
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
      })
    }
  })()
}

function sanitizeModelDownloadFileName(name: string): string {
  const base = path.basename((name || "").replace(/\\/g, "/")).trim()
  if (!base || base === "." || base === "..") return "model.pt"
  return base
}

function modelDownloadInfoUrlFromFileUrl(fileUrl: string): string {
  const parsed = new URL(fileUrl)
  parsed.pathname = parsed.pathname.replace("/models/file", "/models/download-info")
  return parsed.toString()
}

function httpGetJson(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error("无效的下载地址"))
      return
    }
    const lib = parsed.protocol === "https:" ? https : http
    const req = lib.get(url, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 400) {
        res.resume()
        reject(new Error(`下载信息请求失败（HTTP ${status}）`))
        return
      }
      const chunks: Buffer[] = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
          resolve(data)
        } catch {
          reject(new Error("无法解析下载信息响应"))
        }
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error("下载信息请求超时")))
    req.on("error", reject)
  })
}

function httpGetRange(url: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error("无效的下载地址"))
      return
    }
    const lib = parsed.protocol === "https:" ? https : http
    const req = lib.get(url, { headers: { Range: `bytes=${start}-${end}` } }, (res) => {
      const status = res.statusCode ?? 0
      if (status !== 206 && status !== 200) {
        res.resume()
        reject(new Error(`分片下载失败（HTTP ${status}）`))
        return
      }
      const chunks: Buffer[] = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => resolve(Buffer.concat(chunks)))
    })
    req.setTimeout(YOLO_MODEL_CHUNK_TIMEOUT_MS, () => req.destroy(new Error("分片下载超时")))
    req.on("error", reject)
  })
}

function buildRemoteHealthUrl(protocol: string, host: string, port: string, basePath: string): string {
  const scheme = protocol.trim().toLowerCase() === "https" ? "https" : "http"
  const h = host.trim() || "127.0.0.1"
  const p = (port.trim() || "8000").replace(/^:/, "")
  const rawBase = basePath.trim()
  const normalizedBase = rawBase ? (rawBase.startsWith("/") ? rawBase : `/${rawBase}`).replace(/\/+$/, "") : ""
  return `${scheme}://${h}:${p}${normalizedBase}/health`
}

function probeRemoteHealthViaNodeHttp(url: string, timeoutMs: number): Promise<{ ok: boolean; httpStatus: number; reason: string }> {
  return new Promise((resolve) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      resolve({ ok: false, httpStatus: 0, reason: "无效 URL" })
      return
    }
    const lib = parsed.protocol === "https:" ? https : http
    const req = lib.get(
      url,
      {
        headers: { Accept: "application/json,text/plain,*/*" },
      },
      (res) => {
        const status = res.statusCode ?? 0
        res.resume()
        if (status >= 200 && status < 300) {
          resolve({ ok: true, httpStatus: status, reason: "" })
        } else {
          resolve({ ok: false, httpStatus: status, reason: `HTTP ${status}` })
        }
      },
    )
    req.setTimeout(Math.max(500, timeoutMs), () => {
      req.destroy(new Error(`连接超时（>${Math.max(500, timeoutMs)}ms）`))
    })
    req.on("error", (err) => {
      resolve({ ok: false, httpStatus: 0, reason: err instanceof Error ? err.message : String(err) })
    })
  })
}

function normalizeNodeResponseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      out[key] = value
      continue
    }
    if (Array.isArray(value)) {
      out[key] = value.join(", ")
    }
  }
  return out
}

function proxyBackendHttpViaNodeHttp(args: {
  url: string
  method: string
  headers: Record<string, string>
  body: Uint8Array
  timeoutMs: number
}): Promise<{
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: Uint8Array
  errorMessage: string
}> {
  return new Promise((resolve) => {
    let parsed: URL
    try {
      parsed = new URL(args.url)
    } catch {
      resolve({
        ok: false,
        status: 0,
        statusText: "",
        headers: {},
        body: new Uint8Array(),
        errorMessage: "无效 URL",
      })
      return
    }
    const lib = parsed.protocol === "https:" ? https : http
    const req = lib.request(
      parsed,
      {
        method: (args.method || "GET").toUpperCase(),
        headers: args.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on("end", () => {
          const body = Buffer.concat(chunks)
          const status = res.statusCode ?? 0
          resolve({
            ok: true,
            status,
            statusText: res.statusMessage || "",
            headers: normalizeNodeResponseHeaders(res.headers),
            body: new Uint8Array(body),
            errorMessage: "",
          })
        })
      },
    )
    req.setTimeout(Math.max(500, args.timeoutMs), () => {
      req.destroy(new Error(`请求超时（>${Math.max(500, args.timeoutMs)}ms）`))
    })
    req.on("error", (err) => {
      resolve({
        ok: false,
        status: 0,
        statusText: "",
        headers: {},
        body: new Uint8Array(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    })
    if (args.body && args.body.byteLength > 0) {
      req.write(Buffer.from(args.body))
    }
    req.end()
  })
}

function mimeTypeFromPath(pathValue: string): string {
  const lower = pathValue.trim().toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".bmp")) return "image/bmp"
  if (lower.endsWith(".gif")) return "image/gif"
  return "application/octet-stream"
}

async function proxyBackendImageUpload(args: {
  url: string
  imagePath: string
  payloadJson: string
  timeoutMs: number
}): Promise<{
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: Uint8Array
  errorMessage: string
}> {
  const pathValue = args.imagePath.trim()
  if (!pathValue) {
    return {
      ok: false,
      status: 0,
      statusText: "",
      headers: {},
      body: new Uint8Array(),
      errorMessage: "图片路径为空",
    }
  }
  if (!fs.existsSync(pathValue)) {
    return {
      ok: false,
      status: 0,
      statusText: "",
      headers: {},
      body: new Uint8Array(),
      errorMessage: `图片不存在：${pathValue}`,
    }
  }
  try {
    const bytes = fs.readFileSync(pathValue)
    let parsed: URL
    try {
      parsed = new URL(args.url)
    } catch {
      return {
        ok: false,
        status: 0,
        statusText: "",
        headers: {},
        body: new Uint8Array(),
        errorMessage: "无效 URL",
      }
    }
    const boundary = `----ea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const payloadText = args.payloadJson.trim()
    const fileName = path.basename(pathValue) || "image.bin"
    const fileHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="${fileName.replace(/"/g, '\\"')}"\r\n` +
      `Content-Type: ${mimeTypeFromPath(pathValue)}\r\n\r\n`
    const parts: Buffer[] = [Buffer.from(fileHeader, "utf8"), bytes, Buffer.from("\r\n", "utf8")]
    if (payloadText) {
      const payloadPart =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="payload_json"\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${payloadText}\r\n`
      parts.push(Buffer.from(payloadPart, "utf8"))
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"))
    const requestBody = Buffer.concat(parts)
    const lib = parsed.protocol === "https:" ? https : http
    const timeoutMs = Math.max(500, args.timeoutMs)
    return await new Promise((resolve) => {
      const req = lib.request(
        parsed,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": String(requestBody.byteLength),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
          res.on("end", () => {
            resolve({
              ok: true,
              status: res.statusCode ?? 0,
              statusText: res.statusMessage || "",
              headers: normalizeNodeResponseHeaders(res.headers),
              body: new Uint8Array(Buffer.concat(chunks)),
              errorMessage: "",
            })
          })
        },
      )
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（>${timeoutMs}ms）`)))
      req.on("error", (err) => {
        resolve({
          ok: false,
          status: 0,
          statusText: "",
          headers: {},
          body: new Uint8Array(),
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      })
      req.write(requestBody)
      req.end()
    })
  } catch (err) {
    return {
      ok: false,
      status: 0,
      statusText: "",
      headers: {},
      body: new Uint8Array(),
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

async function downloadUrlToFile(url: string, destPath: string): Promise<void> {
  const info = await httpGetJson(modelDownloadInfoUrlFromFileUrl(url), 60_000)
  const totalSize = Number(info.total_size)
  if (!Number.isFinite(totalSize) || totalSize < 0) {
    throw new Error("无效的模型文件大小")
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  let offset = 0
  if (fs.existsSync(destPath)) {
    const st = fs.statSync(destPath)
    if (st.size >= totalSize) {
      fs.unlinkSync(destPath)
    } else if (st.size > 0) {
      offset = st.size
    }
  }

  const fd = fs.openSync(destPath, offset > 0 ? "r+" : "w")
  const deadline = Date.now() + YOLO_MODEL_DOWNLOAD_TIMEOUT_MS
  try {
    while (offset < totalSize) {
      if (Date.now() > deadline) {
        throw new Error(`下载超时（超过 ${YOLO_MODEL_DOWNLOAD_TIMEOUT_MS / 60_000} 分钟）`)
      }
      const end = Math.min(offset + YOLO_CHUNK_SIZE, totalSize) - 1
      const chunk = await httpGetRange(url, offset, end)
      fs.writeSync(fd, chunk, 0, chunk.length, offset)
      offset = end + 1
    }
  } finally {
    fs.closeSync(fd)
  }
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

function collectTaskFilesPage(
  taskRootDir: string,
  offset: number,
  limit: number,
): { records: Array<{ subset: string; filePath: string; createdAt: string; hasAnnotation: boolean }>; hasMore: boolean } {
  if (!fs.existsSync(taskRootDir)) return { records: [], hasMore: false }
  const safeOffset = Math.max(0, Math.floor(offset))
  const safeLimit = Math.max(1, Math.floor(limit))
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"])
  const buffered: Array<{ subset: string; filePath: string; createdAt: string; hasAnnotation: boolean }> = []
  const maxBuffered = safeLimit + 1
  let skipped = 0
  let hasMore = false

  const walk = (dir: string): boolean => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (walk(absPath)) return true
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!imageExts.has(ext)) continue
      const stat = fs.statSync(absPath)
      if (skipped < safeOffset) {
        skipped += 1
        continue
      }
      const relative = path.relative(taskRootDir, absPath)
      const segments = relative.split(path.sep).filter(Boolean)
      const subset = segments.length > 1 ? segments[0] : "default"
      buffered.push({
        subset,
        filePath: absPath,
        createdAt: stat.birthtime.toISOString(),
        hasAnnotation: annotationJsonExists(absPath),
      })
      if (buffered.length >= maxBuffered) {
        hasMore = true
        return true
      }
    }
    return false
  }

  walk(taskRootDir)
  return {
    records: hasMore ? buffered.slice(0, safeLimit) : buffered,
    hasMore,
  }
}

function resolveAnnotationJsonPath(imagePath: string): string {
  const parsed = path.parse(imagePath)
  return path.join(parsed.dir, `${parsed.name}.json`)
}

function annotationJsonExists(imagePath: string): boolean {
  const jsonPath = resolveAnnotationJsonPath(imagePath)
  try {
    const stat = fs.statSync(jsonPath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

function resolveSystemTarExecutable(): string {
  if (process.platform === "win32") {
    const tarExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    if (fs.existsSync(tarExe)) return tarExe
  }
  return "tar"
}

function walkFilesRecursive(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return []
  const out: string[] = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(absPath)
        continue
      }
      if (ent.isFile()) out.push(absPath)
    }
  }
  return out
}

/** 与 renderer task-file-upload.ts TASK_CREATE_IMAGE_UPLOAD_LIMIT 保持一致 */
const TASK_CREATE_IMAGE_UPLOAD_LIMIT = 500

const TASK_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"])

function isTaskImageFilePath(filePath: string): boolean {
  return TASK_IMAGE_EXTS.has(path.extname(filePath).toLowerCase())
}

function countImagesInTaskDir(taskDir: string): number {
  if (!fs.existsSync(taskDir)) return 0
  return walkFilesRecursive(taskDir).filter((filePath) => isTaskImageFilePath(filePath)).length
}

async function listZipArchiveEntries(zipPath: string): Promise<{ ok: boolean; entries: string[]; errorMessage: string }> {
  try {
    const entries = await new Promise<string[]>((resolve, reject) => {
      const child = spawn(resolveSystemTarExecutable(), ["-tf", zipPath], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stdout = ""
      let stderr = ""
      child.stdout?.setEncoding("utf8")
      child.stderr?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) {
          resolve(
            stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          )
          return
        }
        const detail = stderr.trim()
        reject(new Error(detail ? `读取 zip 列表失败：${detail}` : `读取 zip 列表失败（退出码 ${code ?? "unknown"}）`))
      })
    })
    return { ok: true, entries, errorMessage: "" }
  } catch (error) {
    return {
      ok: false,
      entries: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

function countImagesInZipEntries(entries: string[]): number {
  let count = 0
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/").replace(/\/+$/, "")
    if (!normalized || normalized.endsWith("/")) continue
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1)
    if (!fileName) continue
    if (isTaskImageFilePath(fileName)) count += 1
  }
  return count
}

async function countImagesInZipPath(zipPath: string): Promise<{ imageCount: number; errorMessage: string }> {
  const listed = await listZipArchiveEntries(zipPath)
  if (!listed.ok) {
    return { imageCount: 0, errorMessage: listed.errorMessage }
  }
  return { imageCount: countImagesInZipEntries(listed.entries), errorMessage: "" }
}

function toPosixRelative(baseDir: string, absPath: string): string {
  return path.relative(baseDir, absPath).replace(/\\/g, "/").replace(/^\/+/, "")
}

function parseYoloClassNames(rawYaml: string): string[] {
  const trimmed = rawYaml.trim()
  if (!trimmed) return []
  const out: string[] = []

  const inline = trimmed.match(/(?:^|\n)\s*names\s*:\s*\[([^\]]*)\]/m)
  if (inline) {
    const values = inline[1]
      .split(",")
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean)
    if (values.length > 0) return values
  }

  const lines = rawYaml.split(/\r?\n/)
  const namesStart = lines.findIndex((line) => /^\s*names\s*:\s*$/.test(line))
  if (namesStart < 0) return []
  for (let i = namesStart + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    const listHit = line.match(/^\s*-\s*(.+)\s*$/)
    if (listHit) {
      const value = listHit[1].trim().replace(/^['"]|['"]$/g, "")
      if (value) out.push(value)
      continue
    }
    const mapHit = line.match(/^\s*\d+\s*:\s*(.+)\s*$/)
    if (mapHit) {
      const value = mapHit[1].trim().replace(/^['"]|['"]$/g, "")
      if (value) out.push(value)
      continue
    }
    if (/^\S/.test(line)) break
  }
  return out
}

async function readYoloClassNamesFromExtractedZip(extractedRoot: string): Promise<string[]> {
  const files = walkFilesRecursive(extractedRoot)
  for (const filePath of files) {
    const base = path.basename(filePath).toLowerCase()
    if (base !== "data.yaml" && base !== "data.yml" && base !== "classes.txt") continue
    try {
      const raw = await fs.promises.readFile(filePath, "utf8")
      if (base === "classes.txt") {
        const classes = raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        if (classes.length > 0) return classes
        continue
      }
      const names = parseYoloClassNames(raw)
      if (names.length > 0) return names
    } catch {
      // ignore invalid class files
    }
  }
  return []
}

function resolveYoloTxtForImage(
  relImagePath: string,
  txtSet: Set<string>,
  txtByBaseName: Map<string, string[]>,
): string | null {
  const normalized = relImagePath.replace(/\\/g, "/")
  const noExt = normalized.replace(/\.[^.]+$/, "")
  const sameDir = `${noExt}.txt`.toLowerCase()
  if (txtSet.has(sameDir)) return sameDir

  const labelsMirror = `${noExt}.txt`.replace(/(^|\/)images\//i, "$1labels/").toLowerCase()
  if (txtSet.has(labelsMirror)) return labelsMirror

  const stem = path.posix.basename(noExt).toLowerCase()
  const hits = txtByBaseName.get(`${stem}.txt`) ?? []
  return hits[0] ?? null
}

type ImportedShapeRecord = {
  label: string
  score: number | null
  points: number[][]
  group_id: number | null
  description: string | null
  difficult: boolean
  shape_type: "rectangle" | "rotation" | "polygon"
  flags: Record<string, unknown> | null
  attributes: Record<string, unknown>
  kie_linking: unknown[]
}

function parseImageSizeFromFile(filePath: string): { width: number; height: number } {
  try {
    const header = readFileHeader(filePath)
    const format = detectImageFormat(header)
    const size = parseImageDimensionsFromHeader(header, format)
    return {
      width: Math.max(1, Math.round(size.width || 0)),
      height: Math.max(1, Math.round(size.height || 0)),
    }
  } catch {
    return { width: 1, height: 1 }
  }
}

function parseYoloDetectTxtToShapes(
  txtContent: string,
  labels: string[],
  imageWidth: number,
  imageHeight: number,
): ImportedShapeRecord[] {
  return parseYoloTxtToShapesForTarget(txtContent, labels, imageWidth, imageHeight, "yolo-detect")
}

type YoloImportTargetFormat = "yolo-detect" | "yolo-obb" | "yolo-segment"

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function bboxFromPoints(points: number[][]): { left: number; right: number; top: number; bottom: number } | null {
  if (!points.length) return null
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const pt of points) {
    const x = Number(pt[0] ?? NaN)
    const y = Number(pt[1] ?? NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) return null
  return { left, right, top, bottom }
}

function rectCornersFromBbox(bbox: { left: number; right: number; top: number; bottom: number }): number[][] {
  return [
    [bbox.left, bbox.top],
    [bbox.right, bbox.top],
    [bbox.right, bbox.bottom],
    [bbox.left, bbox.bottom],
  ]
}

function parseYoloLineToShape(
  line: string,
  labels: string[],
  imageWidth: number,
  imageHeight: number,
  options?: { preferObbForLen9?: boolean },
): ImportedShapeRecord | null {
  const values = line.split(/\s+/).map((v) => Number(v))
  if (values.length < 5 || values.some((v) => !Number.isFinite(v))) return null
  const classId = Math.max(0, Math.floor(values[0]))
  const label = labels[classId] ?? `class_${classId}`

  // YOLO detect: class cx cy w h
  if (values.length === 5) {
    const [cx, cy, w, h] = values.slice(1)
    const x1 = (cx - w / 2) * imageWidth
    const y1 = (cy - h / 2) * imageHeight
    const x2 = (cx + w / 2) * imageWidth
    const y2 = (cy + h / 2) * imageHeight
    const bbox = {
      left: Math.min(x1, x2),
      right: Math.max(x1, x2),
      top: Math.min(y1, y2),
      bottom: Math.max(y1, y2),
    }
    return {
      label,
      score: null,
      points: rectCornersFromBbox(bbox),
      group_id: null,
      description: null,
      difficult: false,
      shape_type: "rectangle",
      flags: null,
      attributes: {},
      kie_linking: [],
    }
  }

  // YOLO segment / OBB: class x1 y1 x2 y2 ...
  const coords = values.slice(1)
  if (coords.length < 6 || coords.length % 2 !== 0) return null
  const points: number[][] = []
  for (let i = 0; i < coords.length; i += 2) {
    const x = clamp01(coords[i]) * imageWidth
    const y = clamp01(coords[i + 1]) * imageHeight
    points.push([x, y])
  }
  if (points.length < 3) return null
  const shouldTreatAsObb = options?.preferObbForLen9 === true && values.length === 9
  return {
    label,
    score: null,
    points: shouldTreatAsObb ? points.slice(0, 4) : points,
    group_id: null,
    description: null,
    difficult: false,
    shape_type: shouldTreatAsObb ? "rotation" : "polygon",
    flags: null,
    attributes: {},
    kie_linking: [],
  }
}

function coerceImportedShapeToTarget(shape: ImportedShapeRecord, target: YoloImportTargetFormat): ImportedShapeRecord | null {
  if (target === "yolo-segment") {
    if (shape.shape_type === "polygon") return shape
    return {
      ...shape,
      shape_type: "polygon",
      points: shape.points.slice(0, 4),
    }
  }
  const bbox = bboxFromPoints(shape.points)
  if (!bbox) return null
  const rectPoints = rectCornersFromBbox(bbox)
  if (target === "yolo-detect") {
    return {
      ...shape,
      shape_type: "rectangle",
      points: rectPoints,
    }
  }
  // target === "yolo-obb"
  if (shape.shape_type === "rotation" && shape.points.length >= 4) return shape
  return {
    ...shape,
    shape_type: "rotation",
    points: rectPoints,
  }
}

function parseYoloTxtToShapesForTarget(
  txtContent: string,
  labels: string[],
  imageWidth: number,
  imageHeight: number,
  target: YoloImportTargetFormat,
): ImportedShapeRecord[] {
  const lines = txtContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const out: ImportedShapeRecord[] = []
  for (const line of lines) {
    const parsed = parseYoloLineToShape(line, labels, imageWidth, imageHeight, {
      preferObbForLen9: target === "yolo-obb",
    })
    if (!parsed) continue
    const coerced = coerceImportedShapeToTarget(parsed, target)
    if (!coerced) continue
    out.push(coerced)
  }
  return out
}

function parseYoloObbTxtToShapes(
  txtContent: string,
  labels: string[],
  imageWidth: number,
  imageHeight: number,
): ImportedShapeRecord[] {
  return parseYoloTxtToShapesForTarget(txtContent, labels, imageWidth, imageHeight, "yolo-obb")
}

function parseYoloSegmentTxtToShapes(
  txtContent: string,
  labels: string[],
  imageWidth: number,
  imageHeight: number,
): ImportedShapeRecord[] {
  return parseYoloTxtToShapesForTarget(txtContent, labels, imageWidth, imageHeight, "yolo-segment")
}

function createXAnyDocJson(params: {
  imageFileName: string
  imageWidth: number
  imageHeight: number
  shapes: ImportedShapeRecord[]
}): string {
  return JSON.stringify(
    {
      version: "2.5.4",
      flags: {},
      shapes: params.shapes,
      description: null,
      imagePath: params.imageFileName,
      imageData: null,
      imageHeight: params.imageHeight,
      imageWidth: params.imageWidth,
    },
    null,
    2,
  )
}

async function extractZipToTempDir(zipPath: string, tempRoot: string): Promise<{ ok: boolean; extractDir: string; errorMessage: string }> {
  const extractDir = path.join(tempRoot, "unzipped")
  await fs.promises.mkdir(extractDir, { recursive: true })
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(resolveSystemTarExecutable(), ["-xf", zipPath, "-C", extractDir], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      })
      let stderr = ""
      child.stderr?.setEncoding("utf8")
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) {
          resolve()
          return
        }
        const errMsg = stderr.trim()
        reject(new Error(errMsg ? `解压 zip 失败：${errMsg}` : `解压 zip 失败（退出码 ${code ?? "unknown"}）`))
      })
    })
    return { ok: true, extractDir, errorMessage: "" }
  } catch (error) {
    return {
      ok: false,
      extractDir,
      errorMessage: error instanceof Error ? error.message : "解压 zip 失败，请检查压缩包是否损坏。",
    }
  }
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

function validateImageDecodeSafetyFromHeader(filePath: string): { ok: true } | { ok: false; errorMessage: string } {
  try {
    const header = readFileHeader(filePath)
    const format = detectImageFormat(header)
    const size = parseImageDimensionsFromHeader(header, format)
    const width = Math.max(0, Math.floor(Number(size.width) || 0))
    const height = Math.max(0, Math.floor(Number(size.height) || 0))
    const totalPixels = width * height
    if (width > 0 && height > 0 && totalPixels > MAX_IMAGE_DECODE_PIXELS) {
      const limitMp = Math.floor(MAX_IMAGE_DECODE_PIXELS / 1024 / 1024)
      const actualMp = (totalPixels / 1024 / 1024).toFixed(1)
      return {
        ok: false,
        errorMessage: `图片分辨率过大（${width}x${height}, ${actualMp} MP），超过安全解码上限 ${limitMp} MP。`,
      }
    }
  } catch {
    // 若头部解析失败，维持原有行为，交由后续路径或前端 onError 处理。
  }
  return { ok: true }
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

win.on("closed", () => {
  stopEmbeddedPythonBackend()
})

process.on("exit", () => {
  stopEmbeddedPythonBackend()
})

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
        paths: (result.paths ?? []).map((item) => resolveExistingIpcPath(item)),
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
        tags: protoProjectTagsToRecords(request.tags),
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
          tags: projectTagRecordsToProto(project.tags),
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
      tags: projectTagRecordsToProto(project.tags),
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
        tags: projectTagRecordsToProto(project.tags),
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
        tags: protoProjectTagsToRecords(request.tags),
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
          tags: projectTagRecordsToProto(project.tags),
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
        deleteProjectTasksFile(request.globalConfigDir, request.id)
        deleteProjectExportVersionsFile(request.globalConfigDir, request.id)
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
      const resolvedTask = resolveTaskRootDir(request.globalConfigDir, request.projectId, request.taskId)
      if (resolvedTask.errorMessage) {
        return { errorMessage: resolvedTask.errorMessage, savedPaths: [] }
      }
      const taskRootDir = resolvedTask.taskRootDir
      if (rawSubset === "__DELETE_TASK__") {
        const result = await runTaskDelete({
          globalConfigDir: request.globalConfigDir,
          databaseDir: request.databaseDir,
          projectId: request.projectId,
          taskId: request.taskId,
          taskRootDir,
        })
        return { errorMessage: result.errorMessage, savedPaths: [] }
      }
      const subset = sanitizeSegment(rawSubset || "default")
      const taskDir = path.join(taskRootDir, subset)
      await fs.promises.mkdir(taskDir, { recursive: true })

      const incomingImageCount = request.files.filter((file) => {
        const rawFileName = (file.fileName || file.sourcePath || "").trim()
        const fileName = path.basename(rawFileName).trim()
        return fileName && isTaskImageFilePath(fileName)
      }).length
      const existingImageCount = countImagesInTaskDir(taskDir)
      if (existingImageCount + incomingImageCount > TASK_CREATE_IMAGE_UPLOAD_LIMIT) {
        return {
          errorMessage: `单次任务最多导入 ${TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张图片（当前已有 ${existingImageCount} 张，本次 ${incomingImageCount} 张）。`,
          savedPaths: [],
        }
      }

      const savedPaths: string[] = []
      const failedCopies: Array<{ sourcePath: string; reason: string }> = []
      for (const file of request.files) {
        const rawSourcePath = (file.sourcePath || "").trim()
        const sourcePath = resolveExistingIpcPath(rawSourcePath)
        const rawFileName = (file.fileName || rawSourcePath || sourcePath).trim()
        const fileName = path.basename(rawFileName).trim()
        if (!fileName) {
          failedCopies.push({
            sourcePath: rawSourcePath || sourcePath || "(empty)",
            reason: `文件名为空（rawFileName=${JSON.stringify(rawFileName)}）`,
          })
          continue
        }
        const targetPath = buildUniqueFilePath(taskDir, fileName)
        if (sourcePath) {
          try {
            await fs.promises.copyFile(sourcePath, targetPath)
            savedPaths.push(targetPath)
            continue
          } catch (error) {
            // Fallback to content write when source path cannot be copied.
            failedCopies.push({
              sourcePath: rawSourcePath || sourcePath,
              reason:
                `copy 失败（resolved=${JSON.stringify(sourcePath)}）: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            })
          }
        } else {
          failedCopies.push({
            sourcePath: rawSourcePath || "(empty)",
            reason: "路径为空或不可解析",
          })
        }
        const content = file.content
        if (content && content.length > 0) {
          await fs.promises.writeFile(targetPath, Buffer.from(content))
          savedPaths.push(targetPath)
        } else {
          failedCopies.push({
            sourcePath: rawSourcePath || sourcePath || "(empty)",
            reason: "无 sourcePath 且无 content",
          })
        }
      }

      if (savedPaths.length === 0 && request.files.length > 0) {
        const firstFailure = failedCopies[0]
        const detail = firstFailure
          ? `；示例：${firstFailure.sourcePath}（${firstFailure.reason}）`
          : ""
        return {
          errorMessage: `没有可保存的有效文件（缺少路径且无文件内容，或路径不可访问）${detail}`,
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
  async ImportTaskImageZip(request: ImportTaskImageZipRequest): Promise<ImportTaskImageZipResponse> {
    let tempRoot = ""
    try {
      tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "easyannotate-task-imagezip-"))
      const project = getProject(request.globalConfigDir, request.projectId)
      if (!project) {
        return { errorMessage: "项目不存在。", savedPaths: [], importedImageCount: 0 }
      }
      const zipPath = resolveExistingIpcPath(request.zipPath || "")
      if (!zipPath) {
        return { errorMessage: "请选择 zip 文件。", savedPaths: [], importedImageCount: 0 }
      }
      if (!zipPath.toLowerCase().endsWith(".zip")) {
        return { errorMessage: "仅支持 .zip 文件。", savedPaths: [], importedImageCount: 0 }
      }
      if (!fs.existsSync(zipPath)) {
        return { errorMessage: "zip 文件不存在。", savedPaths: [], importedImageCount: 0 }
      }

      const extract = await extractZipToTempDir(zipPath, tempRoot)
      if (!extract.ok) {
        return { errorMessage: extract.errorMessage, savedPaths: [], importedImageCount: 0 }
      }

      const imageExts = TASK_IMAGE_EXTS
      const images = walkFilesRecursive(extract.extractDir).filter((p) => imageExts.has(path.extname(p).toLowerCase()))
      if (images.length <= 0) {
        return { errorMessage: "zip 内未找到可导入图片。", savedPaths: [], importedImageCount: 0 }
      }

      const rawSubset = (request.subset || "").trim()
      const baseRoot =
        project.storageType === "local" && project.localPath
          ? project.localPath
          : path.dirname(project.configFilePath)
      const taskRootDir = path.join(baseRoot, "data", "tasks", sanitizeSegment(request.taskId))
      const subset = sanitizeSegment(rawSubset || "default")
      const taskDir = path.join(taskRootDir, subset)
      await fs.promises.mkdir(taskDir, { recursive: true })

      const existingImageCount = countImagesInTaskDir(taskDir)
      const totalAfterImport = existingImageCount + images.length
      if (totalAfterImport > TASK_CREATE_IMAGE_UPLOAD_LIMIT) {
        return {
          errorMessage: `单次任务最多导入 ${TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张图片（当前已有 ${existingImageCount} 张，ZIP 内 ${images.length} 张）。`,
          savedPaths: [],
          importedImageCount: 0,
        }
      }

      let importedImageCount = 0
      for (const srcImagePath of images) {
        const targetImagePath = buildUniqueFilePath(taskDir, path.basename(srcImagePath))
        await fs.promises.copyFile(srcImagePath, targetImagePath)
        importedImageCount += 1
      }
      // 仅返回数量，避免大量 saved_paths 撑爆 IPC protobuf。
      return { errorMessage: "", savedPaths: [], importedImageCount }
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        savedPaths: [],
        importedImageCount: 0,
      }
    } finally {
      if (tempRoot) {
        await fs.promises.rm(tempRoot, { recursive: true, force: true })
      }
    }
  },
  async CountTaskImageZip(request: CountTaskImageZipRequest): Promise<CountTaskImageZipResponse> {
    try {
      const zipPath = resolveExistingIpcPath(request.zipPath || "")
      if (!zipPath) {
        return { errorMessage: "请选择 zip 文件。", imageCount: 0 }
      }
      if (!zipPath.toLowerCase().endsWith(".zip")) {
        return { errorMessage: "仅支持 .zip 文件。", imageCount: 0 }
      }
      if (!fs.existsSync(zipPath)) {
        return { errorMessage: "zip 文件不存在。", imageCount: 0 }
      }
      const counted = await countImagesInZipPath(zipPath)
      if (counted.errorMessage) {
        return { errorMessage: counted.errorMessage, imageCount: 0 }
      }
      return { errorMessage: "", imageCount: counted.imageCount }
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        imageCount: 0,
      }
    }
  },
  async ImportAnnotatedTaskZip(request: ImportAnnotatedTaskZipRequest): Promise<ImportAnnotatedTaskZipResponse> {
    const zipPath = resolveExistingIpcPath(request.zipPath || "")
    const result = await runAnnotatedTaskZipImport({
      globalConfigDir: request.globalConfigDir,
      projectId: request.projectId,
      taskId: request.taskId,
      subset: request.subset,
      zipPath,
      importFormat: request.importFormat,
    })
    return {
      errorMessage: result.errorMessage,
      savedPaths: [],
      importedImageCount: result.importedImageCount,
      importedAnnotationCount: result.importedAnnotationCount,
      detectedFormat: result.detectedFormat,
    }
  },
  async StartAnnotatedTaskZipImport(
    request: StartAnnotatedTaskZipImportRequest,
  ): Promise<StartAnnotatedTaskZipImportResponse> {
    try {
      const importFormat = (request.importFormat || "xanylabeling").trim().toLowerCase()
      const allowFormats = new Set(["xanylabeling", "yolo-detect", "yolo-obb", "yolo-segment", "yolo-pose"])
      if (!allowFormats.has(importFormat)) {
        return { errorMessage: `不支持的导入格式：${importFormat}`, jobId: "" }
      }
      if (
        importFormat !== "xanylabeling" &&
        importFormat !== "yolo-detect" &&
        importFormat !== "yolo-obb" &&
        importFormat !== "yolo-segment"
      ) {
        return {
          errorMessage: `导入格式 ${importFormat} 暂未实现，当前支持 xanylabeling / yolo-detect / yolo-obb / yolo-segment。`,
          jobId: "",
        }
      }
      const project = getProject(request.globalConfigDir, request.projectId)
      if (!project) {
        return { errorMessage: "项目不存在。", jobId: "" }
      }
      const zipPath = resolveExistingIpcPath(request.zipPath || "")
      if (!zipPath) {
        return { errorMessage: "请选择 zip 文件。", jobId: "" }
      }
      if (!zipPath.toLowerCase().endsWith(".zip")) {
        return { errorMessage: "仅支持 .zip 文件。", jobId: "" }
      }
      if (!fs.existsSync(zipPath)) {
        return { errorMessage: "zip 文件不存在。", jobId: "" }
      }
      const started = startAnnotatedTaskImportJob({
        globalConfigDir: request.globalConfigDir,
        projectId: request.projectId,
        taskId: request.taskId,
        subset: request.subset,
        zipPath,
        importFormat,
      })
      return { errorMessage: started.errorMessage, jobId: started.jobId }
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        jobId: "",
      }
    }
  },
  async StartTaskDelete(request: StartTaskDeleteRequest): Promise<StartTaskDeleteResponse> {
    try {
      const resolvedTask = resolveTaskRootDir(request.globalConfigDir, request.projectId, request.taskId)
      if (resolvedTask.errorMessage) {
        return { errorMessage: resolvedTask.errorMessage, jobId: "" }
      }
      const started = startTaskDeleteJob({
        globalConfigDir: request.globalConfigDir,
        databaseDir: request.databaseDir || "",
        projectId: request.projectId,
        taskId: request.taskId,
        taskRootDir: resolvedTask.taskRootDir,
      })
      return { errorMessage: started.errorMessage, jobId: started.jobId }
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        jobId: "",
      }
    }
  },
  async ListAnnotatedTaskImportJobs(_request): Promise<ListAnnotatedTaskImportJobsResponse> {
    try {
      const jobs = listAnnotatedTaskImportJobsAsExportJobsForIpc().map((job) => {
        const [statusMessage, meta = ""] = (job.message || "").split("\n---IMPORT_META---\n")
        const [importedImageCountRaw, importedAnnotationCountRaw, detectedFormat = ""] = meta.split("|")
        return {
          id: job.id,
          projectId: job.projectId,
          taskId: job.taskId,
          subset: job.versionName,
          importFormat: job.outputDir,
          status: job.status,
          progress: job.progress,
          message: statusMessage,
          importedImageCount: Math.max(0, Math.floor(Number(importedImageCountRaw) || 0)),
          importedAnnotationCount: Math.max(0, Math.floor(Number(importedAnnotationCountRaw) || 0)),
          detectedFormat,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        }
      })
      return { jobs }
    } catch {
      return { jobs: [] }
    }
  },
  async GetAnnotatedTaskImportJob(
    request: GetAnnotatedTaskImportJobRequest,
  ): Promise<GetAnnotatedTaskImportJobResponse> {
    try {
      const jobId = (request.jobId || "").trim()
      if (!jobId) {
        return { found: false, job: undefined, errorMessage: "job_id 为空。" }
      }
      const job = getAnnotatedImportJobRecord(jobId)
      if (!job) {
        return { found: false, job: undefined, errorMessage: "" }
      }
      return {
        found: true,
        job: {
          id: job.id,
          projectId: job.projectId,
          taskId: job.taskId,
          subset: job.subset,
          importFormat: job.importFormat,
          status: job.status,
          progress: job.progress,
          message: job.statusMessage || job.message || "",
          importedImageCount: job.importedImageCount,
          importedAnnotationCount: job.importedAnnotationCount,
          detectedFormat: job.detectedFormat,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
        errorMessage: "",
      }
    } catch (error) {
      return {
        found: false,
        job: undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async ListTaskFiles(request: ListTaskFilesRequest): Promise<ListTaskFilesResponse> {
    try {
      const project = getProject(request.globalConfigDir, request.projectId)
      if (!project) {
        return { files: [], errorMessage: "项目不存在。", hasMore: false }
      }
      const baseRoot =
        project.storageType === "local" && project.localPath
          ? project.localPath
          : path.dirname(project.configFilePath)
      const taskRootDir = path.join(baseRoot, "data", "tasks", sanitizeSegment(request.taskId))
      const offset = Math.max(0, Math.floor(Number(request.offset) || 0))
      const limit = Math.max(1, Math.floor(Number(request.limit) || 10))
      const page = collectTaskFilesPage(taskRootDir, offset, limit)
      const files = page.records.map((item, index) => ({
        id: `${request.taskId}-${offset + index + 1}`,
        projectId: request.projectId,
        taskId: request.taskId,
        subset: item.subset,
        filePath: item.filePath,
        createdAt: item.createdAt,
        hasAnnotation: item.hasAnnotation,
      }))
      return { files, errorMessage: "", hasMore: page.hasMore }
    } catch (error) {
      return {
        files: [],
        errorMessage: error instanceof Error ? error.message : String(error),
        hasMore: false,
      }
    }
  },
  async ListProjectTasks(request: ListProjectTasksRequest): Promise<ListProjectTasksResponse> {
    try {
      const tasks = readProjectTasks(request.globalConfigDir, request.projectId).map((t) => ({
        id: t.id,
        name: t.name,
        subset: t.subset,
        fileCount: t.fileCount,
        annotatedFileCount: t.annotatedFileCount ?? 0,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        coverColor: t.coverColor,
      }))
      return { tasks, errorMessage: "" }
    } catch (error) {
      return {
        tasks: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async SaveProjectTasks(request: SaveProjectTasksRequest): Promise<SaveProjectTasksResponse> {
    try {
      const project = getProject(request.globalConfigDir, request.projectId)
      if (!project) {
        return { errorMessage: "项目不存在。" }
      }
      const records = (request.tasks ?? []).map((t) => ({
        id: (t.id ?? "").trim(),
        name: (t.name ?? "").trim(),
        subset: (t.subset ?? "").trim(),
        fileCount: Math.max(0, Math.floor(Number(t.fileCount) || 0)),
        annotatedFileCount:
          typeof t.annotatedFileCount === "number" && Number.isFinite(t.annotatedFileCount)
            ? Math.max(0, Math.floor(t.annotatedFileCount))
            : undefined,
        createdAt: (t.createdAt ?? "").trim(),
        updatedAt: (t.updatedAt ?? "").trim(),
        coverColor: (t.coverColor ?? "").trim() || "#334155",
      }))
      writeProjectTasks(request.globalConfigDir, request.projectId, records)
      return { errorMessage: "" }
    } catch (error) {
      return { errorMessage: error instanceof Error ? error.message : String(error) }
    }
  },
  async GetProjectTaskAnnotatedCounts(
    request: GetProjectTaskAnnotatedCountsRequest,
  ): Promise<GetProjectTaskAnnotatedCountsResponse> {
    try {
      const projectId = (request.projectId || "").trim()
      if (!projectId) {
        return { items: [], errorMessage: "项目 ID 为空。" }
      }
      const counts = countAnnotatedImagesByTaskForProject(request.databaseDir || "", projectId)
      return {
        items: Object.entries(counts).map(([taskId, annotatedImageCount]) => ({
          taskId,
          annotatedImageCount,
        })),
        errorMessage: "",
      }
    } catch (error) {
      return {
        items: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async GetProjectExportVersions(request: GetProjectExportVersionsRequest): Promise<GetProjectExportVersionsResponse> {
    try {
      const { jsonText, exists } = readProjectExportVersionsJson(request.globalConfigDir, request.projectId)
      return { jsonText, exists, errorMessage: "" }
    } catch (error) {
      return {
        jsonText: "",
        exists: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async SaveProjectExportVersions(request: SaveProjectExportVersionsRequest): Promise<SaveProjectExportVersionsResponse> {
    try {
      const project = getProject(request.globalConfigDir, request.projectId)
      if (!project) {
        return { errorMessage: "项目不存在。" }
      }
      writeProjectExportVersionsJson(request.globalConfigDir, request.projectId, request.jsonText ?? "")
      return { errorMessage: "" }
    } catch (error) {
      return { errorMessage: error instanceof Error ? error.message : String(error) }
    }
  },
  async ReadImageFile(request: ReadImageFileRequest): Promise<ReadImageFileResponse> {
    try {
      const filePath = resolveExistingIpcPath(request.path || "")
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
      if (stat.size > MAX_IMAGE_IPC_BYTES) {
        return {
          content: Buffer.alloc(0),
          errorMessage:
            `图片文件过大（${Math.floor(stat.size / 1024 / 1024)} MB），` +
            `超过 IPC 读取上限 ${Math.floor(MAX_IMAGE_IPC_BYTES / 1024 / 1024)} MB。` +
            "请先压缩图片或改用更小分辨率后再标注。",
        }
      }
      const decodeSafety = validateImageDecodeSafetyFromHeader(filePath)
      if (!decodeSafety.ok) {
        return {
          content: Buffer.alloc(0),
          errorMessage: decodeSafety.errorMessage,
        }
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
      const stat = fs.statSync(jsonPath)
      if (!stat.isFile()) {
        return { jsonText: "", exists: false, errorMessage: "标注路径不是文件。" }
      }
      if (stat.size > MAX_ANNOTATION_JSON_BYTES) {
        return {
          jsonText: "",
          exists: true,
          errorMessage:
            `标注文件过大（${Math.floor(stat.size / 1024)} KB），已拒绝读取以避免崩溃。` +
            "请清理该图片对应 json 后重试。",
        }
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
  async AppendImageAnnotationShapes(
    request: AppendImageAnnotationShapesRequest,
  ): Promise<AppendImageAnnotationShapesResponse> {
    try {
      const imagePath = (request.imagePath || "").trim()
      if (!imagePath) {
        return { jsonPath: "", errorMessage: "图片路径为空。" }
      }
      const jsonPath = resolveAnnotationJsonPath(imagePath)
      const result = appendShapesToAnnotationJsonFile({
        jsonPath,
        imagePath,
        imageWidth: request.imageWidth ?? 0,
        imageHeight: request.imageHeight ?? 0,
        shapesJson: request.shapesJson || "[]",
      })
      return { jsonPath: result.jsonPath, errorMessage: result.errorMessage }
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
  async DeleteTaskAnnotations(request: DeleteTaskAnnotationsRequest): Promise<DeleteTaskAnnotationsResponse> {
    try {
      const projectId = (request.projectId || "").trim()
      const taskId = (request.taskId || "").trim()
      if (!projectId || !taskId) {
        return { errorMessage: "项目或任务标识为空。" }
      }
      const project = getProject(request.globalConfigDir, projectId)
      if (!project) {
        return { errorMessage: "项目不存在。" }
      }
      const baseRoot =
        project.storageType === "local" && project.localPath
          ? project.localPath
          : path.dirname(project.configFilePath)
      const taskRootDir = path.join(baseRoot, "data", "tasks", sanitizeSegment(taskId))
      const files = collectTaskFiles(taskRootDir)
      for (const item of files) {
        const jsonPath = resolveAnnotationJsonPath(item.filePath)
        fs.rmSync(jsonPath, { force: true })
      }
      const databaseDir = (request.databaseDir || "").trim()
      await deleteAnnotationsForTask(databaseDir, projectId, taskId)
      return { errorMessage: "" }
    } catch (error) {
      return { errorMessage: error instanceof Error ? error.message : String(error) }
    }
  },
  async GetImageFileInfo(request: GetImageFileInfoRequest): Promise<GetImageFileInfoResponse> {
    try {
      const filePath = (request.path || "").trim()
      if (!filePath) {
        return {
          exists: false,
          sizeBytes: 0,
          format: "",
          channelCount: 0,
          extension: "",
          errorMessage: "图片路径为空。",
          width: 0,
          height: 0,
        }
      }
      if (!fs.existsSync(filePath)) {
        return {
          exists: false,
          sizeBytes: 0,
          format: "",
          channelCount: 0,
          extension: "",
          errorMessage: "",
          width: 0,
          height: 0,
        }
      }
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        return {
          exists: false,
          sizeBytes: 0,
          format: "",
          channelCount: 0,
          extension: "",
          errorMessage: "路径不是文件。",
          width: 0,
          height: 0,
        }
      }
      const extension = path.extname(filePath).toLowerCase()
      const header = readFileHeader(filePath)
      const format = detectImageFormat(header)
      const channelCount = detectImageChannelCount(header, format) ?? 0
      const { width, height } = parseImageDimensionsFromHeader(header, format)
      return {
        exists: true,
        sizeBytes: Math.floor(stat.size),
        format,
        channelCount,
        extension,
        errorMessage: "",
        width,
        height,
      }
    } catch (error) {
      return {
        exists: false,
        sizeBytes: 0,
        format: "",
        channelCount: 0,
        extension: "",
        errorMessage: error instanceof Error ? error.message : String(error),
        width: 0,
        height: 0,
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
  async StartDatasetExport(request: StartDatasetExportRequest): Promise<StartDatasetExportResponse> {
    try {
      const projectId = (request.projectId || "").trim()
      if (!projectId) {
        return { canceled: true, jobId: "", errorMessage: "项目 ID 为空。" }
      }
      const project = getProject(request.globalConfigDir, projectId)
      if (!project) {
        return { canceled: true, jobId: "", errorMessage: "项目不存在。" }
      }
      const exportFormat = (request.exportFormat || "coco").trim()
      const allowFormats = new Set(["coco", "voc", "yolo-detect", "yolo-obb", "yolo-segment", "yolo-pose", "xanylabeling"])
      if (!allowFormats.has(exportFormat)) {
        return { canceled: true, jobId: "", errorMessage: `不支持的导出格式：${exportFormat}` }
      }
      const taskId = (request.taskId || "").trim()
      const keepProjectStructure = request.keepProjectStructure === true
      const compressToZip = request.compressToZip === true
      const dialogResult = await app.showOpenDialog({
        parentWindow: win,
        title: compressToZip ? "选择 ZIP 保存目录" : "选择导出目录",
        defaultPath: project.localPath || path.dirname(project.configFilePath),
        selectionPolicy: "directories",
        features: {
          allowMultiple: false,
          canCreateDirectories: true,
        },
      })
      if (dialogResult.canceled || !dialogResult.paths[0]) {
        return { canceled: true, jobId: "", errorMessage: "" }
      }
      const parentDir = dialogResult.paths[0]
      const versionName = request.versionName || "export"
      const outputPath = compressToZip
        ? buildUniqueZipPath(parentDir, versionName)
        : buildUniqueExportFolderPath(parentDir, versionName)
      const trainBoundary = Math.max(0, Math.min(100, Math.floor(request.trainBoundary)))
      const valBoundary = Math.max(trainBoundary, Math.min(100, Math.floor(request.valBoundary)))
      const projectTasks = readProjectTasks(request.globalConfigDir, projectId)
      const fileCountById = new Map(projectTasks.map((t) => [t.id, Math.max(0, Math.floor(Number(t.fileCount) || 0))]))
      const exportTaskIds = taskId ? [taskId] : (request.taskNames ?? []).map((item) => (item.taskId || "").trim()).filter(Boolean)
      const estimatedImageCount = exportTaskIds.reduce((sum, id) => sum + (fileCountById.get(id) ?? 0), 0)
      const started = startDatasetExportJob({
        project,
        projectId,
        taskId: taskId || undefined,
        exportFormat: exportFormat as any,
        keepProjectStructure,
        trainBoundary,
        valBoundary,
        versionName: request.versionName || "Untitled Version",
        compressToZip,
        outputPath,
        taskNameById: Object.fromEntries((request.taskNames ?? []).map((item) => [item.taskId, item.taskName])),
        estimatedImageCount,
      })
      return { canceled: false, jobId: started.jobId, errorMessage: "" }
    } catch (error) {
      return {
        canceled: true,
        jobId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async ListExportJobs(_request): Promise<ListExportJobsResponse> {
    const exportJobs = listDatasetExportJobsForIpc().map((job) => ({
      id: job.id,
      projectId: job.projectId,
      taskId: job.taskId,
      versionName: job.versionName,
      exportFormat: job.exportFormat,
      keepProjectStructure: job.keepProjectStructure,
      outputDir: job.outputDir,
      status: job.status,
      progress: job.progress,
      message: job.message,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }))
    const importJobs = listAnnotatedTaskImportJobsAsExportJobsForIpc()
    const deleteJobs = listTaskDeleteJobsAsExportJobsForIpc()
    const jobs = [...exportJobs, ...importJobs, ...deleteJobs]
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, 24)
    return { jobs }
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
  async GetAppConfigFromDisk(request: GetAppConfigFromDiskRequest): Promise<GetAppConfigFromDiskResponse> {
    try {
      const { jsonText, exists } = readAppConfigFromDisk(request.globalConfigDir)
      return { appConfigJson: jsonText, exists, errorMessage: "" }
    } catch (error) {
      return {
        appConfigJson: "",
        exists: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  },
  async MigrateGlobalConfigDir(request: MigrateGlobalConfigDirRequest): Promise<MigrateGlobalConfigDirResponse> {
    const result = migrateGlobalConfigDir(request.oldDir, request.newDir)
    return {
      success: result.success,
      errorMessage: result.errorMessage,
      copiedCount: result.copiedCount,
    }
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
  async GetLocalBackendStatus(_request) {
    const reachable = await probeLocalBackendHealth()
    return { reachable }
  },
  async ProbeRemoteBackendHealth(request) {
    const healthUrl = buildRemoteHealthUrl(request.protocol, request.host, request.port, request.basePath)
    const timeoutMs = Number.isFinite(request.timeoutMs) ? request.timeoutMs : 5000
    const result = await probeRemoteHealthViaNodeHttp(healthUrl, timeoutMs)
    return {
      ok: result.ok,
      healthUrl,
      reason: result.reason,
      httpStatus: result.httpStatus,
    }
  },
  async ProxyBackendHttp(request) {
    const method = (request.method || "GET").trim() || "GET"
    const headers = { ...(request.headers || {}) } as Record<string, string>
    const body = request.body instanceof Uint8Array ? request.body : new Uint8Array()
    const timeoutMs = Number.isFinite(request.timeoutMs) && request.timeoutMs > 0 ? request.timeoutMs : 60_000
    const result = await proxyBackendHttpViaNodeHttp({
      url: request.url,
      method,
      headers,
      body,
      timeoutMs,
    })
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      errorMessage: result.errorMessage,
    }
  },
  async ProxyBackendImageUpload(request) {
    const timeoutMs = Number.isFinite(request.timeoutMs) && request.timeoutMs > 0 ? request.timeoutMs : 120_000
    const result = await proxyBackendImageUpload({
      url: request.url,
      imagePath: request.imagePath,
      payloadJson: request.payloadJson || "",
      timeoutMs,
    })
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      errorMessage: result.errorMessage,
    }
  },
  async StartLocalBackend(request) {
    return await startEmbeddedPythonBackend(request.backendDirectory)
  },
  async StopLocalBackend(_request) {
    const stopped = stopEmbeddedPythonBackend()
    return {
      stopped,
      message: stopped
        ? ""
        : "当前没有由本应用拉起的本地后端进程。若接口仍可用，可能是手动启动或其它程序占用端口。",
    }
  },
  async DownloadYoloTrainingModel(
    request: DownloadYoloTrainingModelRequest,
  ): Promise<DownloadYoloTrainingModelResponse> {
    const url = (request.downloadUrl || "").trim()
    const fileName = sanitizeModelDownloadFileName(request.suggestedFileName || "")

    try {
      if (!url) {
        return { canceled: true, savedPath: "", errorMessage: "下载地址为空。", downloadId: "" }
      }

      pruneYoloModelDownloadJobs()
      const downloadsDir = path.join(os.homedir(), "Downloads")
      const defaultDir = fs.existsSync(downloadsDir) ? downloadsDir : os.homedir()

      const dialogResult = await app.showOpenDialog({
        parentWindow: win,
        title: "选择模型保存目录",
        defaultPath: defaultDir,
        selectionPolicy: "directories",
        features: {
          allowMultiple: false,
          canCreateDirectories: true,
        },
      })
      if (dialogResult.canceled || !dialogResult.paths[0]) {
        return { canceled: true, savedPath: "", errorMessage: "", downloadId: "" }
      }

      const targetPath = buildUniqueFilePath(dialogResult.paths[0], fileName)
      const downloadId = randomUUID()
      startHttpModelDownloadJob(downloadId, url, targetPath)
      return { canceled: false, savedPath: "", errorMessage: "", downloadId }
    } catch (error) {
      return {
        canceled: true,
        savedPath: "",
        errorMessage: error instanceof Error ? error.message : String(error),
        downloadId: "",
      }
    }
  },
  async GetYoloModelDownloadStatus(
    request: GetYoloModelDownloadStatusRequest,
  ): Promise<GetYoloModelDownloadStatusResponse> {
    pruneYoloModelDownloadJobs()
    const downloadId = (request.downloadId || "").trim()
    const job = downloadId ? _yoloModelDownloadJobs.get(downloadId) : undefined
    if (!job) {
      return { status: "failed", savedPath: "", errorMessage: "下载任务不存在或已过期。" }
    }
    return {
      status: job.status,
      savedPath: job.savedPath,
      errorMessage: job.errorMessage,
    }
  },
  async CopyYoloBatchModelFile(request) {
    const backendDir = request.backendDirectory?.trim() ?? ""
    const modelSlug = request.modelSlug?.trim() ?? ""
    const sourcePath = request.sourcePath?.trim() ?? ""
    const kind = request.kind?.trim() ?? ""
    if (!backendDir) {
      return { ok: false, errorMessage: "未配置本地 backend 目录", destPath: "" }
    }
    if (!modelSlug) {
      return { ok: false, errorMessage: "缺少模型标识", destPath: "" }
    }
    if (!sourcePath) {
      return { ok: false, errorMessage: "未选择源文件", destPath: "" }
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, errorMessage: `源文件不存在：${sourcePath}`, destPath: "" }
    }
    const lower = sourcePath.toLowerCase()
    let destName = ""
    if (kind === "data_yaml") {
      if (!lower.endsWith(".yaml") && !lower.endsWith(".yml")) {
        return { ok: false, errorMessage: "仅支持 .yaml / .yml", destPath: "" }
      }
      destName = "data.yaml"
    } else if (kind === "weights") {
      if (!lower.endsWith(".pt")) {
        return { ok: false, errorMessage: "仅支持 .pt 权重", destPath: "" }
      }
      destName = "weights.pt"
    } else {
      return { ok: false, errorMessage: `未知文件类型：${kind}`, destPath: "" }
    }
    try {
      const modelDir = path.join(path.normalize(backendDir), "external", "model_temp", modelSlug)
      if (!fs.existsSync(modelDir)) {
        return { ok: false, errorMessage: "请先创建模型工作区（填写名称并准备新建）", destPath: "" }
      }
      const dest = path.join(modelDir, destName)
      fs.copyFileSync(sourcePath, dest)
      return { ok: true, errorMessage: "", destPath: dest }
    } catch (error) {
      return {
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        destPath: "",
      }
    }
  },
  async CopyYoloTrainingDatasetZip(request) {
    const backendDir = request.backendDirectory?.trim() ?? ""
    const sourceZip = request.sourceZipPath?.trim() ?? ""
    const trainingName = request.trainingName?.trim() ?? ""
    if (!backendDir) {
      return { ok: false, errorMessage: "未配置本地 backend 目录", datasetZipPath: "" }
    }
    if (!sourceZip) {
      return { ok: false, errorMessage: "未选择 zip 文件", datasetZipPath: "" }
    }
    if (!trainingName) {
      return { ok: false, errorMessage: "未填写训练名称", datasetZipPath: "" }
    }
    if (!fs.existsSync(sourceZip)) {
      return { ok: false, errorMessage: `源文件不存在：${sourceZip}`, datasetZipPath: "" }
    }
    if (!sourceZip.toLowerCase().endsWith(".zip")) {
      return { ok: false, errorMessage: "仅支持 .zip 数据集", datasetZipPath: "" }
    }
    const slug = trainingName
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 120)
    if (!slug) {
      return { ok: false, errorMessage: "训练名称无效", datasetZipPath: "" }
    }
    try {
      const jobDir = path.join(path.normalize(backendDir), "external", "temp", slug)
      if (!fs.existsSync(jobDir)) {
        return { ok: false, errorMessage: "请先点击「创建训练任务」", datasetZipPath: "" }
      }
      const dest = path.join(jobDir, "dataset.zip")
      fs.copyFileSync(sourceZip, dest)
      return { ok: true, errorMessage: "", datasetZipPath: dest }
    } catch (error) {
      return {
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        datasetZipPath: "",
      }
    }
  },
}))

import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { normalizeXAnyLabelDoc } from "../renderer/lib/xanylabeling-format"
import type { ProjectRecord } from "./project-storage"

type ExportFormat = "coco" | "voc" | "yolo-detect" | "yolo-obb" | "yolo-segment" | "yolo-pose" | "xanylabeling"
type ExportStatus = "queued" | "running" | "success" | "failed"

export type ExportJobRecord = {
  id: string
  projectId: string
  taskId: string
  versionName: string
  exportFormat: ExportFormat
  keepProjectStructure: boolean
  outputDir: string
  status: ExportStatus
  progress: number
  message: string
  statusMessage: string
  logLines: string[]
  createdAt: string
  updatedAt: string
}

export type ExportRequest = {
  project: ProjectRecord
  projectId: string
  taskId?: string
  exportFormat: ExportFormat
  keepProjectStructure: boolean
  trainBoundary: number
  valBoundary: number
  versionName: string
  /** 为 true 时写入临时目录后打包为 ZIP；为 false 时直接写入 outputPath 文件夹 */
  compressToZip: boolean
  /** 导出目标：文件夹路径，或（compressToZip 时）ZIP 文件路径 */
  outputPath: string
  taskNameById: Record<string, string>
  /** 来自任务 registry 的 fileCount 之和，用于进度条；不再预扫磁盘 */
  estimatedImageCount: number
}

type XAnyShape = {
  label?: string
  shape_type?: string
  points?: number[][]
  attributes?: Record<string, unknown>
}

type XAnyDoc = {
  imageWidth?: number
  imageHeight?: number
  shapes?: XAnyShape[]
}

type ExportImageItem = {
  taskId: string
  subset: string
  filePath: string
  fileName: string
  relativeWithinTask: string
  relativeWithinSubset: string
  subsetName: string
}

type ExportWorkerTraceEvent = {
  ts: string
  jobId: string
  format: ExportFormat
  stage: string
  imagePath?: string
  shapeIndex?: number
  label?: string
  classId?: number
  detail?: string
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"])
const exportJobs = new Map<string, ExportJobRecord>()
const activeExportChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()
const exportProgressThrottle = new Map<string, number>()
const MAX_IMAGE_DIMENSION = 65535
const MAX_YOLO_SEGMENT_POINTS = 120
const EXPORT_LOG_SEPARATOR = "\n---EXPORT_LOG---\n"
const MAX_EXPORT_LOG_LINES = 80
const EXPORT_PROGRESS_MIN_INTERVAL_MS = 800
const MAX_ANNOTATION_JSON_BYTES = 8 * 1024 * 1024
const MAX_SHAPES_PER_IMAGE = 800

type ExportSink = {
  writeImageFile(relPath: string, srcPath: string): Promise<void>
  writeTextFile(relPath: string, content: string): Promise<void>
  finalize(): Promise<void>
}

function writeExportStage(jobId: string, stage: string): void {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), `easyannotate-export-${jobId}.stage.log`), `${new Date().toISOString()} ${stage}\n`, "utf8")
  } catch {
    /* ignore */
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function exportRequestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-export-req-${jobId}.json`)
}

function exportStatePath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-export-state-${jobId}.json`)
}

function isExportChildProcess(): boolean {
  return process.env.EA_EXPORT_CHILD === "1" && Boolean(process.env.EA_EXPORT_JOB_ID?.trim())
}

function writeExportStateFile(jobId: string, job: ExportJobRecord): void {
  try {
    fs.writeFileSync(exportStatePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function readExportStateFile(jobId: string): ExportJobRecord | null {
  try {
    const raw = fs.readFileSync(exportStatePath(jobId), "utf8")
    const parsed = JSON.parse(raw) as ExportJobRecord
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function syncExportJobFromStateFile(jobId: string): void {
  const state = readExportStateFile(jobId)
  if (!state) return
  exportJobs.set(jobId, state)
}

async function copyImageFile(srcPath: string, targetPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  try {
    await fs.promises.copyFile(srcPath, targetPath)
    return
  } catch {
    await pipeline(createReadStream(srcPath), createWriteStream(targetPath))
  }
}

function createFolderExportSink(rootDir: string): ExportSink {
  return {
    async writeImageFile(relPath, srcPath) {
      const target = path.join(rootDir, relPath)
      await copyImageFile(srcPath, target)
    },
    async writeTextFile(relPath, content) {
      const target = path.join(rootDir, relPath)
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.writeFile(target, content, "utf8")
    },
    async finalize() {
      /* no-op */
    },
  }
}

function isYoloExportFormat(format: ExportFormat): boolean {
  return format === "yolo-detect" || format === "yolo-obb" || format === "yolo-segment" || format === "yolo-pose"
}

function isStreamingExportFormat(format: ExportFormat): boolean {
  return isYoloExportFormat(format) || format === "xanylabeling"
}

function appendTraceLine(filePath: string, event: ExportWorkerTraceEvent): void {
  try {
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8")
  } catch {
    // never break export for trace logging
  }
}

function normalizeImageDimension(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(MAX_IMAGE_DIMENSION, n)
}

function sanitizeSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

function buildUniqueTaskFolderMap(taskIds: string[], taskNameById: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const taskId of taskIds) {
    const preferred = taskNameById[taskId]?.trim() || taskId
    const base = sanitizeSegment(preferred)
    let candidate = base
    let index = 1
    while (used.has(candidate)) {
      index += 1
      candidate = `${base}_${String(index).padStart(3, "0")}`
    }
    used.add(candidate)
    out.set(taskId, candidate)
  }
  return out
}

function buildUniqueTaskFolderById(
  allItems: ExportImageItem[],
  taskNameById: Record<string, string>,
): Map<string, string> {
  return buildUniqueTaskFolderMap([...new Set(allItems.map((item) => item.taskId))], taskNameById)
}

function sanitizeExportZipBaseName(versionName: string): string {
  const trimmed = versionName.trim()
  if (!trimmed) return "export"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\.+$/g, "")
}

export function buildUniqueZipPath(parentDir: string, baseName: string): string {
  const safeBase = sanitizeExportZipBaseName(baseName)
  let candidate = path.join(parentDir, `${safeBase}.zip`)
  let index = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${safeBase}_${String(index).padStart(3, "0")}.zip`)
    index += 1
  }
  return candidate
}

export function buildUniqueExportFolderPath(parentDir: string, baseName: string): string {
  const safeBase = sanitizeExportZipBaseName(baseName)
  let candidate = path.join(parentDir, safeBase)
  let index = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${safeBase}_${String(index).padStart(3, "0")}`)
    index += 1
  }
  return candidate
}

type StagingStats = { fileCount: number; totalBytes: number }

function measureStagingDirStats(rootDir: string): StagingStats {
  let fileCount = 0
  let totalBytes = 0
  const stack = [rootDir]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(absPath)
      } else if (ent.isFile()) {
        fileCount += 1
        try {
          totalBytes += fs.statSync(absPath).size
        } catch {
          /* ignore unreadable files */
        }
      }
    }
  }
  return { fileCount, totalBytes }
}

/** Windows 10+ 自带 tar.exe；其他平台使用 PATH 中的 tar。 */
function resolveSystemTarExecutable(): string {
  if (process.platform === "win32") {
    const tarExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    if (fs.existsSync(tarExe)) return tarExe
  }
  return "tar"
}

/**
 * 使用系统 tar 将目录打包为 ZIP（子进程，`-C sourceDir .` 避免扫错目录）。
 * 进度根据 ZIP 体积与源目录总大小估算；若 tar 结束前 ZIP 尚未落盘则按耗时平滑推进。
 */
async function zipDirectoryToFile(
  sourceDir: string,
  zipFilePath: string,
  onProgress?: (percent: number, message: string) => void,
): Promise<void> {
  const absSource = path.resolve(sourceDir)
  if (!fs.existsSync(absSource)) {
    throw new Error(`ZIP 压缩失败：临时导出目录不存在（${absSource}）`)
  }

  const { fileCount, totalBytes } = measureStagingDirStats(absSource)
  if (fileCount === 0) {
    throw new Error("ZIP 压缩失败：没有可打包的文件")
  }

  ensureDir(path.dirname(zipFilePath))
  const absZip = path.resolve(zipFilePath)
  if (fs.existsSync(absZip)) fs.unlinkSync(absZip)

  onProgress?.(0, `正在压缩 ZIP…（共 ${fileCount} 个文件）`)

  const tarExe = resolveSystemTarExecutable()
  const startedAt = Date.now()
  let lastPct = 0

  await new Promise<void>((resolve, reject) => {
    const child = spawn(tarExe, ["-a", "-c", "-f", absZip, "-C", absSource, "."], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    })

    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const pollTimer = setInterval(() => {
      let pct = lastPct
      if (fs.existsSync(absZip) && totalBytes > 0) {
        try {
          const zipSize = fs.statSync(absZip).size
          pct = Math.min(95, Math.round((zipSize / totalBytes) * 100))
        } catch {
          /* ignore */
        }
      } else {
        const elapsedSec = (Date.now() - startedAt) / 1000
        pct = Math.min(90, Math.floor(elapsedSec * 2))
      }
      if (pct > lastPct) {
        lastPct = pct
        onProgress?.(pct, `正在压缩 ZIP… ${pct}%`)
      }
    }, 400)

    child.on("error", (error) => {
      clearInterval(pollTimer)
      reject(error)
    })
    child.on("close", (code) => {
      clearInterval(pollTimer)
      if (code === 0) {
        onProgress?.(100, "压缩完成")
        resolve()
        return
      }
      const detail = stderr.trim()
      reject(new Error(detail ? `ZIP 压缩失败：${detail}` : `ZIP 压缩失败（退出码 ${code ?? "unknown"}）`))
    })
  })

  if (!fs.existsSync(absZip)) {
    throw new Error("ZIP 压缩失败：未生成输出文件")
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function resolveProjectDataRoot(project: ProjectRecord): string {
  const baseRoot = project.storageType === "local" && project.localPath ? project.localPath : path.dirname(project.configFilePath)
  return path.join(baseRoot, "data", "tasks")
}

function resolveAnnotationJsonPath(imagePath: string): string {
  const parsed = path.parse(imagePath)
  return path.join(parsed.dir, `${parsed.name}.json`)
}

function composeJobMessage(statusMessage: string, logLines: string[]): string {
  if (logLines.length <= 0) return statusMessage
  return `${statusMessage}${EXPORT_LOG_SEPARATOR}${logLines.join("\n")}`
}

function updateJob(jobId: string, patch: Partial<ExportJobRecord>): void {
  const current = exportJobs.get(jobId)
  if (!current) return

  const terminal = patch.status === "success" || patch.status === "failed"
  const progressOnly =
    typeof patch.progress === "number" &&
    patch.status === undefined &&
    typeof patch.message !== "string" &&
    typeof patch.statusMessage !== "string"
  if (progressOnly && !terminal) {
    const now = Date.now()
    const last = exportProgressThrottle.get(jobId) ?? 0
    if (now - last < EXPORT_PROGRESS_MIN_INTERVAL_MS) return
    exportProgressThrottle.set(jobId, now)
  }

  const nextStatusMessage =
    typeof patch.statusMessage === "string"
      ? patch.statusMessage
      : typeof patch.message === "string"
        ? patch.message
        : (current.statusMessage || current.message || "")
  const nextLogLines = Array.isArray(patch.logLines) ? patch.logLines : Array.isArray(current.logLines) ? current.logLines : []
  const next: ExportJobRecord = {
    ...current,
    ...patch,
    statusMessage: nextStatusMessage,
    logLines: nextLogLines,
    message: composeJobMessage(nextStatusMessage, nextLogLines),
    updatedAt: nowIso(),
  }
  exportJobs.set(jobId, next)

  if (isExportChildProcess() && process.env.EA_EXPORT_JOB_ID === jobId) {
    writeExportStateFile(jobId, next)
  }
}

function appendJobLog(jobId: string, line: string): void {
  const current = exportJobs.get(jobId)
  if (!current) return
  const text = line.trim()
  if (!text) return
  const baseLines = Array.isArray(current.logLines) ? current.logLines : []
  if (baseLines.length > 0 && baseLines[baseLines.length - 1] === text) return
  const merged = [...baseLines, text]
  const logLines = merged.length > MAX_EXPORT_LOG_LINES ? merged.slice(merged.length - MAX_EXPORT_LOG_LINES) : merged
  updateJob(jobId, {
    logLines,
    statusMessage: current.statusMessage || current.message || "",
  })
}

function safeReadAnnotationDoc(imagePath: string): XAnyDoc {
  const jsonPath = resolveAnnotationJsonPath(imagePath)
  if (!fs.existsSync(jsonPath)) return {}
  try {
    const raw = fs.readFileSync(jsonPath, "utf8")
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw) as XAnyDoc
    if (!parsed || typeof parsed !== "object") return {}
    const imageWidth = normalizeImageDimension(parsed.imageWidth, 1)
    const imageHeight = normalizeImageDimension(parsed.imageHeight, 1)
    return normalizeXAnyLabelDoc({
      imagePath,
      imageWidth,
      imageHeight,
      rawJsonText: raw,
    }) as XAnyDoc
  } catch {
    return {}
  }
}

function readTaskImages(taskRootDir: string, taskId: string): ExportImageItem[] {
  if (!fs.existsSync(taskRootDir)) return []
  const items: ExportImageItem[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absPath)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      const relative = path.relative(taskRootDir, absPath)
      const segments = relative.split(path.sep).filter(Boolean)
      items.push({
        taskId,
        subset: segments.length > 1 ? segments[0] : "default",
        filePath: absPath,
        fileName: path.basename(absPath),
        relativeWithinTask: relative,
        relativeWithinSubset: segments.length > 1 ? segments.slice(1).join(path.sep) : segments[0] ?? path.basename(absPath),
        subsetName: segments.length > 1 ? segments[0] : "default",
      })
    }
  }
  walk(taskRootDir)
  return items
}

function collectExportImages(project: ProjectRecord, taskId?: string, knownTaskIds?: Set<string>): ExportImageItem[] {
  const tasksRoot = resolveProjectDataRoot(project)
  if (!fs.existsSync(tasksRoot)) return []
  if (taskId) {
    const taskRoot = path.join(tasksRoot, sanitizeSegment(taskId))
    return readTaskImages(taskRoot, taskId)
  }
  const entries = fs.readdirSync(tasksRoot, { withFileTypes: true }).filter((item) => item.isDirectory())
  const items: ExportImageItem[] = []
  const hasKnownTaskFilter = Boolean(knownTaskIds && knownTaskIds.size > 0)
  for (const entry of entries) {
    // Project-level export should follow the current task registry.
    // This skips orphan task directories left by historical inconsistencies.
    if (hasKnownTaskFilter && !knownTaskIds!.has(entry.name)) continue
    items.push(...readTaskImages(path.join(tasksRoot, entry.name), entry.name))
  }
  return items
}

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function resolveExportTaskIds(req: ExportRequest): string[] {
  if (req.taskId) return [req.taskId]
  return Object.keys(req.taskNameById).filter((id) => id.trim().length > 0)
}

function pickSplitByProbabilitySeeded(
  filePath: string,
  jobId: string,
  trainBoundary: number,
  valBoundary: number,
): "train" | "val" | "test" {
  const bucket = hashString(`${jobId}:${filePath}`) % 10_000
  const r = bucket / 100
  if (r < trainBoundary) return "train"
  if (r < valBoundary) return "val"
  return "test"
}

function prepareYoloExportItem(
  item: ExportImageItem,
  options: {
    keepProjectStructure: boolean
    isProjectExport: boolean
    taskFolderById?: Map<string, string>
    jobId: string
    trainBoundary: number
    valBoundary: number
  },
): ExportImageItem {
  if (options.keepProjectStructure && options.isProjectExport) {
    return {
      ...item,
      subset: options.taskFolderById?.get(item.taskId) ?? sanitizeSegment(item.taskId),
      relativeWithinSubset: item.relativeWithinTask,
    }
  }
  return {
    ...item,
    subset: pickSplitByProbabilitySeeded(item.filePath, options.jobId, options.trainBoundary, options.valBoundary),
  }
}

async function* iterateTaskImagesAsync(taskRootDir: string, taskId: string): AsyncGenerator<ExportImageItem> {
  if (!fs.existsSync(taskRootDir)) return
  const stack = [taskRootDir]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(absPath)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      const relative = path.relative(taskRootDir, absPath)
      const segments = relative.split(path.sep).filter(Boolean)
      yield {
        taskId,
        subset: segments.length > 1 ? segments[0] : "default",
        filePath: absPath,
        fileName: path.basename(absPath),
        relativeWithinTask: relative,
        relativeWithinSubset: segments.length > 1 ? segments.slice(1).join(path.sep) : segments[0] ?? path.basename(absPath),
        subsetName: segments.length > 1 ? segments[0] : "default",
      }
    }
    await yieldToEventLoop()
  }
}

async function readAnnotationLite(imagePath: string): Promise<XAnyDoc> {
  const jsonPath = resolveAnnotationJsonPath(imagePath)
  try {
    const stat = await fs.promises.stat(jsonPath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ANNOTATION_JSON_BYTES) return {}
    const raw = await fs.promises.readFile(jsonPath, "utf8")
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw) as XAnyDoc
    if (!parsed || typeof parsed !== "object") return {}
    const shapes = Array.isArray(parsed.shapes) ? parsed.shapes.slice(0, MAX_SHAPES_PER_IMAGE) : []
    return {
      imageWidth: normalizeImageDimension(parsed.imageWidth, 1),
      imageHeight: normalizeImageDimension(parsed.imageHeight, 1),
      shapes,
    }
  } catch {
    return {}
  }
}

function classNamesFromProjectTags(project: ProjectRecord): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of project.tags) {
    const name = (tag.name || "").trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function splitByRatio(items: ExportImageItem[], trainBoundary: number, valBoundary: number): Map<string, ExportImageItem[]> {
  const ordered = [...items].sort((a, b) => {
    const ha = hashString(`${a.taskId}:${a.filePath}`)
    const hb = hashString(`${b.taskId}:${b.filePath}`)
    if (ha !== hb) return ha - hb
    return a.filePath.localeCompare(b.filePath)
  })
  const total = ordered.length
  const trainCount = Math.max(0, Math.min(total, Math.floor((total * trainBoundary) / 100)))
  const valUntil = Math.max(trainCount, Math.min(total, Math.floor((total * valBoundary) / 100)))
  return new Map<string, ExportImageItem[]>([
    ["train", ordered.slice(0, trainCount)],
    ["val", ordered.slice(trainCount, valUntil)],
    ["test", ordered.slice(valUntil)],
  ])
}

function shapePoints(shape: XAnyShape): number[][] {
  if (!Array.isArray(shape.points)) return []
  return shape.points.filter((pt): pt is number[] => Array.isArray(pt) && pt.length >= 2).map((pt) => [Number(pt[0]), Number(pt[1])])
}

function bboxFromPoints(points: number[][]): { x: number; y: number; w: number; h: number } | undefined {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let hasPoint = false
  for (const pt of points) {
    const x = Number(pt[0])
    const y = Number(pt[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    hasPoint = true
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!hasPoint) return undefined
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) }
}

function decimatePoints(points: number[][], maxPoints: number): number[][] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const out: number[][] = []
  for (let i = 0; i < points.length; i += step) {
    const p = points[i]
    if (p) out.push(p)
  }
  return out.length >= 3 ? out : points.slice(0, maxPoints)
}

function bboxFromShape(
  shape: XAnyShape,
  _imageWidth: number,
  _imageHeight: number,
): { x: number; y: number; w: number; h: number } | undefined {
  const points = shapePoints(shape)
  if (points.length === 0) return undefined
  if (shape.shape_type === "circle" && points.length >= 2) {
    const dx = points[1][0] - points[0][0]
    const dy = points[1][1] - points[0][1]
    const r = Math.sqrt(dx * dx + dy * dy)
    return { x: points[0][0] - r, y: points[0][1] - r, w: r * 2, h: r * 2 }
  }
  return bboxFromPoints(points)
}

function polygonArea(points: number[][]): number {
  if (points.length < 3) return 0
  let area2 = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    area2 += Number(a[0] ?? 0) * Number(b[1] ?? 0) - Number(b[0] ?? 0) * Number(a[1] ?? 0)
  }
  return Math.max(0, Math.abs(area2) * 0.5)
}

function bboxToPolygonPoints(bbox: { x: number; y: number; w: number; h: number }): number[][] {
  return [
    [bbox.x, bbox.y],
    [bbox.x + bbox.w, bbox.y],
    [bbox.x + bbox.w, bbox.y + bbox.h],
    [bbox.x, bbox.y + bbox.h],
  ]
}

function normalizePolygonForCoco(points: number[][]): number[][] | null {
  const valid = points
    .map((pt) => [Number(pt[0]), Number(pt[1])])
    .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
  if (valid.length < 3) return null
  return valid
}

async function cocoSegmentationFromShape(
  shape: XAnyShape,
  _imageWidth: number,
  _imageHeight: number,
  bbox: { x: number; y: number; w: number; h: number },
): Promise<{ segmentation: number[][]; area: number }> {
  let poly: number[][] | null = normalizePolygonForCoco(shapePoints(shape))
  if (!poly) poly = bboxToPolygonPoints(bbox)
  const flat = poly.flatMap((pt) => [pt[0], pt[1]])
  const segmentation = flat.length >= 6 ? [flat] : []
  const polyArea = polygonArea(poly)
  const area = polyArea > 0 ? polyArea : Math.max(0, bbox.w * bbox.h)
  return { segmentation, area }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function shouldExportAsYoloDetect(shape: XAnyShape): boolean {
  const type = (shape.shape_type || "").trim()
  return (
    type === "rectangle" ||
    type === "rotation" ||
    type === "polygon" ||
    type === "cuboid2d" ||
    // 兼容历史/外部 3D 框命名：统一按点集外接水平框导出为 YOLO Detect。
    type === "box3d" ||
    type === "3dbox" ||
    type === "cuboid"
  )
}

function toYoloDetectLine(shape: XAnyShape, classId: number, width: number, height: number): string | undefined {
  if (!shouldExportAsYoloDetect(shape)) return undefined
  const bbox = bboxFromShape(shape, width, height)
  if (!bbox) return undefined
  const x = clamp01((bbox.x + bbox.w / 2) / width)
  const y = clamp01((bbox.y + bbox.h / 2) / height)
  const w = clamp01(bbox.w / width)
  const h = clamp01(bbox.h / height)
  return `${classId} ${x.toFixed(6)} ${y.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`
}

/** YOLO OBB：水平框与旋转框。 */
function shouldExportAsYoloObb(shape: XAnyShape): boolean {
  const type = (shape.shape_type || "").trim()
  return (
    type === "rectangle" ||
    type === "rotation" ||
    type === "polygon" ||
    type === "cuboid2d" ||
    type === "box3d" ||
    type === "3dbox" ||
    type === "cuboid"
  )
}

function toYoloObbLine(shape: XAnyShape, classId: number, width: number, height: number): string | undefined {
  if (!shouldExportAsYoloObb(shape)) return undefined
  const type = (shape.shape_type || "").trim()
  if (type === "rotation") {
    const points = shapePoints(shape)
    const used = points.length >= 4 ? points.slice(0, 4) : undefined
    const bbox = bboxFromShape(shape, width, height)
    if (!used && !bbox) return undefined
    const corners = used ?? [
      [bbox!.x, bbox!.y],
      [bbox!.x + bbox!.w, bbox!.y],
      [bbox!.x + bbox!.w, bbox!.y + bbox!.h],
      [bbox!.x, bbox!.y + bbox!.h],
    ]
    const coords = corners
      .flatMap((pt) => [clamp01(pt[0] / width).toFixed(6), clamp01(pt[1] / height).toFixed(6)])
      .join(" ")
    return `${classId} ${coords}`
  }
  // rectangle / polygon / 3dbox：统一按水平外接框导出 OBB 四点。
  const bbox = bboxFromShape(shape, width, height)
  if (!bbox) return undefined
  const corners = [
    [bbox!.x, bbox!.y],
    [bbox!.x + bbox!.w, bbox!.y],
    [bbox!.x + bbox!.w, bbox!.y + bbox!.h],
    [bbox!.x, bbox!.y + bbox!.h],
  ]
  const coords = corners
    .flatMap((pt) => [clamp01(pt[0] / width).toFixed(6), clamp01(pt[1] / height).toFixed(6)])
    .join(" ")
  return `${classId} ${coords}`
}

function shouldExportAsYoloSegment(shape: XAnyShape): boolean {
  const type = (shape.shape_type || "").trim()
  return type === "rectangle" || type === "rotation" || type === "polygon"
}

async function toYoloSegmentLine(
  shape: XAnyShape,
  classId: number,
  width: number,
  height: number,
): Promise<string | undefined> {
  if (!shouldExportAsYoloSegment(shape)) return undefined
  const points = shapePoints(shape)
  const safePoints = decimatePoints(points, MAX_YOLO_SEGMENT_POINTS)
  const poly = safePoints.length >= 3 ? safePoints : undefined
  const bbox = bboxFromShape(shape, width, height)
  if (!poly && !bbox) return undefined
  const output = poly ?? [
    [bbox!.x, bbox!.y],
    [bbox!.x + bbox!.w, bbox!.y],
    [bbox!.x + bbox!.w, bbox!.y + bbox!.h],
    [bbox!.x, bbox!.y + bbox!.h],
  ]
  const coords = output
    .flatMap((pt) => [clamp01(pt[0] / width).toFixed(6), clamp01(pt[1] / height).toFixed(6)])
    .join(" ")
  return `${classId} ${coords}`
}

/** YOLO Pose：仅导出骨架姿态（与检测框/分割等区分） */
function shouldExportAsYoloPose(shape: XAnyShape): boolean {
  const type = (shape.shape_type || "").trim()
  return type === "skeleton"
}

/** 与 Ultralytics YOLO Pose 对齐：每行固定 maxKpts 组 x y v；v 为 0/1/2 */
type YoloPoseLayout = {
  maxKpts: number
  /** 骨架类名 -> 模板关节数；无则回退为标注中的点数（受 maxKpts 截断） */
  kptCountByLabel: Map<string, number>
  /** 与 names 下标一致，每类一行关键点名称（长度 maxKpts） */
  kptNamesByClassIndex: string[][]
}

function buildYoloPoseLayoutFromProject(project: ProjectRecord, classNames: string[]): YoloPoseLayout {
  const kptCountByLabel = new Map<string, number>()
  let tagMax = 0
  for (const tag of project.tags) {
    const name = tag.name.trim()
    if (!name) continue
    if (tag.kind === "skeleton" && tag.skeletonTemplate?.points?.length) {
      const count = tag.skeletonTemplate.points.length
      kptCountByLabel.set(name, count)
      tagMax = Math.max(tagMax, count)
    }
  }
  const maxKpts = Math.max(1, tagMax)

  const kptNamesByClassIndex = classNames.map((className) => {
    const tag = project.tags.find((t) => t.name.trim() === className && t.kind === "skeleton")
    const pts = tag?.skeletonTemplate?.points
    if (pts?.length) {
      const labels = pts.map((p, i) => (p.label || p.id || `kp_${i}`).trim() || `kp_${i}`)
      const out = labels.slice(0, maxKpts)
      while (out.length < maxKpts) out.push(`kp_${out.length}`)
      return out
    }
    return Array.from({ length: maxKpts }, (_, i) => `kp_${i}`)
  })

  return { maxKpts, kptCountByLabel, kptNamesByClassIndex }
}

function bboxFromPixelPoints(points: number[][]): { x: number; y: number; w: number; h: number } | undefined {
  const finite = points.filter((pt) => pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
  if (finite.length === 0) return undefined
  const xs = finite.map((pt) => pt[0])
  const ys = finite.map((pt) => pt[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const w = Math.max(0, maxX - minX)
  const h = Math.max(0, maxY - minY)
  return { x: minX, y: minY, w, h: h }
}

function toYoloPoseLine(
  shape: XAnyShape,
  classId: number,
  width: number,
  height: number,
  layout: YoloPoseLayout,
): string | undefined {
  if (!shouldExportAsYoloPose(shape)) return undefined
  const raw = shapePoints(shape)
  if (raw.length === 0) return undefined

  const label = typeof shape.label === "string" ? shape.label.trim() : ""
  const templateK = label ? layout.kptCountByLabel.get(label) : undefined
  const effectiveK = Math.min(layout.maxKpts, templateK ?? raw.length)

  const usedForBbox = raw.slice(0, Math.max(0, effectiveK))
  const bboxPx = bboxFromPixelPoints(usedForBbox)
  if (!bboxPx) return undefined
  let { x, y, w, h } = bboxPx
  if (w <= 0 || h <= 0) {
    const pad = 1
    x -= pad
    y -= pad
    w = pad * 2
    h = pad * 2
  }

  const triples: string[] = []
  for (let i = 0; i < layout.maxKpts; i += 1) {
    if (i < effectiveK && i < raw.length) {
      const px = raw[i][0]
      const py = raw[i][1]
      if (Number.isFinite(px) && Number.isFinite(py)) {
        triples.push(clamp01(px / width).toFixed(6), clamp01(py / height).toFixed(6), "2")
      } else {
        triples.push("0.000000", "0.000000", "0")
      }
    } else {
      triples.push("0.000000", "0.000000", "0")
    }
  }

  const bboxPart = `${clamp01((x + w / 2) / width).toFixed(6)} ${clamp01((y + h / 2) / height).toFixed(6)} ${clamp01(w / width).toFixed(6)} ${clamp01(h / height).toFixed(6)}`
  return `${classId} ${bboxPart} ${triples.join(" ")}`.trim()
}

function escapeXml(input: string): string {
  return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

function writeVocXml(targetPath: string, imageName: string, imageWidth: number, imageHeight: number, objects: Array<{ label: string; bbox: { x: number; y: number; w: number; h: number } }>): void {
  const objectXml = objects
    .map((obj) => {
      const xmin = Math.max(0, Math.round(obj.bbox.x))
      const ymin = Math.max(0, Math.round(obj.bbox.y))
      const xmax = Math.max(xmin, Math.round(obj.bbox.x + obj.bbox.w))
      const ymax = Math.max(ymin, Math.round(obj.bbox.y + obj.bbox.h))
      return [
        "  <object>",
        `    <name>${escapeXml(obj.label)}</name>`,
        "    <pose>Unspecified</pose>",
        "    <truncated>0</truncated>",
        "    <difficult>0</difficult>",
        "    <bndbox>",
        `      <xmin>${xmin}</xmin>`,
        `      <ymin>${ymin}</ymin>`,
        `      <xmax>${xmax}</xmax>`,
        `      <ymax>${ymax}</ymax>`,
        "    </bndbox>",
        "  </object>",
      ].join("\n")
    })
    .join("\n")
  const xml = [
    "<annotation>",
    `  <filename>${escapeXml(imageName)}</filename>`,
    "  <size>",
    `    <width>${Math.max(1, Math.round(imageWidth))}</width>`,
    `    <height>${Math.max(1, Math.round(imageHeight))}</height>`,
    "    <depth>3</depth>",
    "  </size>",
    objectXml,
    "</annotation>",
    "",
  ].join("\n")
  fs.writeFileSync(targetPath, xml, "utf8")
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

function removeExt(relPath: string): string {
  const parsed = path.parse(relPath)
  return path.join(parsed.dir, parsed.name)
}

function copyImage(imagePath: string, targetPath: string): string {
  ensureDir(path.dirname(targetPath))
  fs.copyFileSync(imagePath, targetPath)
  return targetPath
}

function createJobRecord(req: ExportRequest): ExportJobRecord {
  const now = nowIso()
  return {
    id: randomUUID(),
    projectId: req.projectId,
    taskId: req.taskId ?? "",
    versionName: req.versionName,
    exportFormat: req.exportFormat,
    keepProjectStructure: req.keepProjectStructure,
    outputDir: req.outputPath,
    status: "queued",
    progress: 0,
    message: "等待开始",
    statusMessage: "等待开始",
    logLines: [],
    createdAt: now,
    updatedAt: now,
  }
}

function renderYoloDataYaml(classNames: string[], splitNames: string[], options?: { obb?: boolean }): string {
  const existingSplits = splitNames.length > 0 ? splitNames : ["train"]
  const yamlLines: string[] = []
  if (options?.obb) {
    yamlLines.push(
      "# Ultralytics YOLO OBB — https://docs.ultralytics.com/datasets/obb/",
      "# labels/*.txt 每行: class_index x1 y1 x2 y2 x3 y3 x4 y4（相对图像宽高归一化到约 0–1）",
      "# 训练请使用 OBB 权重，例如: yolo obb train data=.../data.yaml model=yolov8n-obb.pt",
      "",
    )
  }
  yamlLines.push("path: .")
  for (const split of existingSplits) {
    yamlLines.push(`${split}: images/${split}`)
  }
  yamlLines.push("names:")
  classNames.forEach((name, index) => {
    yamlLines.push(`  ${index}: "${name.replaceAll('"', '\\"')}"`)
  })
  return `${yamlLines.join("\n")}\n`
}

/** Ultralytics YOLO Pose 数据集 YAML：https://docs.ultralytics.com/datasets/pose/ */
function renderYoloDataYamlPose(classNames: string[], splitNames: string[], layout: YoloPoseLayout): string {
  const existingSplits = splitNames.length > 0 ? splitNames : ["train"]
  const lines: string[] = [
    "# Ultralytics YOLO Pose — see https://docs.ultralytics.com/datasets/pose/",
    `# kpt_shape [${layout.maxKpts}, 3] = ${layout.maxKpts} keypoints × (x, y, visibility)`,
    "# visibility: 0=not labeled, 1=occluded, 2=visible (exported keypoints use 2 or 0)",
    "# flip_idx below is identity; replace with symmetric pairs for your template if needed.",
    "",
    "path: .",
  ]
  for (const split of existingSplits) {
    lines.push(`${split}: images/${split}`)
  }
  lines.push("")
  lines.push(`kpt_shape: [${layout.maxKpts}, 3]`)
  lines.push(`flip_idx: [${Array.from({ length: layout.maxKpts }, (_, i) => i).join(", ")}]`)
  lines.push("")
  lines.push("names:")
  classNames.forEach((name, index) => {
    lines.push(`  ${index}: "${name.replaceAll('"', '\\"')}"`)
  })
  lines.push("")
  lines.push("kpt_names:")
  layout.kptNamesByClassIndex.forEach((kptNames, ci) => {
    lines.push(`  ${ci}:`)
    for (const kn of kptNames) {
      lines.push(`    - "${kn.replaceAll('"', '\\"')}"`)
    }
  })
  return `${lines.join("\n")}\n`
}

async function exportOneYoloImage(
  format: ExportFormat,
  item: ExportImageItem,
  classByName: Map<string, number>,
  keepProjectStructure: boolean,
  poseLayout: YoloPoseLayout | null,
  sink: ExportSink,
): Promise<void> {
  const relPath = keepProjectStructure ? item.relativeWithinSubset : item.fileName
  const imageRel = keepProjectStructure
    ? path.join(item.subset, "images", relPath)
    : path.join("images", item.subset, relPath)
  const labelRel = keepProjectStructure
    ? path.join(item.subset, "labels", `${removeExt(relPath)}.txt`)
    : path.join("labels", item.subset, `${removeExt(relPath)}.txt`)

  await sink.writeImageFile(imageRel, item.filePath)

  const doc = await readAnnotationLite(item.filePath)
  const width = normalizeImageDimension(doc.imageWidth, 1)
  const height = normalizeImageDimension(doc.imageHeight, 1)
  const labels: string[] = []
  const shapes = doc.shapes ?? []
  for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
    const shape = shapes[shapeIndex]!
    const label = typeof shape.label === "string" ? shape.label.trim() : ""
    if (!label) continue
    const classId = classByName.get(label)
    if (classId === undefined) continue
    const line =
      format === "yolo-detect"
        ? toYoloDetectLine(shape, classId, width, height)
        : format === "yolo-obb"
          ? toYoloObbLine(shape, classId, width, height)
          : format === "yolo-segment"
            ? await toYoloSegmentLine(shape, classId, width, height)
            : format === "yolo-pose" && poseLayout
              ? toYoloPoseLine(shape, classId, width, height, poseLayout)
              : undefined
    if (line) labels.push(line)
    if (shapeIndex > 0 && shapeIndex % 32 === 0) {
      await yieldToEventLoop()
    }
  }
  await sink.writeTextFile(labelRel, `${labels.join("\n")}${labels.length ? "\n" : ""}`)
}

async function exportOneXAnyImage(item: ExportImageItem, sink: ExportSink): Promise<void> {
  const relPath = path.join(item.subset, item.relativeWithinSubset)
  await sink.writeImageFile(relPath, item.filePath)
  const srcJson = resolveAnnotationJsonPath(item.filePath)
  try {
    const stat = await fs.promises.stat(srcJson)
    if (!stat.isFile() || stat.size <= 0) return
  } catch {
    return
  }
  const parsed = path.parse(relPath)
  const jsonRel = path.join(parsed.dir, `${parsed.name}.json`)
  await sink.writeImageFile(jsonRel, srcJson)
}

async function runYoloExport(job: ExportJobRecord, req: ExportRequest): Promise<void> {
  writeExportStage(job.id, "enter runYoloExport")
  updateJob(job.id, { status: "running", progress: 2, message: "正在准备导出任务…" })

  const taskIds = resolveExportTaskIds(req)
  if (taskIds.length === 0) {
    updateJob(job.id, { status: "failed", progress: 100, message: "没有可导出的任务" })
    return
  }
  writeExportStage(job.id, `taskIds=${taskIds.length}`)

  const tasksRoot = resolveProjectDataRoot(req.project)
  const estimatedTotal = Math.max(1, req.estimatedImageCount)

  const classNames = classNamesFromProjectTags(req.project)
  if (classNames.length === 0) {
    updateJob(job.id, { status: "failed", progress: 100, message: "项目未配置类别标签（请在项目设置中添加 tags）" })
    return
  }
  writeExportStage(job.id, `classNames=${classNames.length}`)

  const classByName = new Map<string, number>(classNames.map((name, index) => [name, index]))
  const keepProjectStructure = !req.taskId && req.keepProjectStructure
  const isProjectExport = !req.taskId
  const taskFolderById = keepProjectStructure ? buildUniqueTaskFolderMap(taskIds, req.taskNameById) : undefined
  const compressToZip = req.compressToZip === true

  updateJob(job.id, { progress: 4, message: "正在创建输出目录…" })
  writeExportStage(job.id, "mkdir staging")

  const poseLayout = req.exportFormat === "yolo-pose" ? buildYoloPoseLayoutFromProject(req.project, classNames) : null
  const stagingDir = compressToZip ? path.join(os.tmpdir(), `easyannotate-export-${job.id}`) : req.outputPath
  const sink = createFolderExportSink(stagingDir)
  fs.mkdirSync(stagingDir, { recursive: true })
  writeExportStage(job.id, `stagingDir=${stagingDir}`)

  const splitSet = new Set<string>()
  let done = 0
  const exportProgressCap = compressToZip ? 82 : 99
  const updateProgress = (message: string) => {
    const total = Math.max(estimatedTotal, done)
    const progress = Math.max(5, Math.min(exportProgressCap, Math.floor((done / total) * exportProgressCap)))
    updateJob(job.id, { progress, message })
  }

  try {
    writeExportStage(job.id, "export loop start")
    updateJob(job.id, { progress: 5, message: "开始导出图片…" })
    for (const taskId of taskIds) {
      const taskRoot = path.join(tasksRoot, sanitizeSegment(taskId))
      writeExportStage(job.id, `task start ${taskId}`)
      for await (const rawItem of iterateTaskImagesAsync(taskRoot, taskId)) {
        if (done === 0) writeExportStage(job.id, `first image ${rawItem.filePath}`)
        const item = prepareYoloExportItem(rawItem, {
          keepProjectStructure,
          isProjectExport,
          taskFolderById,
          jobId: job.id,
          trainBoundary: req.trainBoundary,
          valBoundary: req.valBoundary,
        })
        splitSet.add(item.subset)
        const startedAt = Date.now()
        try {
          await exportOneYoloImage(
            req.exportFormat,
            item,
            classByName,
            keepProjectStructure,
            poseLayout,
            sink,
          )
        } catch (error) {
          writeExportStage(
            job.id,
            `image error ${item.filePath} ${error instanceof Error ? error.message : String(error)}`,
          )
          throw error
        }
        done += 1
        updateProgress(`导出 ${item.fileName}`)
        if (done === 1 || done % 10 === 0) {
          appendJobLog(job.id, `${nowIso()} | ${item.fileName} | ${Math.max(0, Date.now() - startedAt)}ms`)
        }
        await yieldToEventLoop()
      }
      writeExportStage(job.id, `task done ${taskId}`)
      await yieldToEventLoop()
    }

    if (done === 0) {
      updateJob(job.id, { status: "failed", progress: 100, message: "没有可导出的图片" })
      return
    }

    if (req.exportFormat === "yolo-pose" && poseLayout) {
      if (!keepProjectStructure) {
        await sink.writeTextFile("data.yaml", renderYoloDataYamlPose(classNames, [...splitSet], poseLayout))
      } else {
        for (const taskName of splitSet) {
          await sink.writeTextFile(path.join(taskName, "data.yaml"), renderYoloDataYamlPose(classNames, [], poseLayout))
        }
      }
    } else if (!keepProjectStructure) {
      await sink.writeTextFile(
        "data.yaml",
        renderYoloDataYaml(classNames, [...splitSet], { obb: req.exportFormat === "yolo-obb" }),
      )
    } else {
      for (const taskName of splitSet) {
        await sink.writeTextFile(
          path.join(taskName, "data.yaml"),
          renderYoloDataYaml(classNames, [], { obb: req.exportFormat === "yolo-obb" }),
        )
      }
    }

    await sink.finalize()

    if (compressToZip) {
      writeExportStage(job.id, "zipDirectoryToFile start")
      updateJob(job.id, { progress: 83, message: "正在压缩 ZIP…" })
      await zipDirectoryToFile(stagingDir, req.outputPath, (zipPercent, message) => {
        const progress = 82 + Math.floor((zipPercent / 100) * 17)
        updateJob(job.id, { progress, message })
      })
      writeExportStage(job.id, "zipDirectoryToFile done")
    }

    updateJob(job.id, {
      status: "success",
      progress: 100,
      message: `导出完成：${req.outputPath}`,
    })
    writeExportStage(job.id, `export_success ${req.outputPath}`)
  } catch (error) {
    writeExportStage(job.id, `error ${error instanceof Error ? error.message : String(error)}`)
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    if (compressToZip) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

async function runXAnyExport(job: ExportJobRecord, req: ExportRequest): Promise<void> {
  writeExportStage(job.id, "enter runXAnyExport")
  updateJob(job.id, { status: "running", progress: 2, message: "正在准备导出任务…" })

  const taskIds = resolveExportTaskIds(req)
  if (taskIds.length === 0) {
    updateJob(job.id, { status: "failed", progress: 100, message: "没有可导出的任务" })
    return
  }
  writeExportStage(job.id, `taskIds=${taskIds.length}`)

  const tasksRoot = resolveProjectDataRoot(req.project)
  const estimatedTotal = Math.max(1, req.estimatedImageCount)
  const keepProjectStructure = !req.taskId && req.keepProjectStructure
  const isProjectExport = !req.taskId
  const taskFolderById = keepProjectStructure ? buildUniqueTaskFolderMap(taskIds, req.taskNameById) : undefined
  const compressToZip = req.compressToZip === true

  updateJob(job.id, { progress: 4, message: "正在创建输出目录…" })
  writeExportStage(job.id, "mkdir staging")

  const stagingDir = compressToZip ? path.join(os.tmpdir(), `easyannotate-export-${job.id}`) : req.outputPath
  const sink = createFolderExportSink(stagingDir)
  fs.mkdirSync(stagingDir, { recursive: true })
  writeExportStage(job.id, `stagingDir=${stagingDir}`)

  let done = 0
  const exportProgressCap = compressToZip ? 82 : 99
  const updateProgress = (message: string) => {
    const total = Math.max(estimatedTotal, done)
    const progress = Math.max(5, Math.min(exportProgressCap, Math.floor((done / total) * exportProgressCap)))
    updateJob(job.id, { progress, message })
  }

  try {
    writeExportStage(job.id, "export loop start")
    updateJob(job.id, { progress: 5, message: "开始导出图片…" })
    for (const taskId of taskIds) {
      const taskRoot = path.join(tasksRoot, sanitizeSegment(taskId))
      writeExportStage(job.id, `task start ${taskId}`)
      for await (const rawItem of iterateTaskImagesAsync(taskRoot, taskId)) {
        if (done === 0) writeExportStage(job.id, `first image ${rawItem.filePath}`)
        const item = prepareYoloExportItem(rawItem, {
          keepProjectStructure,
          isProjectExport,
          taskFolderById,
          jobId: job.id,
          trainBoundary: req.trainBoundary,
          valBoundary: req.valBoundary,
        })
        const startedAt = Date.now()
        await exportOneXAnyImage(item, sink)
        done += 1
        updateProgress(`导出 ${item.fileName}`)
        if (done === 1 || done % 10 === 0) {
          appendJobLog(job.id, `${nowIso()} | ${item.fileName} | ${Math.max(0, Date.now() - startedAt)}ms`)
        }
        await yieldToEventLoop()
      }
      writeExportStage(job.id, `task done ${taskId}`)
      await yieldToEventLoop()
    }

    if (done === 0) {
      updateJob(job.id, { status: "failed", progress: 100, message: "没有可导出的图片" })
      return
    }

    await sink.finalize()

    if (compressToZip) {
      writeExportStage(job.id, "zipDirectoryToFile start")
      updateJob(job.id, { progress: 83, message: "正在压缩 ZIP…" })
      await zipDirectoryToFile(stagingDir, req.outputPath, (zipPercent, message) => {
        const progress = 82 + Math.floor((zipPercent / 100) * 17)
        updateJob(job.id, { progress, message })
      })
      writeExportStage(job.id, "zipDirectoryToFile done")
    }

    updateJob(job.id, {
      status: "success",
      progress: 100,
      message: `导出完成：${req.outputPath}`,
    })
    writeExportStage(job.id, `export_success ${req.outputPath}`)
  } catch (error) {
    writeExportStage(job.id, `error ${error instanceof Error ? error.message : String(error)}`)
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    if (compressToZip) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

function exportAsVoc(
  images: ExportImageItem[],
  outputDir: string,
  keepProjectStructure: boolean,
  updateProgress: (done: number, total: number, message: string) => void,
  logImageDone?: (item: ExportImageItem, elapsedMs: number) => void,
): void {
  const total = images.length
  const splitNames = new Set<string>()
  for (let i = 0; i < images.length; i += 1) {
    const item = images[i]
    const startedAt = Date.now()
    const doc = safeReadAnnotationDoc(item.filePath)
    const width = normalizeImageDimension(doc.imageWidth, 1)
    const height = normalizeImageDimension(doc.imageHeight, 1)
    const objects: Array<{ label: string; bbox: { x: number; y: number; w: number; h: number } }> = []
    for (const shape of doc.shapes ?? []) {
      const label = typeof shape.label === "string" ? shape.label.trim() : ""
      const bbox = bboxFromShape(shape, width, height)
      if (!label || !bbox) continue
      objects.push({ label, bbox })
    }
    const relPath = keepProjectStructure ? item.relativeWithinSubset : item.fileName
    const stem = removeExt(relPath).replaceAll("\\", "/")
    splitNames.add(item.subset)
    const imageTarget = keepProjectStructure
      ? path.join(outputDir, item.subset, "JPEGImages", relPath)
      : path.join(outputDir, "JPEGImages", `${item.subset}__${path.basename(relPath)}`)
    const xmlPath = keepProjectStructure
      ? path.join(outputDir, item.subset, "Annotations", `${removeExt(relPath)}.xml`)
      : path.join(outputDir, "Annotations", `${item.subset}__${path.parse(path.basename(relPath)).name}.xml`)
    copyImage(item.filePath, imageTarget)
    ensureDir(path.dirname(xmlPath))
    writeVocXml(xmlPath, path.basename(relPath), width, height, objects)
    const listFile = keepProjectStructure
      ? path.join(outputDir, item.subset, "ImageSets", "Main", `${item.subset}.txt`)
      : path.join(outputDir, "ImageSets", "Main", `${item.subset}.txt`)
    ensureDir(path.dirname(listFile))
    fs.appendFileSync(listFile, `${keepProjectStructure ? stem : `${item.subset}__${path.parse(path.basename(relPath)).name}`}\n`, "utf8")
    updateProgress(i + 1, total, `导出 ${item.fileName}`)
    logImageDone?.(item, Date.now() - startedAt)
  }
  void splitNames
}

async function exportAsCoco(
  images: ExportImageItem[],
  outputDir: string,
  classNames: string[],
  keepProjectStructure: boolean,
  updateProgress: (done: number, total: number, message: string) => void,
  logImageDone?: (item: ExportImageItem, elapsedMs: number) => void,
): Promise<void> {
  const grouped = new Map<string, ExportImageItem[]>()
  for (const item of images) {
    const list = grouped.get(item.subset) ?? []
    list.push(item)
    grouped.set(item.subset, list)
  }
  const total = images.length
  let done = 0
  for (const [subset, list] of grouped) {
    const imageTarget = keepProjectStructure ? path.join(outputDir, subset, "images") : path.join(outputDir, "images", subset)
    const annoTarget = keepProjectStructure ? path.join(outputDir, subset, "annotations") : path.join(outputDir, "annotations")
    ensureDir(imageTarget)
    ensureDir(annoTarget)
    let imageId = 1
    let annotationId = 1
    const imageRows: Array<{ id: number; file_name: string; width: number; height: number }> = []
    const annotationRows: Array<{ id: number; image_id: number; category_id: number; bbox: number[]; area: number; iscrowd: number; segmentation: number[][] }> = []
    for (const item of list) {
      const startedAt = Date.now()
      const relPath = keepProjectStructure ? item.relativeWithinSubset : item.fileName
      copyImage(item.filePath, path.join(imageTarget, relPath))
      const doc = safeReadAnnotationDoc(item.filePath)
      const width = normalizeImageDimension(doc.imageWidth, 1)
      const height = normalizeImageDimension(doc.imageHeight, 1)
      const currentImageId = imageId
      imageRows.push({
        id: currentImageId,
        file_name: relPath.replace(/\\/g, "/"),
        width,
        height,
      })
      for (const shape of doc.shapes ?? []) {
        const label = typeof shape.label === "string" ? shape.label.trim() : ""
        const categoryId = classNames.indexOf(label) + 1
        const bbox = bboxFromShape(shape, width, height)
        if (!label || categoryId <= 0 || !bbox) continue
        const { segmentation, area } = await cocoSegmentationFromShape(shape, width, height, bbox)
        annotationRows.push({
          id: annotationId,
          image_id: currentImageId,
          category_id: categoryId,
          bbox: [bbox.x, bbox.y, bbox.w, bbox.h],
          area,
          iscrowd: 0,
          segmentation,
        })
        annotationId += 1
      }
      imageId += 1
      done += 1
      updateProgress(done, total, `导出 ${item.fileName}`)
      logImageDone?.(item, Date.now() - startedAt)
    }
    const categories = classNames.map((name, index) => ({
      id: index + 1,
      name,
      supercategory: "default",
    }))
    fs.writeFileSync(
      path.join(annoTarget, keepProjectStructure ? "instances.json" : `instances_${subset}.json`),
      JSON.stringify({ images: imageRows, annotations: annotationRows, categories }, null, 2),
      "utf8",
    )
  }
}

function collectClassNamesForExport(project: ProjectRecord, _images: ExportImageItem[]): string[] {
  return classNamesFromProjectTags(project)
}

async function runExport(job: ExportJobRecord, req: ExportRequest): Promise<void> {
  updateJob(job.id, { status: "running", progress: 1, message: "开始导出" })
  if (isYoloExportFormat(req.exportFormat)) {
    try {
      await runYoloExport(job, req)
    } catch {
      /* runYoloExport already updated job status */
    }
    return
  }
  if (req.exportFormat === "xanylabeling") {
    try {
      await runXAnyExport(job, req)
    } catch {
      /* runXAnyExport already updated job status */
    }
    return
  }

  const knownTaskIds = req.taskId ? undefined : new Set(Object.keys(req.taskNameById))
  const allItems = collectExportImages(req.project, req.taskId, knownTaskIds)
  if (allItems.length === 0) {
    updateJob(job.id, { status: "failed", progress: 100, message: "没有可导出的图片" })
    return
  }
  const groupedItems: ExportImageItem[] = []
  // 保持结构：按任务名导出；重名任务自动追加后缀避免目录冲突。
  if (!req.taskId && req.keepProjectStructure) {
    const taskFolderById = buildUniqueTaskFolderById(allItems, req.taskNameById)
    for (const item of allItems) {
      groupedItems.push({
        ...item,
        // 保持项目结构：按任务名导出；重名任务自动追加后缀避免目录冲突。
        subset: taskFolderById.get(item.taskId) ?? sanitizeSegment(item.taskId),
        relativeWithinSubset: item.relativeWithinTask,
      })
    }
    // 任务导出
  } else if (req.taskId) {
    const splitMap = splitByRatio(allItems, req.trainBoundary, req.valBoundary)
    for (const [splitName, splitItems] of splitMap) {
      for (const item of splitItems) {
        groupedItems.push({
          ...item,
          subset: splitName,
          relativeWithinSubset: `${sanitizeSegment(item.subsetName)}__${item.fileName}`,
        })
      }
    }
    // 项目导出
  } else {
    const splitMap = splitByRatio(allItems, req.trainBoundary, req.valBoundary)
    for (const [splitName, splitItems] of splitMap) {
      for (const item of splitItems) {
        groupedItems.push({
          ...item,
          subset: splitName,
          relativeWithinSubset: `${sanitizeSegment(item.taskId)}__${sanitizeSegment(item.subsetName)}__${item.fileName}`,
        })
      }
    }
  }
  const classNames = collectClassNamesForExport(req.project, groupedItems)
  if (classNames.length === 0) {
    updateJob(job.id, { status: "failed", progress: 100, message: "项目未配置类别标签（请在项目设置中添加 tags）" })
    return
  }
  const compressToZip = req.compressToZip === true
  const traceFilePath = compressToZip
    ? path.join(path.dirname(req.outputPath), `${sanitizeExportZipBaseName(req.versionName)}_${job.id}_export_worker_trace.jsonl`)
    : path.join(req.outputPath, "export_worker_trace.jsonl")
  const trace = (event: Omit<ExportWorkerTraceEvent, "ts" | "jobId" | "format">) => {
    appendTraceLine(traceFilePath, {
      ts: nowIso(),
      jobId: job.id,
      format: req.exportFormat,
      ...event,
    })
  }
  fs.mkdirSync(path.dirname(traceFilePath), { recursive: true })
  trace({ stage: "export_start", detail: `images=${groupedItems.length}` })
  const logImageTiming = (item: ExportImageItem, elapsedMs: number) => {
    appendJobLog(job.id, `${nowIso()} | ${item.fileName} | ${Math.max(0, elapsedMs)}ms`)
  }
  const exportProgressCap = compressToZip ? 82 : 99
  const updateProgress = (done: number, total: number, message: string) => {
    const progress = Math.max(1, Math.min(exportProgressCap, Math.floor((done / Math.max(1, total)) * exportProgressCap)))
    updateJob(job.id, { progress, message })
  }
  const stagingDir = compressToZip ? path.join(os.tmpdir(), `easyannotate-export-${job.id}`) : req.outputPath
  fs.mkdirSync(stagingDir, { recursive: true })
  try {
    if (req.exportFormat === "coco") {
      await exportAsCoco(groupedItems, stagingDir, classNames, !req.taskId && req.keepProjectStructure, updateProgress, logImageTiming)
    } else if (req.exportFormat === "voc") {
      exportAsVoc(groupedItems, stagingDir, !req.taskId && req.keepProjectStructure, updateProgress, logImageTiming)
    }
    if (compressToZip) {
      await zipDirectoryToFile(stagingDir, req.outputPath, (zipPercent, message) => {
        const progress = 82 + Math.floor((zipPercent / 100) * 17)
        updateJob(job.id, { progress, message })
      })
    }
    updateJob(job.id, {
      status: "success",
      progress: 100,
      message: `导出完成：${req.outputPath}`,
    })
    trace({ stage: "export_success", detail: req.outputPath })
  } catch (error) {
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      message: error instanceof Error ? error.message : String(error),
    })
    trace({ stage: "export_failed", detail: error instanceof Error ? error.message : String(error) })
  } finally {
    if (compressToZip) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

export function listDatasetExportJobs(): ExportJobRecord[] {
  return [...exportJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** IPC 用：只返回状态文案，避免把大量日志通过 IPC 传给渲染进程 */
export function listDatasetExportJobsForIpc(): ExportJobRecord[] {
  return listDatasetExportJobs().map((job) => ({
    ...job,
    message: job.statusMessage || job.message.split(EXPORT_LOG_SEPARATOR)[0] || job.message,
  }))
}

function findProjectRoot(): string | null {
  const seeds = new Set<string>([process.cwd()])
  try {
    seeds.add(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    /* ignore */
  }
  for (const seed of seeds) {
    let dir = path.resolve(seed)
    for (let depth = 0; depth < 12; depth += 1) {
      const pkgPath = path.join(dir, "package.json")
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string }
          if (pkg.name === "easy-annotate") return dir
        } catch {
          /* ignore invalid package.json */
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

function resolveSystemNodeExecutable(): string | null {
  const execBase = path.basename(process.execPath).toLowerCase()
  if (execBase === "node.exe" || execBase === "node") {
    return process.execPath
  }

  for (const envCandidate of [process.env.NODE_EXE, process.env.npm_node_execpath]) {
    const trimmed = (envCandidate || "").trim()
    if (trimmed && fs.existsSync(trimmed)) return trimmed
  }

  if (process.platform === "win32") {
    try {
      const output = execFileSync("where.exe", ["node"], { encoding: "utf8", windowsHide: true }).trim()
      const candidate = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (candidate && fs.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
    const programFiles = process.env.ProgramFiles || "C:\\Program Files"
    const winCandidates = [
      path.join(programFiles, "nodejs", "node.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
    ]
    for (const candidate of winCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  } else {
    try {
      const output = execFileSync("which", ["node"], { encoding: "utf8" }).trim()
      if (output && fs.existsSync(output)) return output
    } catch {
      /* ignore */
    }
  }
  return null
}

type ExportChildLaunch = {
  command: string
  args: string[]
  cwd: string
  mode: "bundled"
}

function resolveExportChildLaunch(
  jobId: string,
  reqPath: string,
): { launch: ExportChildLaunch | null; reason: string } {
  const root = findProjectRoot()
  const nodeExe = resolveSystemNodeExecutable()
  if (!nodeExe) {
    return { launch: null, reason: "未找到 Node.js（请安装 Node 并加入 PATH，或安装到 Program Files\\nodejs）" }
  }

  if (!root) {
    return {
      launch: null,
      reason: `未找到项目根目录（当前 cwd=${process.cwd()}）`,
    }
  }

  const bundledScript = path.join(root, "out", "main", "dataset-export-child.js")
  const bundledDir = path.dirname(bundledScript)
  const bundledAssetsDir = path.join(bundledDir, "assets")

  if (!fs.existsSync(bundledScript)) {
    return {
      launch: null,
      reason: `未找到 ${bundledScript}，请在项目根目录执行：npx vite build --mode main`,
    }
  }
  if (!fs.existsSync(bundledAssetsDir)) {
    return {
      launch: null,
      reason: `缺少 ${bundledAssetsDir}，请重新执行：npx vite build --mode main`,
    }
  }

  return {
    launch: {
      command: nodeExe,
      args: [bundledScript, jobId, reqPath],
      cwd: bundledDir,
      mode: "bundled",
    },
    reason: "",
  }
}

function cleanupExportChild(jobId: string): void {
  const active = activeExportChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeExportChildren.delete(jobId)
}

function spawnExportChild(job: ExportJobRecord, req: ExportRequest): boolean {
  const reqPath = exportRequestPath(job.id)
  try {
    fs.writeFileSync(reqPath, JSON.stringify({ job, req }), "utf8")
    writeExportStateFile(job.id, job)
  } catch (error) {
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      statusMessage: error instanceof Error ? error.message : String(error),
    })
    return false
  }

  const resolved = resolveExportChildLaunch(job.id, reqPath)
  if (!resolved.launch) {
    writeExportStage(job.id, `child launch failed: ${resolved.reason}`)
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      statusMessage: `无法启动导出子进程：${resolved.reason}`,
      message: `无法启动导出子进程：${resolved.reason}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    return false
  }
  const launch = resolved.launch

  writeExportStage(job.id, `spawn child mode=${launch.mode} ${launch.command} ${launch.args.join(" ")}`)

  const child = spawn(launch.command, launch.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: launch.cwd,
    env: {
      ...process.env,
      EA_EXPORT_CHILD: "1",
      EA_EXPORT_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) writeExportStage(job.id, `child stderr: ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncExportJobFromStateFile(job.id)
  }, 400)

  activeExportChildren.set(job.id, { child, pollTimer })

  child.on("error", (error) => {
    cleanupExportChild(job.id)
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      statusMessage: `导出子进程错误：${error.message}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
  })

  child.on("close", (code) => {
    cleanupExportChild(job.id)
    syncExportJobFromStateFile(job.id)
    const state = exportJobs.get(job.id)
    if (code !== 0 && state?.status !== "success" && state?.status !== "failed") {
      updateJob(job.id, {
        status: "failed",
        progress: 100,
        statusMessage: `导出子进程异常退出（code=${code ?? "null"}）`,
      })
    }
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    try {
      const finalState = exportJobs.get(job.id)
      if (finalState?.status === "success" || finalState?.status === "failed") {
        fs.unlinkSync(exportStatePath(job.id))
      }
    } catch {
      /* ignore */
    }
  })

  return true
}

export async function runExportFromChildArgv(jobId: string, reqPath: string): Promise<void> {
  process.env.EA_EXPORT_CHILD = "1"
  process.env.EA_EXPORT_JOB_ID = jobId

  const raw = await fs.promises.readFile(reqPath, "utf8")
  const payload = JSON.parse(raw) as { job: ExportJobRecord; req: ExportRequest }
  if (!payload?.job || !payload?.req) {
    throw new Error("Invalid export request payload")
  }

  exportJobs.set(jobId, payload.job)
  writeExportStateFile(jobId, payload.job)

  await runExport(payload.job, payload.req)
}

export function startDatasetExportJob(req: ExportRequest): { jobId: string } {
  const job = createJobRecord(req)
  exportJobs.set(job.id, job)

  if (isStreamingExportFormat(req.exportFormat)) {
    const spawned = spawnExportChild(job, req)
    if (spawned) {
      return { jobId: job.id }
    }
    return { jobId: job.id }
  }

  setImmediate(() => {
    void runExport(job, req).catch((error) => {
      updateJob(job.id, {
        status: "failed",
        progress: 100,
        statusMessage: error instanceof Error ? error.message : String(error),
      })
    })
  })
  return { jobId: job.id }
}

import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { normalizeXAnyLabelDoc } from "../renderer/lib/xanylabeling-format"
import type { ProjectRecord } from "./project-storage"

type ExportFormat = "coco" | "voc" | "yolo-detect" | "yolo-obb" | "yolo-segment" | "yolo-pose" | "xanylabeling"
type ExportStatus = "queued" | "running" | "success" | "failed"

type ExportJobRecord = {
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

type ExportRequest = {
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
const MAX_IMAGE_DIMENSION = 65535
const MAX_YOLO_SEGMENT_POINTS = 120
const EXPORT_LOG_SEPARATOR = "\n---EXPORT_LOG---\n"
const MAX_EXPORT_LOG_LINES = 600

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

function buildUniqueTaskFolderById(
  allItems: ExportImageItem[],
  taskNameById: Record<string, string>,
): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  const taskIds = [...new Set(allItems.map((item) => item.taskId))]
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
  const nextStatusMessage =
    typeof patch.statusMessage === "string"
      ? patch.statusMessage
      : typeof patch.message === "string"
        ? patch.message
        : (current.statusMessage || current.message || "")
  const nextLogLines = Array.isArray(patch.logLines) ? patch.logLines : Array.isArray(current.logLines) ? current.logLines : []
  exportJobs.set(jobId, {
    ...current,
    ...patch,
    statusMessage: nextStatusMessage,
    logLines: nextLogLines,
    message: composeJobMessage(nextStatusMessage, nextLogLines),
    updatedAt: nowIso(),
  })
}

function appendJobLog(jobId: string, line: string): void {
  const current = exportJobs.get(jobId)
  if (!current) return
  const text = line.trim()
  if (!text) return
  const baseLines = Array.isArray(current.logLines) ? current.logLines : []
  const merged = [...baseLines, text]
  const logLines = merged.length > MAX_EXPORT_LOG_LINES ? merged.slice(merged.length - MAX_EXPORT_LOG_LINES) : merged
  exportJobs.set(jobId, {
    ...current,
    logLines,
    message: composeJobMessage(current.statusMessage || current.message || "", logLines),
    updatedAt: nowIso(),
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
  trace?: (stage: string, detail?: string) => void,
): Promise<string | undefined> {
  if (!shouldExportAsYoloSegment(shape)) return undefined
  const points = shapePoints(shape)
  const safePoints = decimatePoints(points, MAX_YOLO_SEGMENT_POINTS)
  const poly = safePoints.length >= 3 ? safePoints : undefined
  const bbox = bboxFromShape(shape, width, height)
  if (!poly && !bbox) return undefined
  trace?.(poly ? "fallback_points_polygon" : "fallback_bbox_polygon")
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

function scanMaxSkeletonKpts(allItems: ExportImageItem[]): number {
  let max = 0
  for (const item of allItems) {
    const doc = safeReadAnnotationDoc(item.filePath)
    for (const shape of doc.shapes ?? []) {
      if (!shouldExportAsYoloPose(shape)) continue
      const n = shapePoints(shape).length
      if (n > max) max = n
    }
  }
  return max
}

function buildYoloPoseLayout(project: ProjectRecord, classNames: string[], allItems: ExportImageItem[]): YoloPoseLayout {
  const kptCountByLabel = new Map<string, number>()
  for (const tag of project.tags) {
    const name = tag.name.trim()
    if (!name) continue
    if (tag.kind === "skeleton" && tag.skeletonTemplate?.points?.length) {
      kptCountByLabel.set(name, tag.skeletonTemplate.points.length)
    }
  }
  const tagMax = Math.max(0, ...kptCountByLabel.values())
  const scanMax = scanMaxSkeletonKpts(allItems)
  const maxKpts = Math.max(1, tagMax, scanMax)

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

function exportAsXAnyLabeling(
  images: ExportImageItem[],
  outputDir: string,
  updateProgress: (done: number, total: number, message: string) => void,
  logImageDone?: (item: ExportImageItem, elapsedMs: number) => void,
): void {
  const total = images.length
  for (let i = 0; i < images.length; i += 1) {
    const item = images[i]
    const startedAt = Date.now()
    const relPath = path.join(item.subset, item.relativeWithinSubset)
    const imageTarget = path.join(outputDir, relPath)
    copyImage(item.filePath, imageTarget)

    const srcJson = resolveAnnotationJsonPath(item.filePath)
    const targetJson = resolveAnnotationJsonPath(imageTarget)
    if (fs.existsSync(srcJson)) {
      ensureDir(path.dirname(targetJson))
      fs.copyFileSync(srcJson, targetJson)
    }
    updateProgress(i + 1, total, `导出 ${item.fileName}`)
    logImageDone?.(item, Date.now() - startedAt)
  }
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

function writeYoloDataYaml(rootDir: string, classNames: string[], splitNames: string[], options?: { obb?: boolean }): void {
  const existingSplits = splitNames.filter((name) => fs.existsSync(path.join(rootDir, "images", name)))
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
  if (existingSplits.length === 0) yamlLines.push("train: images")
  yamlLines.push("names:")
  classNames.forEach((name, index) => {
    yamlLines.push(`  ${index}: "${name.replaceAll('"', '\\"')}"`)
  })
  fs.writeFileSync(path.join(rootDir, "data.yaml"), `${yamlLines.join("\n")}\n`, "utf8")
}

/** Ultralytics YOLO Pose 数据集 YAML：https://docs.ultralytics.com/datasets/pose/ */
function writeYoloDataYamlPose(rootDir: string, classNames: string[], splitNames: string[], layout: YoloPoseLayout): void {
  const existingSplits = splitNames.filter((name) => fs.existsSync(path.join(rootDir, "images", name)))
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
  if (existingSplits.length === 0) lines.push("train: images")
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
  fs.writeFileSync(path.join(rootDir, "data.yaml"), `${lines.join("\n")}\n`, "utf8")
}

async function exportAsYolo(
  format: ExportFormat,
  images: ExportImageItem[],
  classByName: Map<string, number>,
  classNames: string[],
  outputDir: string,
  keepProjectStructure: boolean,
  updateProgress: (done: number, total: number, message: string) => void,
  poseLayout: YoloPoseLayout | null,
  traceEvent?: (event: Omit<ExportWorkerTraceEvent, "ts" | "jobId" | "format">) => void,
  logImageDone?: (item: ExportImageItem, elapsedMs: number) => void,
): Promise<void> {
  const total = images.length
  const splitSet = new Set<string>()
  for (let i = 0; i < images.length; i += 1) {
    const item = images[i]
    const startedAt = Date.now()
    const doc = safeReadAnnotationDoc(item.filePath)
    const width = normalizeImageDimension(doc.imageWidth, 1)
    const height = normalizeImageDimension(doc.imageHeight, 1)
    const labels: string[] = []
    for (let shapeIndex = 0; shapeIndex < (doc.shapes ?? []).length; shapeIndex += 1) {
      const shape = (doc.shapes ?? [])[shapeIndex]!
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
              ? await toYoloSegmentLine(shape, classId, width, height, (stage, detail) =>
                  traceEvent?.({
                    stage,
                    detail,
                    imagePath: item.filePath,
                    shapeIndex,
                    label,
                    classId,
                  }),
                )
              : format === "yolo-pose" && poseLayout
                ? toYoloPoseLine(shape, classId, width, height, poseLayout)
                : undefined
      if (line) labels.push(line)
    }
    const splitDir = item.subset
    splitSet.add(item.subset)
    const relPath = keepProjectStructure ? item.relativeWithinSubset : item.fileName
    const imageTarget = keepProjectStructure
      ? path.join(outputDir, splitDir, "images", relPath)
      : path.join(outputDir, "images", splitDir, relPath)
    const labelTarget = keepProjectStructure
      ? path.join(outputDir, splitDir, "labels", `${removeExt(relPath)}.txt`)
      : path.join(outputDir, "labels", splitDir, `${removeExt(relPath)}.txt`)
    copyImage(item.filePath, imageTarget)
    ensureDir(path.dirname(labelTarget))
    fs.writeFileSync(labelTarget, `${labels.join("\n")}${labels.length ? "\n" : ""}`, "utf8")
    updateProgress(i + 1, total, `导出 ${item.fileName}`)
    logImageDone?.(item, Date.now() - startedAt)
  }
  if (format === "yolo-pose" && poseLayout) {
    if (!keepProjectStructure) {
      writeYoloDataYamlPose(outputDir, classNames, [...splitSet], poseLayout)
    } else {
      for (const taskName of splitSet) {
        writeYoloDataYamlPose(path.join(outputDir, taskName), classNames, [], poseLayout)
      }
    }
  } else if (!keepProjectStructure) {
    writeYoloDataYaml(outputDir, classNames, [...splitSet], { obb: format === "yolo-obb" })
  } else {
    for (const taskName of splitSet) {
      writeYoloDataYaml(path.join(outputDir, taskName), classNames, [], { obb: format === "yolo-obb" })
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

function collectClassNamesForExport(project: ProjectRecord, images: ExportImageItem[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of project.tags) {
    const name = (tag.name || "").trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  for (const item of images) {
    const doc = safeReadAnnotationDoc(item.filePath)
    for (const shape of doc.shapes ?? []) {
      const label = typeof shape.label === "string" ? shape.label.trim() : ""
      if (!label || seen.has(label)) continue
      seen.add(label)
      out.push(label)
    }
  }
  return out
}

async function runExport(job: ExportJobRecord, req: ExportRequest): Promise<void> {
  updateJob(job.id, { status: "running", progress: 1, message: "开始导出" })
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
  const classNames = req.exportFormat === "xanylabeling" ? [] : collectClassNamesForExport(req.project, groupedItems)
  const classByName = new Map<string, number>(classNames.map((name, index) => [name, index]))
  if (req.exportFormat !== "xanylabeling" && classNames.length === 0) {
    updateJob(job.id, { status: "failed", progress: 100, message: "没有可导出的类别标签（标注 label 为空）" })
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
  const poseLayout = req.exportFormat === "yolo-pose" ? buildYoloPoseLayout(req.project, classNames, allItems) : null
  const stagingDir = compressToZip ? path.join(os.tmpdir(), `easyannotate-export-${job.id}`) : req.outputPath
  fs.mkdirSync(stagingDir, { recursive: true })
  try {
    if (req.exportFormat === "coco") {
      await exportAsCoco(groupedItems, stagingDir, classNames, !req.taskId && req.keepProjectStructure, updateProgress, logImageTiming)
    } else if (req.exportFormat === "voc") {
      exportAsVoc(groupedItems, stagingDir, !req.taskId && req.keepProjectStructure, updateProgress, logImageTiming)
    } else if (req.exportFormat === "xanylabeling") {
      exportAsXAnyLabeling(groupedItems, stagingDir, updateProgress, logImageTiming)
    } else {
      await exportAsYolo(
        req.exportFormat,
        groupedItems,
        classByName,
        classNames,
        stagingDir,
        !req.taskId && req.keepProjectStructure,
        updateProgress,
        poseLayout,
        trace,
        logImageTiming,
      )
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

export function startDatasetExportJob(req: ExportRequest): { jobId: string } {
  const job = createJobRecord(req)
  exportJobs.set(job.id, job)
  queueMicrotask(() => {
    void runExport(job, req).catch((error) => {
      updateJob(job.id, {
        status: "failed",
        progress: 100,
        message: error instanceof Error ? error.message : String(error),
      })
    })
  })
  return { jobId: job.id }
}

export function listDatasetExportJobs(): ExportJobRecord[] {
  return [...exportJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

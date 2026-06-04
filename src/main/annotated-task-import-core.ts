import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { parseImageDimensionsFromHeader } from "./image-dimensions"
import { getProject } from "./project-storage"

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"])
const MAX_YOLO_SEGMENT_POINTS = 120
const MAX_SHAPES_PER_IMAGE = 800
const MAX_YOLO_TXT_BYTES = 512 * 1024
const MAX_ANNOTATION_JSON_BYTES = 8 * 1024 * 1024
const MAX_YOLO_LINE_VALUES = 4096
const YOLO_IMPORT_YIELD_EVERY = 8
const XANY_IMPORT_YIELD_EVERY = 16

function isYoloImportFormat(format: string): boolean {
  return format === "yolo-detect" || format === "yolo-obb" || format === "yolo-segment"
}

export type AnnotatedImportRequest = {
  globalConfigDir: string
  projectId: string
  taskId: string
  subset: string
  zipPath: string
  importFormat: string
}

export type AnnotatedImportResult = {
  errorMessage: string
  importedImageCount: number
  importedAnnotationCount: number
  detectedFormat: string
}

export type AnnotatedImportProgressReporter = (patch: {
  progress?: number
  statusMessage?: string
  importedImageCount?: number
  importedAnnotationCount?: number
}) => void

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

type YoloImportTargetFormat = "yolo-detect" | "yolo-obb" | "yolo-segment"

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

function resolveAnnotationJsonPath(imagePath: string): string {
  const parsed = path.parse(imagePath)
  return path.join(parsed.dir, `${parsed.name}.json`)
}

function resolveSystemTarExecutable(): string {
  if (process.platform === "win32") {
    const tarExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    if (fs.existsSync(tarExe)) return tarExe
  }
  return "tar"
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const XANY_JSON_HEAD_BYTES = 32 * 1024

async function looksLikeXAnyLabelJsonFile(filePath: string): Promise<boolean> {
  const fh = await fs.promises.open(filePath, "r")
  try {
    const buf = Buffer.alloc(XANY_JSON_HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, XANY_JSON_HEAD_BYTES, 0)
    if (bytesRead <= 0) return false
    const head = buf.subarray(0, bytesRead).toString("utf8")
    return /["']shapes["']\s*:\s*\[/.test(head)
  } finally {
    await fh.close()
  }
}

async function walkFilesRecursiveAsync(rootDir: string): Promise<string[]> {
  if (!fs.existsSync(rootDir)) return []
  const out: string[] = []
  const stack = [rootDir]
  let scannedDirs = 0
  while (stack.length > 0) {
    const dir = stack.pop()!
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const ent of entries) {
      const absPath = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(absPath)
        continue
      }
      if (ent.isFile()) out.push(absPath)
    }
    scannedDirs += 1
    if (scannedDirs % 32 === 0) await yieldToEventLoop()
  }
  return out
}

function toPosixRelative(baseDir: string, absPath: string): string {
  return path.relative(baseDir, absPath).replace(/\\/g, "/").replace(/^\/+/, "")
}

async function readFileHeaderAsync(filePath: string, maxBytes = 256 * 1024): Promise<Buffer> {
  const fh = await fs.promises.open(filePath, "r")
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await fh.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

async function readTextFileCapped(filePath: string, maxBytes: number): Promise<string> {
  const fh = await fs.promises.open(filePath, "r")
  try {
    const stat = await fh.stat()
    const toRead = Math.min(maxBytes, Math.max(0, stat.size))
    if (toRead <= 0) return ""
    const buffer = Buffer.allocUnsafe(toRead)
    const { bytesRead } = await fh.read(buffer, 0, toRead, 0)
    return buffer.subarray(0, bytesRead).toString("utf8")
  } finally {
    await fh.close()
  }
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

async function parseImageSizeFromFileAsync(
  filePath: string,
  cache: Map<string, { width: number; height: number }>,
): Promise<{ width: number; height: number }> {
  const cached = cache.get(filePath)
  if (cached) return cached
  try {
    const header = await readFileHeaderAsync(filePath)
    const format = detectImageFormat(header)
    const size = parseImageDimensionsFromHeader(header, format)
    const parsed = {
      width: Math.max(1, Math.round(size.width || 0)),
      height: Math.max(1, Math.round(size.height || 0)),
    }
    cache.set(filePath, parsed)
    return parsed
  } catch {
    const fallback = { width: 1, height: 1 }
    cache.set(filePath, fallback)
    return fallback
  }
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

async function readYoloClassNamesFromPaths(classFilePaths: string[]): Promise<string[]> {
  for (const filePath of classFilePaths) {
    const base = path.basename(filePath).toLowerCase()
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
      /* ignore */
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
  if (values.length < 5 || values.length > MAX_YOLO_LINE_VALUES || values.some((v) => !Number.isFinite(v))) return null
  const classId = Math.max(0, Math.floor(values[0]))
  const label = labels[classId] ?? `class_${classId}`
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
  const safePoints = shouldTreatAsObb ? points.slice(0, 4) : decimatePoints(points, MAX_YOLO_SEGMENT_POINTS)
  return {
    label,
    score: null,
    points: safePoints,
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
    return { ...shape, shape_type: "polygon", points: shape.points.slice(0, 4) }
  }
  const bbox = bboxFromPoints(shape.points)
  if (!bbox) return null
  const rectPoints = rectCornersFromBbox(bbox)
  if (target === "yolo-detect") {
    return { ...shape, shape_type: "rectangle", points: rectPoints }
  }
  if (shape.shape_type === "rotation" && shape.points.length >= 4) return shape
  return { ...shape, shape_type: "rotation", points: rectPoints }
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
    if (out.length >= MAX_SHAPES_PER_IMAGE) break
  }
  return out
}

async function writeXAnyJsonIfSafe(targetJsonPath: string, jsonText: string): Promise<boolean> {
  const bytes = Buffer.byteLength(jsonText, "utf8")
  if (bytes <= 0 || bytes > MAX_ANNOTATION_JSON_BYTES) return false
  await fs.promises.writeFile(targetJsonPath, jsonText, "utf8")
  return true
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

async function extractZipToTempDir(
  zipPath: string,
  tempRoot: string,
): Promise<{ ok: boolean; extractDir: string; errorMessage: string }> {
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

function emptyResult(errorMessage: string): AnnotatedImportResult {
  return {
    errorMessage,
    importedImageCount: 0,
    importedAnnotationCount: 0,
    detectedFormat: "",
  }
}

export type AnnotatedFilesImportRequest = {
  globalConfigDir: string
  projectId: string
  taskId: string
  subset: string
  imagePaths: string[]
  labelPaths: string[]
  yoloClassPaths: string[]
  importFormat: string
}

const MAX_ANNOTATED_FILES_IMPORT = 500

export async function runAnnotatedTaskFilesImport(
  request: AnnotatedFilesImportRequest,
  report?: AnnotatedImportProgressReporter,
): Promise<AnnotatedImportResult> {
  const emit = (patch: Parameters<AnnotatedImportProgressReporter>[0]) => {
    report?.(patch)
  }
  try {
    const importFormat = (request.importFormat || "xanylabeling").trim().toLowerCase()
    const allowFormats = new Set(["xanylabeling", "yolo-detect", "yolo-obb", "yolo-segment", "yolo-pose"])
    if (!allowFormats.has(importFormat)) {
      return emptyResult(`不支持的导入格式：${importFormat}`)
    }
    if (
      importFormat !== "xanylabeling" &&
      importFormat !== "yolo-detect" &&
      importFormat !== "yolo-obb" &&
      importFormat !== "yolo-segment"
    ) {
      return emptyResult(`导入格式 ${importFormat} 暂未实现，当前支持 xanylabeling / yolo-detect / yolo-obb / yolo-segment。`)
    }

    const project = getProject(request.globalConfigDir, request.projectId)
    if (!project) return emptyResult("项目不存在。")

    const images = (request.imagePaths ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => fs.existsSync(item))
    if (images.length <= 0) return emptyResult("未选择有效图片文件。")
    if (images.length > MAX_ANNOTATED_FILES_IMPORT) {
      return emptyResult(`图片数量不能超过 ${MAX_ANNOTATED_FILES_IMPORT} 张。`)
    }

    const labelByStem = new Map<string, string>()
    for (const rawLabelPath of request.labelPaths ?? []) {
      const labelPath = rawLabelPath.trim()
      if (!labelPath || !fs.existsSync(labelPath)) continue
      const stem = path.basename(labelPath, path.extname(labelPath)).toLowerCase()
      if (!stem) continue
      if (!labelByStem.has(stem)) {
        labelByStem.set(stem, labelPath)
      }
    }

    const yoloClassFilePaths = (request.yoloClassPaths ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => fs.existsSync(item))

    const detectedFormat =
      importFormat === "xanylabeling"
        ? "xanylabeling"
        : importFormat === "yolo-detect"
          ? "yolo-detect"
          : importFormat === "yolo-obb"
            ? "yolo-obb"
            : "yolo-segment"

    const rawSubset = (request.subset || "").trim()
    const baseRoot =
      project.storageType === "local" && project.localPath ? project.localPath : path.dirname(project.configFilePath)
    const taskRootDir = path.join(baseRoot, "data", "tasks", sanitizeSegment(request.taskId))
    const subset = sanitizeSegment(rawSubset || "default")
    const taskDir = path.join(taskRootDir, subset)
    await fs.promises.mkdir(taskDir, { recursive: true })

    let importedImageCount = 0
    let importedAnnotationCount = 0
    const projectTagNames = (project.tags ?? []).map((tag) => tag.name.trim()).filter(Boolean)
    const yoloNames = importFormat === "xanylabeling" ? [] : await readYoloClassNamesFromPaths(yoloClassFilePaths)
    const yoloClassNames = yoloNames.length > 0 ? yoloNames : projectTagNames
    const totalImages = images.length
    const imageSizeCache = new Map<string, { width: number; height: number }>()
    const yieldEvery = isYoloImportFormat(importFormat) ? YOLO_IMPORT_YIELD_EVERY : XANY_IMPORT_YIELD_EVERY

    emit({ progress: 5, statusMessage: `开始导入 ${totalImages} 张图片…` })

    for (let i = 0; i < images.length; i += 1) {
      const srcImagePath = images[i]!
      const imageName = path.basename(srcImagePath)
      const targetImagePath = buildUniqueFilePath(taskDir, imageName)
      await fs.promises.copyFile(srcImagePath, targetImagePath)
      importedImageCount += 1

      const targetJsonPath = resolveAnnotationJsonPath(targetImagePath)
      const stem = path.basename(srcImagePath, path.extname(srcImagePath)).toLowerCase()
      const srcLabelPath = labelByStem.get(stem)

      if (importFormat === "xanylabeling") {
        if (srcLabelPath && fs.existsSync(srcLabelPath) && (await looksLikeXAnyLabelJsonFile(srcLabelPath))) {
          await fs.promises.copyFile(srcLabelPath, targetJsonPath)
          importedAnnotationCount += 1
        }
      } else if (srcLabelPath && fs.existsSync(srcLabelPath)) {
        const txtRaw = await readTextFileCapped(srcLabelPath, MAX_YOLO_TXT_BYTES)
        if (txtRaw.trim()) {
          const { width, height } = await parseImageSizeFromFileAsync(srcImagePath, imageSizeCache)
          const shapes =
            importFormat === "yolo-obb"
              ? parseYoloTxtToShapesForTarget(txtRaw, yoloClassNames, width, height, "yolo-obb")
              : importFormat === "yolo-segment"
                ? parseYoloTxtToShapesForTarget(txtRaw, yoloClassNames, width, height, "yolo-segment")
                : parseYoloTxtToShapesForTarget(txtRaw, yoloClassNames, width, height, "yolo-detect")
          if (shapes.length > 0) {
            const jsonText = createXAnyDocJson({
              imageFileName: path.basename(targetImagePath),
              imageWidth: width,
              imageHeight: height,
              shapes,
            })
            if (await writeXAnyJsonIfSafe(targetJsonPath, jsonText)) {
              importedAnnotationCount += 1
            }
          }
        }
      }

      if ((i + 1) % yieldEvery === 0 || i + 1 === totalImages) {
        const importProgress = 5 + Math.floor(((i + 1) / totalImages) * 93)
        emit({
          progress: importProgress,
          statusMessage: `正在导入 ${i + 1}/${totalImages}…`,
          importedImageCount,
          importedAnnotationCount,
        })
        await yieldToEventLoop()
      }
    }

    emit({ progress: 100, statusMessage: "导入完成", importedImageCount, importedAnnotationCount })
    return {
      errorMessage: "",
      importedImageCount,
      importedAnnotationCount,
      detectedFormat,
    }
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : String(error))
  }
}

export async function runAnnotatedTaskZipImport(
  request: AnnotatedImportRequest,
  report?: AnnotatedImportProgressReporter,
): Promise<AnnotatedImportResult> {
  let tempRoot = ""
  const emit = (patch: Parameters<AnnotatedImportProgressReporter>[0]) => {
    report?.(patch)
  }
  try {
    const importFormat = (request.importFormat || "xanylabeling").trim().toLowerCase()
    const allowFormats = new Set(["xanylabeling", "yolo-detect", "yolo-obb", "yolo-segment", "yolo-pose"])
    if (!allowFormats.has(importFormat)) {
      return emptyResult(`不支持的导入格式：${importFormat}`)
    }
    if (
      importFormat !== "xanylabeling" &&
      importFormat !== "yolo-detect" &&
      importFormat !== "yolo-obb" &&
      importFormat !== "yolo-segment"
    ) {
      return emptyResult(`导入格式 ${importFormat} 暂未实现，当前支持 xanylabeling / yolo-detect / yolo-obb / yolo-segment。`)
    }

    const project = getProject(request.globalConfigDir, request.projectId)
    if (!project) return emptyResult("项目不存在。")

    const zipPath = (request.zipPath || "").trim()
    if (!zipPath) return emptyResult("请选择 zip 文件。")
    if (!zipPath.toLowerCase().endsWith(".zip")) return emptyResult("仅支持 .zip 文件。")
    if (!fs.existsSync(zipPath)) return emptyResult("zip 文件不存在。")

    emit({ progress: 2, statusMessage: "正在解压 ZIP…" })
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "easyannotate-task-import-"))
    const extract = await extractZipToTempDir(zipPath, tempRoot)
    if (!extract.ok) return emptyResult(extract.errorMessage)
    const extractDir = extract.extractDir

    emit({ progress: 8, statusMessage: "正在扫描文件…" })
    const allFiles = await walkFilesRecursiveAsync(extractDir)
    const images = allFiles.filter((p) => IMAGE_EXTS.has(path.extname(p).toLowerCase()))
    if (images.length <= 0) return emptyResult("zip 内未找到可导入图片。")

    const txtSet = new Set<string>()
    const txtPathByRelLower = new Map<string, string>()
    const txtByBaseName = new Map<string, string[]>()
    const xanyJsonByImageRelLower = new Map<string, string>()
    const yoloClassFilePaths: string[] = []
    let indexedFiles = 0
    for (const filePath of allFiles) {
      const relLower = toPosixRelative(extractDir, filePath).toLowerCase()
      const ext = path.extname(filePath).toLowerCase()
      if (isYoloImportFormat(importFormat) && ext === ".txt") {
        txtSet.add(relLower)
        txtPathByRelLower.set(relLower, filePath)
        const base = path.basename(filePath).toLowerCase()
        const arr = txtByBaseName.get(base) ?? []
        arr.push(relLower)
        txtByBaseName.set(base, arr)
      } else if (isYoloImportFormat(importFormat)) {
        const base = path.basename(filePath).toLowerCase()
        if (base === "data.yaml" || base === "data.yml" || base === "classes.txt") {
          yoloClassFilePaths.push(filePath)
        }
      } else if (importFormat === "xanylabeling" && ext === ".json") {
        try {
          if (await looksLikeXAnyLabelJsonFile(filePath)) {
            const relNoExt = relLower.replace(/\.json$/i, "")
            for (const imageExt of IMAGE_EXTS) {
              xanyJsonByImageRelLower.set(`${relNoExt}${imageExt}`, filePath)
            }
          }
        } catch {
          /* ignore */
        }
      }
      indexedFiles += 1
      if (indexedFiles % 64 === 0) {
        const scanProgress = 8 + Math.floor((indexedFiles / Math.max(allFiles.length, 1)) * 12)
        emit({ progress: scanProgress, statusMessage: `正在扫描文件 ${indexedFiles}/${allFiles.length}…` })
        await yieldToEventLoop()
      }
    }

    const detectedFormat: "xanylabeling" | "yolo-detect" | "yolo-obb" | "yolo-segment" | "" =
      importFormat === "xanylabeling"
        ? images.some((img) => xanyJsonByImageRelLower.has(toPosixRelative(extractDir, img).toLowerCase()))
          ? "xanylabeling"
          : ""
        : importFormat === "yolo-detect"
          ? images.some((img) => Boolean(resolveYoloTxtForImage(toPosixRelative(extractDir, img), txtSet, txtByBaseName)))
            ? "yolo-detect"
            : ""
          : importFormat === "yolo-obb"
            ? images.some((img) => Boolean(resolveYoloTxtForImage(toPosixRelative(extractDir, img), txtSet, txtByBaseName)))
              ? "yolo-obb"
              : ""
            : images.some((img) => Boolean(resolveYoloTxtForImage(toPosixRelative(extractDir, img), txtSet, txtByBaseName)))
              ? "yolo-segment"
              : ""

    if (!detectedFormat) {
      return emptyResult(
        importFormat === "xanylabeling"
          ? "未识别到标注格式：请提供 XAnyLabeling(json) 标注压缩包。"
          : importFormat === "yolo-detect"
            ? "未识别到标注格式：请提供 YOLO Detect(txt) 标注压缩包。"
            : importFormat === "yolo-obb"
              ? "未识别到标注格式：请提供 YOLO OBB(txt) 标注压缩包。"
              : "未识别到标注格式：请提供 YOLO Segment(txt) 标注压缩包。",
      )
    }

    const rawSubset = (request.subset || "").trim()
    const baseRoot =
      project.storageType === "local" && project.localPath ? project.localPath : path.dirname(project.configFilePath)
    const taskRootDir = path.join(baseRoot, "data", "tasks", sanitizeSegment(request.taskId))
    const subset = sanitizeSegment(rawSubset || "default")
    const taskDir = path.join(taskRootDir, subset)
    await fs.promises.mkdir(taskDir, { recursive: true })

    let importedImageCount = 0
    let importedAnnotationCount = 0
    const projectTagNames = (project.tags ?? []).map((tag) => tag.name.trim()).filter(Boolean)
    const yoloNames = importFormat === "xanylabeling" ? [] : await readYoloClassNamesFromPaths(yoloClassFilePaths)
    const yoloClassNames = yoloNames.length > 0 ? yoloNames : projectTagNames
    const totalImages = images.length
    const imageSizeCache = new Map<string, { width: number; height: number }>()
    const yieldEvery = isYoloImportFormat(importFormat) ? YOLO_IMPORT_YIELD_EVERY : XANY_IMPORT_YIELD_EVERY

    emit({ progress: 20, statusMessage: `开始导入 ${totalImages} 张图片…` })

    for (let i = 0; i < images.length; i += 1) {
      const srcImagePath = images[i]!
      const imageName = path.basename(srcImagePath)
      const targetImagePath = buildUniqueFilePath(taskDir, imageName)
      await fs.promises.copyFile(srcImagePath, targetImagePath)
      importedImageCount += 1

      const targetJsonPath = resolveAnnotationJsonPath(targetImagePath)
      if (importFormat === "xanylabeling") {
        const relImageLower = toPosixRelative(extractDir, srcImagePath).toLowerCase()
        const srcJsonPath = xanyJsonByImageRelLower.get(relImageLower)
        if (srcJsonPath && fs.existsSync(srcJsonPath)) {
          await fs.promises.copyFile(srcJsonPath, targetJsonPath)
          importedAnnotationCount += 1
        }
      } else {
        const relImagePath = toPosixRelative(extractDir, srcImagePath)
        const txtRel = resolveYoloTxtForImage(relImagePath, txtSet, txtByBaseName)
        const txtAbsPath = txtRel ? txtPathByRelLower.get(txtRel) : undefined
        if (txtAbsPath) {
          const txtRaw = await readTextFileCapped(txtAbsPath, MAX_YOLO_TXT_BYTES)
          if (txtRaw.trim()) {
            const { width, height } = await parseImageSizeFromFileAsync(srcImagePath, imageSizeCache)
            const shapes =
              importFormat === "yolo-obb"
                ? parseYoloTxtToShapesForTarget(txtRaw, yoloClassNames, width, height, "yolo-obb")
                : importFormat === "yolo-segment"
                  ? parseYoloTxtToShapesForTarget(txtRaw, yoloClassNames, width, height, "yolo-segment")
                  : parseYoloTxtToShapesForTarget(txtRaw, yoloClassNames, width, height, "yolo-detect")
            if (shapes.length > 0) {
              const jsonText = createXAnyDocJson({
                imageFileName: path.basename(targetImagePath),
                imageWidth: width,
                imageHeight: height,
                shapes,
              })
              if (await writeXAnyJsonIfSafe(targetJsonPath, jsonText)) {
                importedAnnotationCount += 1
              }
            }
          }
        }
      }

      if ((i + 1) % yieldEvery === 0 || i + 1 === totalImages) {
        const importProgress = 20 + Math.floor(((i + 1) / totalImages) * 78)
        emit({
          progress: importProgress,
          statusMessage: `正在导入 ${i + 1}/${totalImages}…`,
          importedImageCount,
          importedAnnotationCount,
        })
        await yieldToEventLoop()
      }
    }

    if (importedImageCount <= 0) {
      return { ...emptyResult("zip 内没有可导入图片。"), detectedFormat }
    }

    emit({ progress: 100, statusMessage: "导入完成", importedImageCount, importedAnnotationCount })
    return {
      errorMessage: "",
      importedImageCount,
      importedAnnotationCount,
      detectedFormat,
    }
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : String(error))
  } finally {
    if (tempRoot) {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
    }
  }
}

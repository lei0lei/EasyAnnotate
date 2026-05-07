import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { contourForYoloExport, minimumAreaBoundingBoxCornersFromPoints, obbCornersFromMaskBinary } from "../renderer/lib/mask-contour"
import { decodeRowMajorRleToBinary, foregroundBBoxInclusive, readMaskRle } from "../renderer/lib/mask-raster-rle"
import type { ProjectRecord } from "./project-storage"

type ExportFormat = "coco" | "voc" | "yolo-detect" | "yolo-obb" | "yolo-segment" | "yolo-pose"
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
  outputDir: string
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

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"])
const exportJobs = new Map<string, ExportJobRecord>()

function sanitizeSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
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

function updateJob(jobId: string, patch: Partial<ExportJobRecord>): void {
  const current = exportJobs.get(jobId)
  if (!current) return
  exportJobs.set(jobId, {
    ...current,
    ...patch,
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
    return parsed && typeof parsed === "object" ? parsed : {}
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

function collectExportImages(project: ProjectRecord, taskId?: string): ExportImageItem[] {
  const tasksRoot = resolveProjectDataRoot(project)
  if (!fs.existsSync(tasksRoot)) return []
  if (taskId) {
    const taskRoot = path.join(tasksRoot, sanitizeSegment(taskId))
    return readTaskImages(taskRoot, taskId)
  }
  const entries = fs.readdirSync(tasksRoot, { withFileTypes: true }).filter((item) => item.isDirectory())
  const items: ExportImageItem[] = []
  for (const entry of entries) {
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

function bboxFromShape(
  shape: XAnyShape,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; w: number; h: number } | undefined {
  if (shape.shape_type === "mask" && shape.attributes) {
    const rle = readMaskRle(shape.attributes)
    if (rle && rle.w === imageWidth && rle.h === imageHeight) {
      const bin = decodeRowMajorRleToBinary(rle.counts, rle.w * rle.h)
      const bb = foregroundBBoxInclusive(bin, rle.w, rle.h)
      if (bb) {
        return {
          x: bb.minX,
          y: bb.minY,
          w: Math.max(0, bb.maxX - bb.minX + 1),
          h: Math.max(0, bb.maxY - bb.minY + 1),
        }
      }
    }
  }
  const points = shapePoints(shape)
  if (points.length === 0) return undefined
  if (shape.shape_type === "circle" && points.length >= 2) {
    const dx = points[1][0] - points[0][0]
    const dy = points[1][1] - points[0][1]
    const r = Math.sqrt(dx * dx + dy * dy)
    return { x: points[0][0] - r, y: points[0][1] - r, w: r * 2, h: r * 2 }
  }
  const xs = points.map((pt) => pt[0])
  const ys = points.map((pt) => pt[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function isMaskShape(shape: XAnyShape): boolean {
  return (shape.shape_type || "").trim() === "mask"
}

function shouldExportAsYoloDetect(shape: XAnyShape): boolean {
  const type = (shape.shape_type || "").trim()
  return (
    type === "rectangle" ||
    type === "rotation" ||
    type === "mask" ||
    type === "polygon" ||
    type === "cuboid2d" ||
    type === "skeleton"
  )
}

function toYoloDetectLine(shape: XAnyShape, classId: number, width: number, height: number): string | undefined {
  if (!shouldExportAsYoloDetect(shape)) return undefined
  /** mask：最小水平外接矩形（轴对齐、紧包前景） */
  const bbox = bboxFromShape(shape, width, height)
  if (!bbox) return undefined
  const x = clamp01((bbox.x + bbox.w / 2) / width)
  const y = clamp01((bbox.y + bbox.h / 2) / height)
  const w = clamp01(bbox.w / width)
  const h = clamp01(bbox.h / height)
  return `${classId} ${x.toFixed(6)} ${y.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`
}

/** YOLO OBB：水平框、旋转框、mask（最小面积外接矩形） */
function shouldExportAsYoloObb(shape: XAnyShape): boolean {
  const type = (shape.shape_type || "").trim()
  return type === "rectangle" || type === "rotation" || type === "mask"
}

function toYoloObbLine(shape: XAnyShape, classId: number, width: number, height: number): string | undefined {
  if (!shouldExportAsYoloObb(shape)) return undefined
  if (isMaskShape(shape) && shape.attributes) {
    const rle = readMaskRle(shape.attributes)
    if (rle && rle.w === width && rle.h === height) {
      const bin = decodeRowMajorRleToBinary(rle.counts, rle.w * rle.h)
      const corners = obbCornersFromMaskBinary(bin, rle.w, rle.h)
      if (corners && corners.length === 4) {
        const coords = corners
          .flatMap((pt) => [clamp01(pt[0]! / width).toFixed(6), clamp01(pt[1]! / height).toFixed(6)])
          .join(" ")
        return `${classId} ${coords}`
      }
    }
    const pts = shapePoints(shape).map(([x, y]) => ({ x, y }))
    const obb = minimumAreaBoundingBoxCornersFromPoints(pts)
    if (obb && obb.length === 4) {
      const coords = obb
        .flatMap((pt) => [clamp01(pt[0]! / width).toFixed(6), clamp01(pt[1]! / height).toFixed(6)])
        .join(" ")
      return `${classId} ${coords}`
    }
  }
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

function shouldExportAsYoloSegment(shape: XAnyShape): boolean {
  const type = (shape.shape_type || "").trim()
  return type === "rectangle" || type === "rotation" || type === "polygon" || type === "mask"
}

function toYoloSegmentLine(shape: XAnyShape, classId: number, width: number, height: number): string | undefined {
  if (!shouldExportAsYoloSegment(shape)) return undefined
  if ((shape.shape_type || "").trim() === "mask" && shape.attributes) {
    const rle = readMaskRle(shape.attributes)
    if (rle && rle.w === width && rle.h === height) {
      const bin = decodeRowMajorRleToBinary(rle.counts, rle.w * rle.h)
      const contour = contourForYoloExport(bin, rle.w, rle.h)
      if (contour.length >= 3) {
        const coords = contour
          .flatMap((pt) => [clamp01(pt[0]! / width).toFixed(6), clamp01(pt[1]! / height).toFixed(6)])
          .join(" ")
        return `${classId} ${coords}`
      }
    }
  }
  const points = shapePoints(shape)
  const poly = points.length >= 3 ? points : undefined
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

function createJobRecord(req: ExportRequest): ExportJobRecord {
  const now = nowIso()
  return {
    id: randomUUID(),
    projectId: req.projectId,
    taskId: req.taskId ?? "",
    versionName: req.versionName,
    exportFormat: req.exportFormat,
    keepProjectStructure: req.keepProjectStructure,
    outputDir: req.outputDir,
    status: "queued",
    progress: 0,
    message: "等待开始",
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
  yamlLines.push(`path: ${rootDir.replace(/\\/g, "/")}`)
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
    `path: ${rootDir.replace(/\\/g, "/")}`,
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

function exportAsYolo(
  format: ExportFormat,
  images: ExportImageItem[],
  classByName: Map<string, number>,
  classNames: string[],
  outputDir: string,
  keepProjectStructure: boolean,
  updateProgress: (done: number, total: number, message: string) => void,
  poseLayout: YoloPoseLayout | null,
): void {
  const total = images.length
  const splitSet = new Set<string>()
  for (let i = 0; i < images.length; i += 1) {
    const item = images[i]
    const doc = safeReadAnnotationDoc(item.filePath)
    const width = Math.max(1, Number(doc.imageWidth || 1))
    const height = Math.max(1, Number(doc.imageHeight || 1))
    const labels: string[] = []
    for (const shape of doc.shapes ?? []) {
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
              ? toYoloSegmentLine(shape, classId, width, height)
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

function exportAsVoc(images: ExportImageItem[], outputDir: string, keepProjectStructure: boolean, updateProgress: (done: number, total: number, message: string) => void): void {
  const total = images.length
  const splitNames = new Set<string>()
  for (let i = 0; i < images.length; i += 1) {
    const item = images[i]
    const doc = safeReadAnnotationDoc(item.filePath)
    const width = Math.max(1, Number(doc.imageWidth || 1))
    const height = Math.max(1, Number(doc.imageHeight || 1))
    const objects: Array<{ label: string; bbox: { x: number; y: number; w: number; h: number } }> = []
    for (const shape of doc.shapes ?? []) {
      if (isMaskShape(shape)) continue
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
  }
  void splitNames
}

function exportAsCoco(images: ExportImageItem[], outputDir: string, classNames: string[], keepProjectStructure: boolean, updateProgress: (done: number, total: number, message: string) => void): void {
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
      const relPath = keepProjectStructure ? item.relativeWithinSubset : item.fileName
      copyImage(item.filePath, path.join(imageTarget, relPath))
      const doc = safeReadAnnotationDoc(item.filePath)
      const width = Math.max(1, Number(doc.imageWidth || 1))
      const height = Math.max(1, Number(doc.imageHeight || 1))
      const currentImageId = imageId
      imageRows.push({
        id: currentImageId,
        file_name: relPath.replace(/\\/g, "/"),
        width,
        height,
      })
      for (const shape of doc.shapes ?? []) {
        if (isMaskShape(shape)) continue
        const label = typeof shape.label === "string" ? shape.label.trim() : ""
        const categoryId = classNames.indexOf(label) + 1
        const bbox = bboxFromShape(shape, width, height)
        if (!label || categoryId <= 0 || !bbox) continue
        const points = shapePoints(shape)
        const seg: number[][] = points.length >= 3 ? [points.flatMap((pt) => [pt[0], pt[1]])] : []
        const area = Math.max(0, bbox.w * bbox.h)
        annotationRows.push({
          id: annotationId,
          image_id: currentImageId,
          category_id: categoryId,
          bbox: [bbox.x, bbox.y, bbox.w, bbox.h],
          area,
          iscrowd: 0,
          segmentation: seg,
        })
        annotationId += 1
      }
      imageId += 1
      done += 1
      updateProgress(done, total, `导出 ${item.fileName}`)
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

function runExport(job: ExportJobRecord, req: ExportRequest): void {
  updateJob(job.id, { status: "running", progress: 1, message: "开始导出" })
  const allItems = collectExportImages(req.project, req.taskId)
  if (allItems.length === 0) {
    updateJob(job.id, { status: "failed", progress: 100, message: "没有可导出的图片" })
    return
  }
  const classNames = req.project.tags.map((tag) => tag.name.trim()).filter(Boolean)
  const classByName = new Map<string, number>(classNames.map((name, index) => [name, index]))
  const groupedItems: ExportImageItem[] = []
  if (!req.taskId && req.keepProjectStructure) {
    for (const item of allItems) {
      const taskName = req.taskNameById[item.taskId]?.trim() || item.taskId
      groupedItems.push({
        ...item,
        subset: sanitizeSegment(taskName),
        relativeWithinSubset: item.relativeWithinTask,
      })
    }
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
  const updateProgress = (done: number, total: number, message: string) => {
    const progress = Math.max(1, Math.min(99, Math.floor((done / Math.max(1, total)) * 100)))
    updateJob(job.id, { progress, message })
  }
  const poseLayout = req.exportFormat === "yolo-pose" ? buildYoloPoseLayout(req.project, classNames, allItems) : null
  try {
    if (req.exportFormat === "coco") {
      exportAsCoco(groupedItems, req.outputDir, classNames, !req.taskId && req.keepProjectStructure, updateProgress)
    } else if (req.exportFormat === "voc") {
      exportAsVoc(groupedItems, req.outputDir, !req.taskId && req.keepProjectStructure, updateProgress)
    } else {
      exportAsYolo(
        req.exportFormat,
        groupedItems,
        classByName,
        classNames,
        req.outputDir,
        !req.taskId && req.keepProjectStructure,
        updateProgress,
        poseLayout,
      )
    }
    updateJob(job.id, { status: "success", progress: 100, message: "导出完成" })
  } catch (error) {
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function startDatasetExportJob(req: ExportRequest): { jobId: string } {
  const job = createJobRecord(req)
  exportJobs.set(job.id, job)
  queueMicrotask(() => {
    runExport(job, req)
  })
  return { jobId: job.id }
}

export function listDatasetExportJobs(): ExportJobRecord[] {
  return [...exportJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

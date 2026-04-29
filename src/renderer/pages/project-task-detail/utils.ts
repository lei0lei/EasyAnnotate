/**
 * 模块：project-task-detail/utils
 * 职责：提供页面通用工具函数（路径、格式化、标签颜色、图片路径解析）。
 * 边界：仅包含可复用纯函数，不依赖页面组件状态。
 */
import type { ProjectItem, TaskFileItem } from "@/lib/projects-api"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { Point } from "@/pages/project-task-detail/types"

export function fileNameFromPath(filePath: string): string {
  if (!filePath) return "未选择文件"
  const normalized = filePath.replace(/\\/g, "/")
  const segments = normalized.split("/")
  return segments[segments.length - 1] || "未选择文件"
}

export function trimTrailingSlashes(input: string): string {
  return input.replace(/[\\/]+$/, "")
}

export function dirnameOfFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx <= 0) return ""
  return normalized.slice(0, idx).replace(/\//g, "\\")
}

export function sanitizeSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

export function resolveTaskImagePath(
  project: ProjectItem | undefined,
  taskId: string | undefined,
  file: TaskFileItem | undefined,
): string {
  if (!file) return ""
  if (!project || !taskId) return file.filePath
  const baseRoot =
    project.storageType === "local" && project.localPath
      ? trimTrailingSlashes(project.localPath)
      : trimTrailingSlashes(dirnameOfFilePath(project.configFilePath))
  const fileName = fileNameFromPath(file.filePath)
  if (!baseRoot || !fileName) return file.filePath
  const subset = sanitizeSegment(file.subset || "default")
  return `${baseRoot}\\data\\tasks\\${sanitizeSegment(taskId)}\\${subset}\\${fileName}`
}

export function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".bmp")) return "image/bmp"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  return "application/octet-stream"
}

export function normalizeTagColor(input: string | undefined): string {
  if (!input) return "#f59e0b"
  const value = input.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  return "#f59e0b"
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function roundPointToInt(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

export function roundPointsToInt(points: number[][]): number[][] {
  return points.map((item) => [Math.round(Number(item[0] ?? 0)), Math.round(Number(item[1] ?? 0))])
}

export function normalizeDocPointsToInt(doc: XAnyLabelFile): XAnyLabelFile {
  return {
    ...doc,
    shapes: doc.shapes.map((shape) => ({
      ...shape,
      points: roundPointsToInt(shape.points),
    })),
  }
}

export function rotatePoint(point: Point, center: Point, radians: number): Point {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const tx = point.x - center.x
  const ty = point.y - center.y
  return {
    x: center.x + tx * cos - ty * sin,
    y: center.y + tx * sin + ty * cos,
  }
}

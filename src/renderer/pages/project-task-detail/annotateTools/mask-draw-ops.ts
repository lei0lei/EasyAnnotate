/**
 * 模块：project-task-detail/annotateTools/mask-draw-ops
 * 职责：提供 Mask 轨迹相关纯算法（插值、擦除、分段）。
 * 边界：纯函数算法层，不依赖组件状态或 DOM。
 */
import type { Point } from "@/pages/project-task-detail/types"

export function interpolateMaskPoints(from: Point, to: Point, brushSize: number): Point[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance <= 0.001) return []
  const spacing = Math.max(0.5, Math.min(6, brushSize * 0.2))
  const steps = Math.max(1, Math.ceil(distance / spacing))
  const points: Point[] = []
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    points.push({ x: from.x + dx * t, y: from.y + dy * t })
  }
  return points
}

export function splitMaskPointSegments(points: number[][], brushSize: number): number[][][] {
  if (points.length === 0) return []
  const maxJoinDistance = Math.max(brushSize * 1.75, 12)
  const segments: number[][][] = []
  let current: number[][] = [[Number(points[0]?.[0] ?? 0), Number(points[0]?.[1] ?? 0)]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    const prevX = Number(prev?.[0] ?? 0)
    const prevY = Number(prev?.[1] ?? 0)
    const currX = Number(curr?.[0] ?? 0)
    const currY = Number(curr?.[1] ?? 0)
    const gap = Math.hypot(currX - prevX, currY - prevY)
    if (gap > maxJoinDistance && current.length > 0) {
      segments.push(current)
      current = []
    }
    current.push([currX, currY])
  }
  if (current.length > 0) segments.push(current)
  return segments
}

function pointToSegmentDistance(point: number[], segStart: Point, segEnd: Point): number {
  const px = Number(point[0] ?? 0)
  const py = Number(point[1] ?? 0)
  const vx = segEnd.x - segStart.x
  const vy = segEnd.y - segStart.y
  const wx = px - segStart.x
  const wy = py - segStart.y
  const lenSq = vx * vx + vy * vy
  if (lenSq <= 1e-6) return Math.hypot(px - segStart.x, py - segStart.y)
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq))
  const projX = segStart.x + t * vx
  const projY = segStart.y + t * vy
  return Math.hypot(px - projX, py - projY)
}

export function eraseMaskPointsByStroke(params: {
  points: number[][]
  brushSize: number
  eraserStroke: Point[]
  eraserRadius: number
}): number[][] {
  const { points, brushSize, eraserStroke, eraserRadius } = params
  if (points.length === 0 || eraserStroke.length === 0) return points
  const sourceSegments = splitMaskPointSegments(points, brushSize)
  const eraserSegments = splitMaskPointSegments(
    eraserStroke.map((p) => [p.x, p.y]),
    Math.max(1, eraserRadius * 2),
  ).map((segment) => segment.map((p) => ({ x: Number(p[0] ?? 0), y: Number(p[1] ?? 0) })))

  const keptSegments = sourceSegments
    .map((segment) =>
      segment.filter((point) => {
        for (const eraserSeg of eraserSegments) {
          for (let i = 0; i < eraserSeg.length - 1; i += 1) {
            const from = eraserSeg[i]
            const to = eraserSeg[i + 1]
            if (!from || !to) continue
            if (pointToSegmentDistance(point, from, to) <= eraserRadius) return false
          }
        }
        return true
      }),
    )
    .filter((segment) => segment.length > 0)

  return keptSegments.flat()
}

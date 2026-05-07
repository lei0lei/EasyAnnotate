/**
 * 模块：project-task-detail/annotateTools/mask-draw-ops
 * 职责：提供 Mask 轨迹相关纯算法（插值、擦除、分段）。
 * 边界：纯函数算法层，不依赖组件状态或 DOM。
 *
 * 擦除：每个 mask 采样点代表半径 brushSize/2 的笔刷圆；橡皮为沿轨迹、半径 eraserRadius 的圆管。
 * 两圆相交则去掉该采样点 ⇔ 采样点到橡皮轨迹距离 ≤ brushSize/2 + eraserRadius（与「橡皮盖住的墨迹」一致）。
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

type LineSeg = { ax: number; ay: number; bx: number; by: number }

/** 橡皮轨迹相邻点连成折线；绘制侧已插值，与视觉一致。 */
function collectEraserEdgesFromStroke(stroke: Point[]): LineSeg[] {
  const edges: LineSeg[] = []
  for (let i = 0; i < stroke.length - 1; i += 1) {
    const a = stroke[i]
    const b = stroke[i + 1]
    if (!a || !b) continue
    edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y })
  }
  return edges
}

/** mask 采样点到橡皮轨迹（折线管 + 顶点）的最短距离。 */
function distanceMaskPointToEraserStroke(px: number, py: number, eraserStroke: Point[], eraserEdges: LineSeg[]): number {
  let minD = Infinity
  for (const e of eraserEdges) {
    minD = Math.min(minD, pointToSegmentDistance([px, py], { x: e.ax, y: e.ay }, { x: e.bx, y: e.by }))
  }
  for (const p of eraserStroke) {
    minD = Math.min(minD, Math.hypot(px - p.x, py - p.y))
  }
  return minD
}

/** 将一段 mask 中心线按步长加密，便于按「圆盘相交」逐点判定，而不必删整条边。 */
function densifyMaskSegment(segment: number[][], maxStep: number): number[][] {
  if (segment.length === 0) return []
  const out: number[][] = []
  const p0 = segment[0]!
  out.push([Number(p0[0] ?? 0), Number(p0[1] ?? 0)])
  for (let i = 0; i < segment.length - 1; i += 1) {
    const a = segment[i]!
    const b = segment[i + 1]!
    const ax = Number(a[0] ?? 0)
    const ay = Number(a[1] ?? 0)
    const bx = Number(b[0] ?? 0)
    const by = Number(b[1] ?? 0)
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const steps = Math.max(1, Math.ceil(len / maxStep))
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps
      out.push([ax + dx * t, ay + dy * t])
    }
  }
  return out
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
  const eraserEdges = collectEraserEdgesFromStroke(eraserStroke)

  const maskR = Math.max(0.5, brushSize / 2)
  const eraseR = Math.max(0.5, eraserRadius)
  /** 橡皮圆盘与 mask 笔刷圆盘相交 */
  const touchThreshold = maskR + eraseR
  const eps = 1e-5

  const sampleStep = Math.max(0.45, Math.min(6, brushSize * 0.2))

  const keptSegments = sourceSegments
    .map((segment) => {
      const dense = densifyMaskSegment(segment, sampleStep)
      return dense.filter((pt) => {
        const px = Number(pt[0] ?? 0)
        const py = Number(pt[1] ?? 0)
        return distanceMaskPointToEraserStroke(px, py, eraserStroke, eraserEdges) > touchThreshold + eps
      })
    })
    .filter((segment) => segment.length > 0)

  return keptSegments.flat()
}

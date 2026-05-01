/**
 * 模块：project-task-detail/interaction-ops
 * 职责：封装拖拽交互中的点位计算（移动、缩放、旋转、顶点拖动）。
 * 边界：仅做交互数学运算，不直接操作 DOM 或状态容器。
 */
import type {
  Point,
  PolygonDragAction,
  PolygonVertexDragAction,
  RotationDragAction,
  RotationTransformAction,
  ShapeDragAction,
} from "@/pages/project-task-detail/types"
import { CUBOID2D_MIN_FRONT_PX } from "@/pages/project-task-detail/annotateTools/cuboid2d-geometry"
import { rotatePoint } from "@/pages/project-task-detail/utils"

type ImageSize = { width: number; height: number }

export function computeRectangleDragPoints(action: ShapeDragAction, pointer: Point, imageSize: ImageSize): number[][] | null {
  if (action.kind === "move") {
    if (action.originalPoints.length < 1) return null
    const dx = pointer.x - action.start.x
    const dy = pointer.y - action.start.y
    const xs = action.originalPoints.map((p) => p[0])
    const ys = action.originalPoints.map((p) => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const clampedDx = Math.max(-minX, Math.min(imageSize.width - maxX, dx))
    const clampedDy = Math.max(-minY, Math.min(imageSize.height - maxY, dy))
    return action.originalPoints.map((p) => [p[0] + clampedDx, p[1] + clampedDy])
  }

  const dx = pointer.x - action.start.x
  const dy = pointer.y - action.start.y
  const original = action.originalPoints
  if (original.length < 4) return null

  const xs = original.map((p) => p[0])
  const ys = original.map((p) => p[1])
  const minX0 = Math.min(...xs)
  const maxX0 = Math.max(...xs)
  const minY0 = Math.min(...ys)
  const maxY0 = Math.max(...ys)
  const minSize = 1

  let minX = minX0
  let maxX = maxX0
  let minY = minY0
  let maxY = maxY0

  if (action.handle === "nw" || action.handle === "sw") minX = minX0 + dx
  if (action.handle === "ne" || action.handle === "se") maxX = maxX0 + dx
  if (action.handle === "nw" || action.handle === "ne") minY = minY0 + dy
  if (action.handle === "sw" || action.handle === "se") maxY = maxY0 + dy

  if (maxX - minX < minSize) {
    if (action.kind === "resize" && (action.handle === "nw" || action.handle === "sw")) {
      minX = maxX - minSize
    } else {
      maxX = minX + minSize
    }
  }
  if (maxY - minY < minSize) {
    if (action.kind === "resize" && (action.handle === "nw" || action.handle === "ne")) {
      minY = maxY - minSize
    } else {
      maxY = minY + minSize
    }
  }

  minX = Math.max(0, Math.min(imageSize.width - minSize, minX))
  maxX = Math.max(minX + minSize, Math.min(imageSize.width, maxX))
  minY = Math.max(0, Math.min(imageSize.height - minSize, minY))
  maxY = Math.max(minY + minSize, Math.min(imageSize.height, maxY))

  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]
}

export function computeRotationDragPoints(action: RotationDragAction, pointer: Point): number[][] {
  const currentAngle = Math.atan2(pointer.y - action.center.y, pointer.x - action.center.x)
  const delta = currentAngle - action.startAngle
  return action.originalPoints.map((item) => {
    const rotated = rotatePoint({ x: item[0], y: item[1] }, action.center, delta)
    return [rotated.x, rotated.y]
  })
}

export function computeRotationTransformPoints(action: RotationTransformAction, pointer: Point): number[][] {
  if (action.kind === "move") {
    const dx = pointer.x - action.start.x
    const dy = pointer.y - action.start.y
    return action.originalPoints.map((item) => [item[0] + dx, item[1] + dy])
  }

  const vector = {
    x: pointer.x - action.center.x,
    y: pointer.y - action.center.y,
  }
  const projU = vector.x * action.axisU.x + vector.y * action.axisU.y
  const projV = vector.x * action.axisV.x + vector.y * action.axisV.y
  const halfW = Math.max(0.5, Math.abs(projU))
  const halfH = Math.max(0.5, Math.abs(projV))
  const c = action.center
  const u = action.axisU
  const v = action.axisV
  return [
    [c.x - u.x * halfW - v.x * halfH, c.y - u.y * halfW - v.y * halfH],
    [c.x + u.x * halfW - v.x * halfH, c.y + u.y * halfW - v.y * halfH],
    [c.x + u.x * halfW + v.x * halfH, c.y + u.y * halfW + v.y * halfH],
    [c.x - u.x * halfW + v.x * halfH, c.y - u.y * halfW + v.y * halfH],
  ]
}

export function computeRotationCenterAndStartAngle(pointer: Point, originalPoints: number[][]): { center: Point; startAngle: number } {
  const center = originalPoints.reduce((acc, p) => ({ x: acc.x + p[0] / 4, y: acc.y + p[1] / 4 }), { x: 0, y: 0 })
  const startAngle = Math.atan2(pointer.y - center.y, pointer.x - center.x)
  return { center, startAngle }
}

export function computePolygonVertexDragPoints(
  action: PolygonVertexDragAction,
  pointer: Point,
  originalPoints: number[][],
  imageSize: ImageSize,
): number[][] | null {
  if (originalPoints.length < 3 || action.vertexIndex < 0 || action.vertexIndex >= originalPoints.length) return null
  const x = Math.max(0, Math.min(imageSize.width, pointer.x))
  const y = Math.max(0, Math.min(imageSize.height, pointer.y))
  return originalPoints.map((item, index) => (index === action.vertexIndex ? [x, y] : [item[0], item[1]]))
}

/** 骨架：拖动单个关节，至少 1 个点 */
export function computeSkeletonVertexDragPoints(
  action: PolygonVertexDragAction,
  pointer: Point,
  originalPoints: number[][],
  imageSize: ImageSize,
): number[][] | null {
  if (originalPoints.length < 1 || action.vertexIndex < 0 || action.vertexIndex >= originalPoints.length) return null
  const x = Math.max(0, Math.min(imageSize.width, pointer.x))
  const y = Math.max(0, Math.min(imageSize.height, pointer.y))
  return originalPoints.map((item, index) => (index === action.vertexIndex ? [x, y] : [item[0], item[1]]))
}

/** 骨架：整体平移，至少 1 个点 */
export function computeSkeletonGroupDragPoints(
  action: PolygonDragAction,
  pointer: Point,
  imageSize: ImageSize,
): number[][] | null {
  if (action.originalPoints.length < 1) return null
  const dx = pointer.x - action.start.x
  const dy = pointer.y - action.start.y
  const xs = action.originalPoints.map((p) => p[0])
  const ys = action.originalPoints.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const clampedDx = Math.max(-minX, Math.min(imageSize.width - maxX, dx))
  const clampedDy = Math.max(-minY, Math.min(imageSize.height - maxY, dy))
  return action.originalPoints.map((p) => [p[0] + clampedDx, p[1] + clampedDy])
}

function clampImagePt(p: Point, imageSize: ImageSize): Point {
  return { x: Math.max(0, Math.min(imageSize.width, p.x)), y: Math.max(0, Math.min(imageSize.height, p.y)) }
}

function aabbFromFourCorners(corners: number[][]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = corners.map((c) => c[0]!)
  const ys = corners.map((c) => c[1]!)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** BL, BR, TR, TL（y 向下） */
function cornersBlBrTrTlFromAabb(a: { minX: number; maxX: number; minY: number; maxY: number }): number[][] {
  return [
    [a.minX, a.maxY],
    [a.maxX, a.maxY],
    [a.maxX, a.minY],
    [a.minX, a.minY],
  ]
}

function translationFrontToBack(snap: number[][]): [number, number] {
  return [snap[4]![0] - snap[0]![0], snap[4]![1] - snap[0]![1]]
}

/** 后面四点平移：用按下时后面的 min/max 与 delta 做边界钳制（勿用已加 delta 的包围盒算上界）。 */
function cuboidApplyTranslationToBack(snap: number[][], delta: Point, imageSize: ImageSize): number[][] {
  const front = snap.slice(0, 4)
  const back = snap.slice(4, 8)
  const minOx = Math.min(...back.map((p) => p[0]!))
  const maxOx = Math.max(...back.map((p) => p[0]!))
  const minOy = Math.min(...back.map((p) => p[1]!))
  const maxOy = Math.max(...back.map((p) => p[1]!))
  const clampedDx = Math.max(-minOx, Math.min(imageSize.width - maxOx, delta.x))
  const clampedDy = Math.max(-minOy, Math.min(imageSize.height - maxOy, delta.y))
  const nextBack = back.map((p) => [p[0]! + clampedDx, p[1]! + clampedDy])
  return [...front.map((p) => [p[0]!, p[1]!]), ...nextBack]
}

function cuboidResizeFrontCorner(snap: number[][], ci: number, pointer: Point, imageSize: ImageSize): number[][] | null {
  const T = translationFrontToBack(snap)
  const opp = (ci + 2) % 4
  const ox = snap[opp]![0]
  const oy = snap[opp]![1]
  const n = clampImagePt(pointer, imageSize)
  let minX = Math.min(ox, n.x)
  let maxX = Math.max(ox, n.x)
  let minY = Math.min(oy, n.y)
  let maxY = Math.max(oy, n.y)
  const minSize = CUBOID2D_MIN_FRONT_PX
  if (maxX - minX < minSize) {
    const mid = (minX + maxX) / 2
    minX = mid - minSize / 2
    maxX = mid + minSize / 2
  }
  if (maxY - minY < minSize) {
    const mid = (minY + maxY) / 2
    minY = mid - minSize / 2
    maxY = mid + minSize / 2
  }
  minX = Math.max(0, Math.min(imageSize.width - minSize, minX))
  maxX = Math.max(minX + minSize, Math.min(imageSize.width, maxX))
  minY = Math.max(0, Math.min(imageSize.height - minSize, minY))
  maxY = Math.max(minY + minSize, Math.min(imageSize.height, maxY))
  const NF = cornersBlBrTrTlFromAabb({ minX, maxX, minY, maxY })
  return [...NF, ...NF.map((p) => [p[0] + T[0], p[1] + T[1]])]
}

function cuboidResizeFrontEdge(snap: number[][], edgeIdx: number, pointer: Point, imageSize: ImageSize): number[][] | null {
  const T = translationFrontToBack(snap)
  const aabb = aabbFromFourCorners(snap.slice(0, 4))
  const q = clampImagePt(pointer, imageSize)
  let { minX, maxX, minY, maxY } = aabb
  const minSize = CUBOID2D_MIN_FRONT_PX
  if (edgeIdx === 0) maxY = Math.max(minY + minSize, Math.min(imageSize.height, q.y))
  else if (edgeIdx === 1) maxX = Math.max(minX + minSize, Math.min(imageSize.width, q.x))
  else if (edgeIdx === 2) minY = Math.max(0, Math.min(maxY - minSize, q.y))
  else if (edgeIdx === 3) minX = Math.max(0, Math.min(maxX - minSize, q.x))
  else return null
  if (maxX - minX < minSize || maxY - minY < minSize) return null
  const NF = cornersBlBrTrTlFromAabb({ minX, maxX, minY, maxY })
  return [...NF, ...NF.map((p) => [p[0] + T[0], p[1] + T[1]])]
}

/**
 * cuboid2d 八点编辑：
 * - 0–3 前面四角（轴对齐缩放，保持前后平移向量不变）
 * - 4–7 前面四边中点
 * - 8–10 后面一条竖边上的三控制点：整体平移后面四点
 */
export function computeCuboidHandleDragPoints(
  action: PolygonVertexDragAction,
  pointer: Point,
  originalPoints: number[][],
  imageSize: ImageSize,
): number[][] | null {
  if (originalPoints.length < 8) return null
  const snap = action.cuboidVertexStartSnapshot ?? originalPoints
  if (snap.length < 8) return null
  const vi = action.vertexIndex
  if (vi >= 0 && vi <= 3) return cuboidResizeFrontCorner(snap, vi, pointer, imageSize)
  if (vi >= 4 && vi <= 7) return cuboidResizeFrontEdge(snap, vi - 4, pointer, imageSize)
  if (vi >= 8 && vi <= 10) {
    const ps = action.cuboidPointerStart
    if (!ps) return null
    return cuboidApplyTranslationToBack(snap, { x: pointer.x - ps.x, y: pointer.y - ps.y }, imageSize)
  }
  return null
}

export function computePolygonDragPoints(action: PolygonDragAction, pointer: Point, imageSize: ImageSize): number[][] | null {
  if (action.originalPoints.length < 3) return null
  if (action.cuboidDragSubset === "back" && action.originalPoints.length >= 8) {
    const dx = pointer.x - action.start.x
    const dy = pointer.y - action.start.y
    return cuboidApplyTranslationToBack(action.originalPoints, { x: dx, y: dy }, imageSize)
  }
  const dx = pointer.x - action.start.x
  const dy = pointer.y - action.start.y
  const xs = action.originalPoints.map((p) => p[0])
  const ys = action.originalPoints.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const clampedDx = Math.max(-minX, Math.min(imageSize.width - maxX, dx))
  const clampedDy = Math.max(-minY, Math.min(imageSize.height - maxY, dy))
  return action.originalPoints.map((p) => [p[0] + clampedDx, p[1] + clampedDy])
}

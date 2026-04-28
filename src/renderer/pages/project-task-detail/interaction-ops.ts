import type { Point, RotationDragAction, RotationTransformAction, ShapeDragAction } from "@/pages/project-task-detail/types"
import { rotatePoint } from "@/pages/project-task-detail/utils"

type ImageSize = { width: number; height: number }

export function computeRectangleDragPoints(action: ShapeDragAction, pointer: Point, imageSize: ImageSize): number[][] | null {
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

  if (action.kind === "move") {
    minX = minX0 + dx
    maxX = maxX0 + dx
    minY = minY0 + dy
    maxY = maxY0 + dy
  } else {
    if (action.handle === "nw" || action.handle === "sw") minX = minX0 + dx
    if (action.handle === "ne" || action.handle === "se") maxX = maxX0 + dx
    if (action.handle === "nw" || action.handle === "ne") minY = minY0 + dy
    if (action.handle === "sw" || action.handle === "se") maxY = maxY0 + dy
  }

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

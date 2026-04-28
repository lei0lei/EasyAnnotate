import type { Point } from "@/pages/project-task-detail/types"

export type Size = { width: number; height: number }

export type ImageGeometry = {
  fitScale: number
  baseWidth: number
  baseHeight: number
  baseLeft: number
  baseTop: number
  stageWidth: number
  stageHeight: number
}

export type ViewTransform = {
  scale: number
  offset: Point
}

export function buildImageGeometry(naturalSize: Size, stageSize: Size): ImageGeometry | null {
  const naturalW = naturalSize.width
  const naturalH = naturalSize.height
  const stageW = stageSize.width
  const stageH = stageSize.height
  if (naturalW <= 0 || naturalH <= 0 || stageW <= 0 || stageH <= 0) return null
  const fitScale = Math.min(stageW / naturalW, stageH / naturalH)
  const baseWidth = naturalW * fitScale
  const baseHeight = naturalH * fitScale
  const baseLeft = (stageW - baseWidth) / 2
  const baseTop = (stageH - baseHeight) / 2
  return {
    fitScale,
    baseWidth,
    baseHeight,
    baseLeft,
    baseTop,
    stageWidth: stageW,
    stageHeight: stageH,
  }
}

export function imageToStagePoint(point: Point, geometry: ImageGeometry, transform: ViewTransform): Point {
  const xBase = point.x * geometry.fitScale
  const yBase = point.y * geometry.fitScale
  const x = ((xBase - geometry.baseWidth / 2) * transform.scale + geometry.baseWidth / 2) + geometry.baseLeft + transform.offset.x
  const y =
    ((yBase - geometry.baseHeight / 2) * transform.scale + geometry.baseHeight / 2) +
    geometry.baseTop +
    transform.offset.y
  return { x, y }
}

export function stageToImagePoint(
  stagePoint: Point,
  geometry: ImageGeometry,
  transform: ViewTransform,
  naturalSize: Size,
): Point {
  const xBase = (stagePoint.x - geometry.baseLeft - transform.offset.x - geometry.baseWidth / 2) / transform.scale + geometry.baseWidth / 2
  const yBase =
    (stagePoint.y - geometry.baseTop - transform.offset.y - geometry.baseHeight / 2) / transform.scale + geometry.baseHeight / 2
  const x = xBase / geometry.fitScale
  const y = yBase / geometry.fitScale
  const clampedX = Math.min(naturalSize.width, Math.max(0, x))
  const clampedY = Math.min(naturalSize.height, Math.max(0, y))
  return { x: clampedX, y: clampedY }
}

export function stageToImagePointStrict(
  stagePoint: Point,
  geometry: ImageGeometry,
  transform: ViewTransform,
  naturalSize: Size,
): Point | null {
  const xBase = (stagePoint.x - geometry.baseLeft - transform.offset.x - geometry.baseWidth / 2) / transform.scale + geometry.baseWidth / 2
  const yBase =
    (stagePoint.y - geometry.baseTop - transform.offset.y - geometry.baseHeight / 2) / transform.scale + geometry.baseHeight / 2
  const x = xBase / geometry.fitScale
  const y = yBase / geometry.fitScale
  if (x < 0 || x > naturalSize.width || y < 0 || y > naturalSize.height) return null
  return { x, y }
}

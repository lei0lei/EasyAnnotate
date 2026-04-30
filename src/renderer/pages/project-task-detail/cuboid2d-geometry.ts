/**
 * 模块：project-task-detail/cuboid2d-geometry
 * 职责：cuboid2d（前四后四）在图像/舞台坐标下的共用几何：深度偏移、八点序列、线框边、后竖边三控制点。
 * 边界：纯函数与常量，无 React、无标注文档类型。
 */
import type { Point } from "@/pages/project-task-detail/types"

/** 绘制与编辑共用的前面最小边长（像素） */
export const CUBOID2D_MIN_FRONT_PX = 4

/** 由前面矩形尺度推导默认「斜后方」平移（与编辑时保持的 T 一致语义） */
export function depthOffsetFromFrontRect(front: Point[]): { tx: number; ty: number } {
  const xs = front.map((p) => p.x)
  const ys = front.map((p) => p.y)
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  const s = Math.max(w, h, 1)
  return { tx: Math.max(10, s * 0.2), ty: Math.max(6, s * 0.12) }
}

/** 对角两点 → 前面四角 BL, BR, TR,TL（y 向下） */
export function aabbRectCornersFromDiagonal(a: Point, b: Point): Point[] {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return [
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
    { x: maxX, y: minY },
    { x: minX, y: minY },
  ]
}

export function backFacePointsFromFront(front: Point[]): Point[] {
  const { tx, ty } = depthOffsetFromFrontRect(front)
  return front.map((p) => ({ x: p.x + tx, y: p.y + ty }))
}

/** 前面四角（图像坐标）+ 平移得到后面 → 8 点整数数组，写入 shape.points */
export function parallelepiped8ImagePointsFromFront(front: Point[]): number[][] {
  const back = backFacePointsFromFront(front)
  return [...front, ...back].map((p) => [Math.round(p.x), Math.round(p.y)])
}

/**
 * 与前底面同顶点顺序的 12 条线段：每角一步为 [底边]、[后边]、[竖边]。
 * edgeIndex % 3 === 0 且 edgeIndex < 12 为前面矩形四条边。
 */
export function cuboidWireframeEdgeSegments(base: Point[], top: Point[]): [Point, Point][] {
  const segs: [Point, Point][] = []
  for (let i = 0; i < 4; i++) {
    const bi = base[i]
    const bj = base[(i + 1) % 4]
    const ti = top[i]
    const tj = top[(i + 1) % 4]
    if (bi && bj && ti && tj) {
      segs.push([bi, bj], [ti, tj], [bi, ti])
    }
  }
  return segs
}

export function isCuboidFrontFaceWireframeIndex(edgeIndex: number): boolean {
  return edgeIndex % 3 === 0 && edgeIndex < 12
}

/**
 * 与 `cuboidWireframeEdgeSegments` 同序，但拆成「后层 / 前层」：
 * 先画背面四边 + 竖边，再画前面四边（白边），避免背面线压在正面白线之上。
 */
export function cuboidWireframeEdgeSegmentsLayered(
  base: Point[],
  top: Point[],
): { behind: [Point, Point][]; front: [Point, Point][] } {
  const segs = cuboidWireframeEdgeSegments(base, top)
  const behind: [Point, Point][] = []
  const front: [Point, Point][] = []
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    if (isCuboidFrontFaceWireframeIndex(i)) front.push(seg)
    else behind.push(seg)
  }
  return { behind, front }
}

export type Cuboid2dHandleMarker = { cx: number; cy: number; handleIndex: number }

/** 前面四条边中点，handleIndex 4–7 */
export function cuboidFrontEdgeMidMarkers(base: Point[]): Cuboid2dHandleMarker[] {
  const mids: Cuboid2dHandleMarker[] = []
  for (let i = 0; i < 4; i++) {
    const p0 = base[i]
    const p1 = base[(i + 1) % 4]
    if (p0 && p1) mids.push({ cx: (p0.x + p1.x) / 2, cy: (p0.y + p1.y) / 2, handleIndex: 4 + i })
  }
  return mids
}

/**
 * 后表面相对前表面中心偏左或偏右时，在对应竖边上显示三点（8–10）。
 * 顶点顺序与 base/top 一致：0 BL, 1 BR, 2 TR, 3 TL。
 */
export function cuboidBackVerticalEdgeHandleMarkers(base: Point[], top: Point[]): Cuboid2dHandleMarker[] {
  if (base.length < 4 || top.length < 4) return []
  const cxF = (base[0]!.x + base[1]!.x + base[2]!.x + base[3]!.x) / 4
  const cxB = (top[0]!.x + top[1]!.x + top[2]!.x + top[3]!.x) / 4
  const showRight = cxB >= cxF
  const t0 = top[0]
  const t1 = top[1]
  const t2 = top[2]
  const t3 = top[3]
  if (showRight && t1 && t2) {
    return [
      { cx: t1.x, cy: t1.y, handleIndex: 8 },
      { cx: (t1.x + t2.x) / 2, cy: (t1.y + t2.y) / 2, handleIndex: 9 },
      { cx: t2.x, cy: t2.y, handleIndex: 10 },
    ]
  }
  if (!showRight && t0 && t3) {
    return [
      { cx: t0.x, cy: t0.y, handleIndex: 8 },
      { cx: (t0.x + t3.x) / 2, cy: (t0.y + t3.y) / 2, handleIndex: 9 },
      { cx: t3.x, cy: t3.y, handleIndex: 10 },
    ]
  }
  return []
}

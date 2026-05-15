/**
 * 将二值 mask 的外边界追踪为有序多边形（像素中心坐标，整数 x,y）。
 * 用于 YOLO segment 等需多边形轮廓的导出；孔洞只取最外圈。
 */
import { foregroundBBoxInclusive } from "./mask-raster-rle"

type Pt = { x: number; y: number }

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Andrew monotone chain，逆时针凸包 */
function convexHullMonotone(pts: Pt[]): Pt[] {
  if (pts.length <= 1) return [...pts]
  const sorted = [...pts].sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x))
  const lower: Pt[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * 点集的最小面积外接矩形四角（图像坐标），顺序沿矩形一周。
 * 用于 YOLO OBB；算法为凸包 + 旋转卡壳。
 */
export function minimumAreaBoundingBoxCornersFromPoints(pts: Pt[]): number[][] | null {
  if (pts.length === 0) return null
  if (pts.length === 1) {
    const p = pts[0]!
    const s = 0.5
    return [
      [p.x - s, p.y - s],
      [p.x + s, p.y - s],
      [p.x + s, p.y + s],
      [p.x - s, p.y + s],
    ]
  }
  const hull = pts.length === 2 ? pts : convexHullMonotone(pts)
  if (hull.length === 0) return null
  if (hull.length === 1) return minimumAreaBoundingBoxCornersFromPoints(hull)
  if (hull.length === 2) {
    const a = hull[0]!
    const b = hull[1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1e-6
    const ux = dx / len
    const uy = dy / len
    const fx = -uy
    const fy = ux
    const halfW = len / 2
    const halfH = 0.5
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return [
      [mid.x - ux * halfW - fx * halfH, mid.y - uy * halfW - fy * halfH],
      [mid.x + ux * halfW - fx * halfH, mid.y + uy * halfW - fy * halfH],
      [mid.x + ux * halfW + fx * halfH, mid.y + uy * halfW + fy * halfH],
      [mid.x - ux * halfW + fx * halfH, mid.y - uy * halfW + fy * halfH],
    ]
  }

  let minArea = Infinity
  let bestCorners: number[][] | null = null
  const n = hull.length
  for (let i = 0; i < n; i++) {
    const p0 = hull[i]!
    const p1 = hull[(i + 1) % n]!
    let ex = p1.x - p0.x
    let ey = p1.y - p0.y
    const el = Math.hypot(ex, ey)
    if (el < 1e-9) continue
    ex /= el
    ey /= el
    const fx = -ey
    const fy = ex
    let min0 = Infinity
    let max0 = -Infinity
    let min1 = Infinity
    let max1 = -Infinity
    for (const p of hull) {
      const t0 = (p.x - p0.x) * ex + (p.y - p0.y) * ey
      const t1 = (p.x - p0.x) * fx + (p.y - p0.y) * fy
      min0 = Math.min(min0, t0)
      max0 = Math.max(max0, t0)
      min1 = Math.min(min1, t1)
      max1 = Math.max(max1, t1)
    }
    const w0 = max0 - min0
    const h0 = max1 - min1
    const area = w0 * h0
    if (area < minArea) {
      minArea = area
      const c0x = p0.x + min0 * ex + min1 * fx
      const c0y = p0.y + min0 * ey + min1 * fy
      const c1x = p0.x + max0 * ex + min1 * fx
      const c1y = p0.y + max0 * ey + min1 * fy
      const c2x = p0.x + max0 * ex + max1 * fx
      const c2y = p0.y + max0 * ey + max1 * fy
      const c3x = p0.x + min0 * ex + max1 * fx
      const c3y = p0.y + min0 * ey + max1 * fy
      bestCorners = [
        [c0x, c0y],
        [c1x, c1y],
        [c2x, c2y],
        [c3x, c3y],
      ]
    }
  }
  return bestCorners
}

/** RLE 解码后的二值图 → 最小外接矩形四角 */
export function obbCornersFromMaskBinary(data: Uint8Array, w: number, h: number): number[][] | null {
  const contour = binaryMaskOuterContour(data, w, h)
  if (contour.length >= 3) {
    const pts = contour.map(([x, y]) => ({ x: x!, y: y! }))
    return minimumAreaBoundingBoxCornersFromPoints(pts)
  }
  const bb = foregroundBBoxInclusive(data, w, h)
  if (!bb) return null
  return [
    [bb.minX, bb.minY],
    [bb.maxX + 1, bb.minY],
    [bb.maxX + 1, bb.maxY + 1],
    [bb.minX, bb.maxY + 1],
  ]
}

/** 8 邻域，逆时针：从当前点看，顺序为 E, NE, N, NW, W, SW, S, SE（与下述回溯步进一致） */
const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, -1, -1, -1, 0, 1, 1, 1]

function fg(data: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && x < w && y >= 0 && y < h && data[y * w + x] !== 0
}

/**
 * Moore 邻域边界追踪：从「最上、其左」且北侧为背景的第一个前景点出发。
 * 返回闭合链（首尾同点由调用方决定是否去重）。
 */
export function binaryMaskOuterContour(data: Uint8Array, w: number, h: number): number[][] {
  let sx = -1
  let sy = -1
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (fg(data, w, h, x, y) && !fg(data, w, h, x, y - 1)) {
        sx = x
        sy = y
        break outer
      }
    }
  }
  if (sx < 0) return []

  const path: number[][] = []
  let x = sx
  let y = sy
  /** 进入 (x,y) 的方向：从上一格沿 dir 走到当前格，上一格为 (x-DX[dir], y-DY[dir]) */
  let enterDir = 7

  const maxSteps = w * h * 8 + 16
  for (let step = 0; step < maxSteps; step++) {
    path.push([x, y])
    /** 从「进入方向的反方向」的下一格开始逆时针找下一个前景点 */
    const start = (enterDir + 4 + 1) % 8
    let found = -1
    for (let i = 0; i < 8; i++) {
      const d = (start + i) % 8
      const nx = x + DX[d]!
      const ny = y + DY[d]!
      if (fg(data, w, h, nx, ny)) {
        found = d
        break
      }
    }
    if (found < 0) break
    const nx = x + DX[found]!
    const ny = y + DY[found]!
    enterDir = found
    x = nx
    y = ny
    if (x === sx && y === sy) break
  }

  if (path.length < 3) return path
  const a = path[0]
  const b = path[path.length - 1]
  if (a && b && a[0] === b[0] && a[1] === b[1]) path.pop()
  return path
}

/** Douglas–Peucker 简化，epsilon 为像素空间容差 */
export function simplifyPolygonRdp(points: number[][], epsilon: number): number[][] {
  if (points.length < 3) return points
  const eps = Math.max(0, epsilon)

  const dist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return Math.hypot(px - ax, py - ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)))
    const qx = ax + t * dx
    const qy = ay + t * dy
    return Math.hypot(px - qx, py - qy)
  }

  const rdp = (pts: number[][], i0: number, i1: number, out: number[][]): void => {
    if (i1 <= i0 + 1) return
    const p0 = pts[i0]
    const p1 = pts[i1]
    if (!p0 || !p1) return
    let im = i0
    let dm = 0
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i]
      if (!p) continue
      const d = dist(p[0]!, p[1]!, p0[0]!, p0[1]!, p1[0]!, p1[1]!)
      if (d > dm) {
        dm = d
        im = i
      }
    }
    if (dm > eps) {
      rdp(pts, i0, im, out)
      out.push(pts[im]!)
      rdp(pts, im, i1, out)
    }
  }

  const out: number[][] = [points[0]!]
  rdp(points, 0, points.length - 1, out)
  out.push(points[points.length - 1]!)
  return out
}

const MAX_YOLO_SEGMENT_POINTS = 320

export type ContourForYoloExportOptions = {
  /** Douglas–Peucker 容差（像素）；越大顶点越少 */
  rdpEpsilon?: number
  /** 超过则均匀抽稀，硬上限顶点数 */
  maxPoints?: number
}

/** 供导出：轮廓点过多时先 RDP 再均匀抽稀 */
export function contourForYoloExport(
  data: Uint8Array,
  w: number,
  h: number,
  options?: ContourForYoloExportOptions,
): number[][] {
  const rdpEpsilon = options?.rdpEpsilon ?? 1.2
  const maxPoints = options?.maxPoints ?? MAX_YOLO_SEGMENT_POINTS
  let poly = binaryMaskOuterContour(data, w, h)
  if (poly.length < 3) return poly
  poly = simplifyPolygonRdp(poly, rdpEpsilon)
  if (poly.length > maxPoints) {
    const step = Math.ceil(poly.length / maxPoints)
    const dec: number[][] = []
    for (let i = 0; i < poly.length; i += step) {
      const p = poly[i]
      if (p) dec.push(p)
    }
    if (dec.length >= 3) poly = dec
  }
  return poly
}

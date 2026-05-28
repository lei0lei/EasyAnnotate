/**
 * 扩散候选：按输出格式判断能否标注，并提取多边形顶点（与预览/提交一致）。
 */
import { contourForYoloExport } from "@/lib/mask-contour"
import { decodeRowMajorRleToBinary, maskBinaryHasForeground } from "@/lib/mask-raster-rle"
import type { DiffusionCandidateResult } from "@/lib/diffusion-annotation-runtime"
import type { Sam2AutoAnnotationFormat } from "@/pages/project-task-detail/annotateTools/aiTools/types"

export type DiffusionPolygonContourOptions = { rdpEpsilon: number; maxPoints: number }

function closeRing(ring: number[][]): number[][] {
  if (ring.length >= 2) {
    const a = ring[0]
    const b = ring[ring.length - 1]
    if (a && b && a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1)
  }
  return ring
}

function bboxToPolygonRing(x1: number, y1: number, x2: number, y2: number): number[][] {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ]
}

/** 从 mask 提轮廓；失败时用 bbox 四角作为矩形多边形（与 SAM 框一致）。 */
export function extractDiffusionPolygonRing(
  c: DiffusionCandidateResult,
  iw: number,
  ih: number,
  contourOptions: DiffusionPolygonContourOptions,
): number[][] | null {
  const { x1, y1, x2, y2 } = c.bbox
  if (x2 <= x1 || y2 <= y1) return null

  const d = c.rle
  if (d && d.w === iw && d.h === ih) {
    const bin = decodeRowMajorRleToBinary(d.counts, iw * ih)
    if (maskBinaryHasForeground(bin)) {
      let ring = contourForYoloExport(bin, iw, ih, contourOptions).map(
        ([x, y]) => [Math.round(x), Math.round(y)] as number[],
      )
      ring = closeRing(ring)
      if (ring.length >= 3) return ring
    }
  }

  return bboxToPolygonRing(
    Math.round(x1),
    Math.round(y1),
    Math.round(x2),
    Math.round(y2),
  )
}

export function isDiffusionCandidateAnnotatable(
  c: DiffusionCandidateResult,
  outputFormat: Sam2AutoAnnotationFormat,
  iw: number,
  ih: number,
  contourOptions: DiffusionPolygonContourOptions,
): boolean {
  const { x1, y1, x2, y2 } = c.bbox
  if (x2 <= x1 || y2 <= y1) return false

  if (outputFormat === "box") return true

  const d = c.rle
  if (!d || d.w !== iw || d.h !== ih) return false

  if (outputFormat === "polygon") {
    return extractDiffusionPolygonRing(c, iw, ih, contourOptions) != null
  }

  return false
}

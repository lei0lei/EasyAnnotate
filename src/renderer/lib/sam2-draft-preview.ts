import { contourForYoloExport } from "@/lib/mask-contour"
import { maskBinaryHasForeground } from "@/lib/mask-raster-rle"

/** 从二值 mask 提取 SAM2 预览多边形（原图坐标），供 SVG polygon 渲染。 */
export function buildSam2DraftPreviewRing(
  mask: { maskBinary: Uint8Array; w: number; h: number },
  fullW: number,
  fullH: number,
): number[][] | null {
  if (mask.w <= 0 || mask.h <= 0 || !maskBinaryHasForeground(mask.maskBinary)) return null
  const ring = contourForYoloExport(mask.maskBinary, mask.w, mask.h, { rdpEpsilon: 2.5, maxPoints: 96 })
  if (ring.length < 3) return null
  const sx = fullW / Math.max(1, mask.w)
  const sy = fullH / Math.max(1, mask.h)
  return ring.map(([x, y]) => [Math.round(x * sx), Math.round(y * sy)])
}

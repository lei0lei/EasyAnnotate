/**
 * 在 SVG 内用 foreignObject + canvas 绘制 RLE 二值 mask（与图像同分辨率）。
 */
import { decodeRowMajorRleToBinary } from "@/lib/mask-raster-rle"
import { useLayoutEffect, useRef } from "react"

type MaskRasterOverlayProps = {
  shapeId: string
  stageImageRect: { left: number; top: number; width: number; height: number }
  counts: number[]
  imageWidth: number
  imageHeight: number
  color: string
}

function parseRgb(color: string): { r: number; g: number; b: number } {
  const hex = color.trim()
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    if (hex.length === 7) {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b }
    } else {
      const r = Number.parseInt(hex[1]! + hex[1]!, 16)
      const g = Number.parseInt(hex[2]! + hex[2]!, 16)
      const b = Number.parseInt(hex[3]! + hex[3]!, 16)
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b }
    }
  }
  return { r: 245, g: 158, b: 11 }
}

export function MaskRasterOverlay({ shapeId, stageImageRect, counts, imageWidth, imageHeight, color }: MaskRasterOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { r, g, b } = parseRgb(color)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || imageWidth <= 0 || imageHeight <= 0) return
    canvas.width = imageWidth
    canvas.height = imageHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const total = imageWidth * imageHeight
    const bin = decodeRowMajorRleToBinary(counts, total)
    const img = ctx.createImageData(imageWidth, imageHeight)
    const data = img.data
    for (let i = 0; i < total; i += 1) {
      if (!bin[i]) continue
      const j = i * 4
      data[j] = r
      data[j + 1] = g
      data[j + 2] = b
      data[j + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [counts, imageHeight, imageWidth, r, g, b])

  const { left, top, width, height } = stageImageRect
  if (width < 1 || height < 1) return null

  return (
    <foreignObject
      key={`mask-raster-fo-${shapeId}`}
      x={left}
      y={top}
      width={width}
      height={height}
      pointerEvents="none"
    >
      <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: "100%", height: "100%", margin: 0, padding: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }}
        />
      </div>
    </foreignObject>
  )
}

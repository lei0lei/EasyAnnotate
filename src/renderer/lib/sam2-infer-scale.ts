/**
 * SAM2 推理缩放：编码在缩小后的图像上完成，prompt 与解码掩码在「原图像素」与「编码空间」之间映射。
 */
import type { Sam2CvatsPrompt } from "@/lib/sam2-cvat-onnx"
import type { Sam2EncodeImageResponse } from "@/lib/sam2-encode-api"
import { decodeRowMajorRleToBinary, encodeBinaryToRowMajorRle, maskBinaryHasForeground } from "@/lib/mask-raster-rle"

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

export function encodeSpaceSize(enc: Sam2EncodeImageResponse): { sw: number; sh: number; fw: number; fh: number } {
  const sw = enc.image_width
  const sh = enc.image_height
  const fw = enc.full_image_width ?? sw
  const fh = enc.full_image_height ?? sh
  return { sw, sh, fw, fh }
}

/** 将画布/原图坐标系下的 prompt 映射到 encode 响应的 image_width × image_height 空间（供 ORT decoder）。 */
export function mapFullImageSam2PromptToEncode(enc: Sam2EncodeImageResponse, ctx: Sam2DecodePromptCtx): Sam2CvatsPrompt | null {
  const { sw, sh, fw, fh } = encodeSpaceSize(enc)
  const iwm = Math.max(0, sw - 1)
  const ihm = Math.max(0, sh - 1)

  if (ctx.promptMode === "bbox") {
    if (!ctx.bbox) return null
    const b = ctx.bbox
    let x1 = clampInt((b.x1 * sw) / fw, 0, iwm)
    let y1 = clampInt((b.y1 * sh) / fh, 0, ihm)
    let x2 = clampInt((b.x2 * sw) / fw, 0, iwm)
    let y2 = clampInt((b.y2 * sh) / fh, 0, ihm)
    if (x2 < x1) {
      const t = x1
      x1 = x2
      x2 = t
    }
    if (y2 < y1) {
      const t = y1
      y1 = y2
      y2 = t
    }
    return { mode: "bbox", bbox: { x1, y1, x2, y2 } }
  }

  if (ctx.points.length === 0) return null
  return {
    mode: "point",
    points: ctx.points.map((p) => ({
      x: clampInt((p.x * sw) / fw, 0, iwm),
      y: clampInt((p.y * sh) / fh, 0, ihm),
      label: p.label as 0 | 1,
    })),
  }
}

export type Sam2DecodePromptCtx = {
  promptMode: "bbox" | "point"
  points: { x: number; y: number; label: number }[]
  bbox: { x1: number; y1: number; x2: number; y2: number } | null
}

function upscaleBinaryNearest(src: Uint8Array, sw: number, sh: number, fw: number, fh: number): Uint8Array {
  const dst = new Uint8Array(fw * fh)
  if (sw <= 0 || sh <= 0 || fw <= 0 || fh <= 0) return dst
  for (let y = 0; y < fh; y += 1) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / fh))
    const srcRow = sy * sw
    const dstRow = y * fw
    for (let x = 0; x < fw; x += 1) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / fw))
      dst[dstRow + x] = src[srcRow + sx]!
    }
  }
  return dst
}

/** 将 decoder 输出的编码分辨率 RLE 升采样到 full_image 尺寸（与画布/落盘一致）。 */
export function upscaleSam2DecoderRleToFullImageIfNeeded(
  rle: { counts: number[]; w: number; h: number },
  enc: Sam2EncodeImageResponse,
): { counts: number[]; w: number; h: number } | null {
  const { sw, sh, fw, fh } = encodeSpaceSize(enc)
  if (rle.w !== sw || rle.h !== sh) return null
  if (sw === fw && sh === fh) return rle
  const total = sw * sh
  const bin = decodeRowMajorRleToBinary(rle.counts, total)
  const up = upscaleBinaryNearest(bin, sw, sh, fw, fh)
  if (!maskBinaryHasForeground(up)) return null
  return { counts: encodeBinaryToRowMajorRle(up), w: fw, h: fh }
}

/**
 * 扩散标注：在已缓存的 SAM encode 上对 bbox 做 ORT 解码（全图坐标）。
 */
import type { Sam2EncodeImageResponse } from "@/lib/sam2-encode-api"
import { runSamCvatsDecoder } from "@/lib/sam2-cvat-onnx"
import { mapFullImageSam2PromptToEncode, upscaleSam2DecoderRleToFullImageIfNeeded } from "@/lib/sam2-infer-scale"

export type DiffusionSamBbox = { x1: number; y1: number; x2: number; y2: number }

export async function decodeSamBboxOnEncodeCache(
  enc: Sam2EncodeImageResponse,
  bbox: DiffusionSamBbox,
): Promise<{ counts: number[]; w: number; h: number } | null> {
  const prompt = mapFullImageSam2PromptToEncode(enc, {
    promptMode: "bbox",
    points: [],
    bbox,
  })
  if (!prompt) return null
  const rle = await runSamCvatsDecoder(enc, prompt)
  if (!rle) return null
  return upscaleSam2DecoderRleToFullImageIfNeeded(rle, enc)
}

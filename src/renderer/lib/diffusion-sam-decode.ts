/**
 * 扩散标注：在已 prepare 的 SAM session 上请求服务端 decode（全图坐标 mask）。
 */
import {
  decodeSamSession,
  samDecodeMaskFromResponse,
  type SamSessionCache,
} from "@/lib/sam2-session-api"

export type DiffusionSamBbox = { x1: number; y1: number; x2: number; y2: number }

const DIFFUSION_DECODE_OPTS = {
  includeMask: true,
  includePolygon: false,
} as const

export async function decodeSamBboxOnSession(
  cache: SamSessionCache,
  bbox: DiffusionSamBbox,
): Promise<{ maskBinary: Uint8Array; w: number; h: number } | null> {
  const res = await decodeSamSession({
    sessionId: cache.sessionId,
    promptMode: "bbox",
    points: [],
    bbox,
    ...DIFFUSION_DECODE_OPTS,
  })
  return samDecodeMaskFromResponse(res)
}

/** 候选框中心前景点 prompt（更接近手动画点 SAM）。 */
export async function decodeSamCenterPointOnSession(
  cache: SamSessionCache,
  bbox: DiffusionSamBbox,
): Promise<{ maskBinary: Uint8Array; w: number; h: number } | null> {
  const cx = Math.round((bbox.x1 + bbox.x2) * 0.5)
  const cy = Math.round((bbox.y1 + bbox.y2) * 0.5)
  const res = await decodeSamSession({
    sessionId: cache.sessionId,
    promptMode: "point",
    points: [{ x: cx, y: cy, label: 1 }],
    bbox: null,
    ...DIFFUSION_DECODE_OPTS,
  })
  return samDecodeMaskFromResponse(res)
}

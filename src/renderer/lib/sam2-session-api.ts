import {
  connectSamBackendWs,
  disconnectSamBackendWs,
  isSamBackendWsConnected,
  samBackendWsPrepareImage,
  samBackendWsRpc,
} from "@/lib/backend-sam-ws"
import { decodeBase64ToUint8Array } from "@/lib/base64-binary"
import { isHttpImageSource } from "@/lib/backend-image-upload"

export type SamSessionCache = {
  imagePath: string
  inferScale: number
  sessionId: string
  fullImageWidth: number
  fullImageHeight: number
  modelId: string
}

export type SamPrepareResponse = {
  session_id: string
  model_id: string
  feature_layout: string
  full_image_width: number
  full_image_height: number
  image_width: number
  image_height: number
  infer_scale: number
}

export class SamSessionHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "SamSessionHttpError"
    this.status = status
  }
}

function mapWsError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("session_not_found")) {
    throw new SamSessionHttpError(404, msg)
  }
  if (msg.includes("runtime_unavailable") || msg.includes("503")) {
    throw new SamSessionHttpError(503, msg)
  }
  throw err instanceof Error ? err : new Error(msg)
}

async function requireSamWsConnected(): Promise<void> {
  if (!(await isSamBackendWsConnected())) {
    throw new Error("SAM WebSocket 未连接，请确认已进入任务页且 SAM 已启动")
  }
}

export function sessionCacheFromPrepare(
  imagePath: string,
  inferScale: number,
  response: SamPrepareResponse,
): SamSessionCache {
  return {
    imagePath: imagePath.trim(),
    inferScale,
    sessionId: response.session_id,
    fullImageWidth: response.full_image_width,
    fullImageHeight: response.full_image_height,
    modelId: response.model_id,
  }
}

export type SamDecodePoint = { x: number; y: number; label: 0 | 1 }

export type SamDecodeRequest = {
  sessionId: string
  promptMode: "point" | "bbox"
  points: SamDecodePoint[]
  bbox: { x1: number; y1: number; x2: number; y2: number } | null
  minPredIou?: number
  polygonVertexBias?: number
  includeMask?: boolean
  includePolygon?: boolean
}

export type SamDecodeResponse = {
  ok: boolean
  pred_iou: number | null
  polygon: number[][] | null
  bbox: { x1: number; y1: number; x2: number; y2: number } | null
  message: string | null
  mask_base64?: string | null
  mask_width?: number | null
  mask_height?: number | null
}

export type Sam2DraftPreview = {
  polygon: number[][] | null
  bbox: { x1: number; y1: number; x2: number; y2: number } | null
}

export { getSamClientId } from "@/lib/sam-client-id"

export type PrepareSamSessionOptions = {
  inferScale?: number
  runtimeSlot?: string
}

export async function ensureSamSessionCache(
  imagePath: string,
  modelId: string,
  inferScale: number,
  existing: SamSessionCache | null,
): Promise<SamSessionCache> {
  const path = imagePath.trim()
  if (
    existing &&
    existing.imagePath === path &&
    (existing.inferScale ?? 1) === inferScale &&
    existing.modelId === modelId
  ) {
    return existing
  }
  const response = await prepareSamSession(modelId, path, { inferScale })
  return sessionCacheFromPrepare(path, inferScale, response)
}

export function samDecodeMaskFromResponse(
  res: SamDecodeResponse,
): { maskBinary: Uint8Array; w: number; h: number } | null {
  if (!res.ok || !res.mask_base64) return null
  const w = res.mask_width ?? 0
  const h = res.mask_height ?? 0
  if (w <= 0 || h <= 0) return null
  const u8 = decodeBase64ToUint8Array(res.mask_base64)
  if (u8.byteLength !== w * h) return null
  return { maskBinary: u8, w, h }
}

function decodePayloadFromWs(raw: Record<string, unknown>): SamDecodeResponse {
  return {
    ok: Boolean(raw.ok),
    pred_iou: (raw.pred_iou as number | null) ?? null,
    polygon: (raw.polygon as number[][] | null) ?? null,
    bbox: (raw.bbox as SamDecodeResponse["bbox"]) ?? null,
    message: (raw.message as string | null) ?? null,
    mask_base64: (raw.mask_base64 as string | null) ?? null,
    mask_width: (raw.mask_width as number | null) ?? null,
    mask_height: (raw.mask_height as number | null) ?? null,
  }
}

export async function prepareSamSession(
  modelId: string,
  source: string,
  options?: PrepareSamSessionOptions,
): Promise<SamPrepareResponse> {
  await requireSamWsConnected()
  if (isHttpImageSource(source)) {
    throw new Error("SAM WebSocket prepare 暂不支持 http(s) 图片 URL，请使用本地路径")
  }
  try {
    const inferScale =
      options?.inferScale !== undefined && Number.isFinite(options.inferScale)
        ? Math.min(1, Math.max(0.3, options.inferScale))
        : undefined
    const raw = await samBackendWsPrepareImage({
      modelId,
      imagePath: source,
      inferScale,
      runtimeSlot: options?.runtimeSlot,
    })
    return raw as SamPrepareResponse
  } catch (e) {
    mapWsError(e)
  }
}

export async function decodeSamSession(body: SamDecodeRequest): Promise<SamDecodeResponse> {
  await requireSamWsConnected()
  try {
    const raw = await samBackendWsRpc(
      "sam.decode",
      {
        session_id: body.sessionId,
        prompt_mode: body.promptMode,
        points: body.points.map((p) => ({ x: p.x, y: p.y, label: p.label })),
        bbox: body.bbox,
        min_pred_iou: body.minPredIou,
        polygon_vertex_bias: body.polygonVertexBias ?? 50,
        include_mask: body.includeMask ?? false,
        include_polygon: body.includePolygon ?? true,
      },
      180_000,
    )
    return decodePayloadFromWs(raw)
  } catch (e) {
    mapWsError(e)
  }
}

export type DecodeSamSessionWithRetryContext = {
  modelId: string
  imagePath: string
  inferScale: number
}

/** decode；session 404 时自动 prepare 并重试一次。 */
export async function decodeSamSessionWithRetry(
  body: SamDecodeRequest,
  retryPrepare: DecodeSamSessionWithRetryContext,
  onSessionRefreshed?: (cache: SamSessionCache) => void,
): Promise<SamDecodeResponse> {
  try {
    return await decodeSamSession(body)
  } catch (e) {
    const is404 = e instanceof SamSessionHttpError && e.status === 404
    if (!is404) throw e
    const prep = await prepareSamSession(retryPrepare.modelId, retryPrepare.imagePath, {
      inferScale: retryPrepare.inferScale,
    })
    const cache = sessionCacheFromPrepare(retryPrepare.imagePath, retryPrepare.inferScale, prep)
    onSessionRefreshed?.(cache)
    return decodeSamSession({ ...body, sessionId: cache.sessionId })
  }
}

export async function releaseSamSession(): Promise<void> {
  if (!(await isSamBackendWsConnected())) return
  try {
    await samBackendWsRpc("sam.release", {}, 15_000)
  } catch {
    // best-effort
  }
}

export { connectSamBackendWs, disconnectSamBackendWs, isSamBackendWsConnected }

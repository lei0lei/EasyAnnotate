import { apiV1Root, readFetchError } from "@/lib/backend-http"
import { decodeBase64ToUint8Array } from "@/lib/base64-binary"
import { isHttpImageSource, postLocalImageAsMultipart } from "@/lib/backend-image-upload"

const SAM_CLIENT_ID_KEY = "ea-sam-client-id"
const SAM_CLIENT_ID_HEADER = "X-Sam-Client-Id"

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
  /** 扩散式标注等需要二值 mask 时设为 true */
  includeMask?: boolean
  /** 为 false 时跳过多边形提取（批量 decode 更快） */
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

function samSessionHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    [SAM_CLIENT_ID_HEADER]: getSamClientId(),
  }
}

/** Stable per-install client id; backend allows one active SAM session per id. */
export function getSamClientId(): string {
  try {
    const existing = localStorage.getItem(SAM_CLIENT_ID_KEY)?.trim()
    if (existing) return existing
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sam-${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(SAM_CLIENT_ID_KEY, id)
    return id
  } catch {
    return `sam-fallback-${Date.now()}`
  }
}

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

export async function prepareSamSession(
  modelId: string,
  source: string,
  options?: PrepareSamSessionOptions,
): Promise<SamPrepareResponse> {
  let url = `${apiV1Root()}/sam/session/prepare`
  const rs = options?.runtimeSlot?.trim()
  if (rs) {
    url += `${url.includes("?") ? "&" : "?"}runtime_slot=${encodeURIComponent(rs)}`
  }
  const inferScale = options?.inferScale
  const payload: Record<string, unknown> = { model_id: modelId, source }
  if (inferScale !== undefined && Number.isFinite(inferScale)) {
    payload.infer_scale = Math.min(1, Math.max(0.3, inferScale))
  }

  let res: Response
  try {
    if (isHttpImageSource(source)) {
      res = await fetch(url, {
        method: "POST",
        headers: samSessionHeaders(),
        body: JSON.stringify(payload),
      })
    } else {
      let uploadUrl = `${apiV1Root()}/sam/session/prepare-upload`
      if (rs) {
        uploadUrl += `${uploadUrl.includes("?") ? "&" : "?"}runtime_slot=${encodeURIComponent(rs)}`
      }
      const uploadPayload: Record<string, unknown> = {
        sam_client_id: getSamClientId(),
        model_id: modelId,
      }
      if (inferScale !== undefined && Number.isFinite(inferScale)) {
        uploadPayload.infer_scale = Math.min(1, Math.max(0.3, inferScale))
      }
      res = await postLocalImageAsMultipart(uploadUrl, source, uploadPayload)
    }
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接 ${url}（${hint}）`)
  }
  if (!res.ok) {
    throw new SamSessionHttpError(res.status, `sam/session/prepare ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json() as Promise<SamPrepareResponse>
}

export async function decodeSamSession(body: SamDecodeRequest): Promise<SamDecodeResponse> {
  const url = `${apiV1Root()}/sam/session/decode`
  const payload = {
    session_id: body.sessionId,
    prompt_mode: body.promptMode,
    points: body.points.map((p) => ({ x: p.x, y: p.y, label: p.label })),
    bbox: body.bbox,
    min_pred_iou: body.minPredIou,
    polygon_vertex_bias: body.polygonVertexBias ?? 50,
    include_mask: body.includeMask ?? false,
    include_polygon: body.includePolygon ?? true,
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: samSessionHeaders(),
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接 ${url}（${hint}）`)
  }
  if (!res.ok) {
    throw new SamSessionHttpError(res.status, `sam/session/decode ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json() as Promise<SamDecodeResponse>
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
  const url = `${apiV1Root()}/sam/session`
  try {
    await fetch(url, {
      method: "DELETE",
      headers: { [SAM_CLIENT_ID_HEADER]: getSamClientId() },
    })
  } catch {
    // best-effort release
  }
}

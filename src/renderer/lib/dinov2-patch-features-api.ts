import { apiV1Root, encodeUrlPathSegments, readFetchError } from "@/lib/backend-http"
import { isHttpImageSource, postLocalImageAsMultipart } from "@/lib/backend-image-upload"

export type Dinov2TensorPayload = {
  dtype: string
  shape: number[]
  encoding: string
  data_base64: string
}

export type Dinov2LetterboxMeta = {
  orig_w: number
  orig_h: number
  scale: number
  pad_x: number
  pad_y: number
  letter_w: number
  letter_h: number
  img_size: number
}

export type Dinov2PatchFeaturesResponse = {
  model_id: string
  source: string
  device: string
  img_size: number
  grid_h: number
  grid_w: number
  dim: number
  letterbox: Dinov2LetterboxMeta
  patch_features: Dinov2TensorPayload
}

export function patchFeaturesUrlForModel(modelId: string): string {
  const tail = encodeUrlPathSegments(modelId)
  return `${apiV1Root()}/models/${tail}/patch-features`
}

export function patchFeaturesUploadUrlForModel(modelId: string): string {
  const tail = encodeUrlPathSegments(modelId)
  return `${apiV1Root()}/models/${tail}/patch-features-upload`
}

export async function fetchDinov2PatchFeatures(
  modelId: string,
  source: string,
  options?: { imgSize?: number },
): Promise<Dinov2PatchFeaturesResponse> {
  const url = patchFeaturesUrlForModel(modelId)
  const payload: Record<string, unknown> = { source }
  if (options?.imgSize !== undefined) {
    payload.img_size = options.imgSize
  }
  let res: Response
  try {
    if (isHttpImageSource(source)) {
      res = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      })
    } else {
      const uploadPayload: Record<string, unknown> = {}
      if (options?.imgSize !== undefined) {
        uploadPayload.img_size = options.imgSize
      }
      res = await postLocalImageAsMultipart(patchFeaturesUploadUrlForModel(modelId), source, uploadPayload)
    }
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接 ${url}（${hint}）`)
  }
  if (!res.ok) {
    throw new Error(`patch-features ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json() as Promise<Dinov2PatchFeaturesResponse>
}

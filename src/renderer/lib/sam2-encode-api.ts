import { apiV1Root, encodeUrlPathSegments, readFetchError } from "@/lib/backend-http"

export type Sam2TensorPayload = {
  dtype: string
  shape: number[]
  encoding: string
  data_base64: string
}

export type Sam2EncodeImageResponse = {
  model_id: string
  source: string
  device: string
  orig_hw: number[][]
  image_width: number
  image_height: number
  /** 原图宽高（与画布一致）；未返回时与 image_width/height 相同（旧后端或倍率 1） */
  full_image_width?: number
  full_image_height?: number
  image_embed: Sam2TensorPayload
  high_res_feats: Sam2TensorPayload[]
  /** 与 `export_sam21_cvat_decoder.py` / 浏览器 ORT 解码一致时为 `sam2.1_cvat_decoder_onnx_v1` */
  feature_layout?: string
  model_input_size?: number
  multimask_decoder?: boolean
  mask_input_height?: number
  mask_input_width?: number
}

export type Sam2EmbedCache = { imagePath: string; inferScale: number; response: Sam2EncodeImageResponse }

/** SAM2 decoder ONNX（与权重同目录的 `.decoder.onnx`）下载 URL；`assetId` 通常等于 `model_id`。 */
export function decoderOnnxUrlForAsset(assetId: string): string {
  const tail = encodeUrlPathSegments(assetId)
  return `${apiV1Root()}/model-assets/${tail}/decoder-onnx`
}

/** Path segment for model_id that may contain slashes (e.g. sam2/sam2.1_hiera_tiny). */
export function encodeImageUrlForModel(modelId: string): string {
  const tail = encodeUrlPathSegments(modelId)
  return `${apiV1Root()}/models/${tail}/encode-image`
}

/**
 * POST SAM2 encode-image：后端 CVAT/hashJoe 对齐的 encoder 特征（float32），供浏览器加载 `decoder.onnx` 解码。
 * 需已启动对应 `model_id` 的 runtime，且 `source` 为后端可读路径或 URL。
 */
export type FetchSam2ImageEmbeddingsOptions = {
  /** 相对原图的编码边长倍率，后端将等比缩小后再跑 encoder；默认 1 */
  inferScale?: number
}

export async function fetchSam2ImageEmbeddings(
  modelId: string,
  source: string,
  options?: FetchSam2ImageEmbeddingsOptions,
): Promise<Sam2EncodeImageResponse> {
  const url = encodeImageUrlForModel(modelId)
  const inferScale = options?.inferScale
  const payload: Record<string, unknown> = { source }
  if (inferScale !== undefined && Number.isFinite(inferScale)) {
    payload.infer_scale = Math.min(1, Math.max(0.3, inferScale))
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    })
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接 ${url}（${hint}）`)
  }
  if (!res.ok) {
    throw new Error(`encode-image ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json() as Promise<Sam2EncodeImageResponse>
}

import { apiV1Root, encodeUrlPathSegments, fetchWithTimeout, readFetchError } from "@/lib/backend-http"
import { yoloBatchPredictImageViaWs } from "@/lib/backend-yolo-batch-predict-ws"
import type { YoloBatchPredictResult } from "@/lib/yolo-predict-to-annotation"
import {
  uploadYoloBatchFileFromPathWithProgress,
  type YoloBatchUploadProgress,
} from "@/lib/yolo-batch-file-upload"
import { isYoloBatchRemoteBackend } from "@/lib/yolo-batch-backend"
import { probeBackendHealth } from "@/lib/training-yolo-api"

export type { YoloBatchUploadProgress } from "@/lib/yolo-batch-file-upload"

const FETCH_TIMEOUT_MS = 120_000

export type YoloBatchTaskId = "detect" | "segment" | "pose" | "obb"

export type YoloBatchModel = {
  model_slug: string
  model_dir: string
  display_name: string
  task: YoloBatchTaskId | string | null
  created_at?: string | null
  finalized_at?: string | null
  ready: boolean
  running?: boolean
  data_yaml: string | null
  weights_pt: string | null
  conf: number
  iou: number
  imgsz: number
  max_det: number
  use_gpu: boolean
  class_count?: number
}

function yoloBatchRoot(): string {
  return `${apiV1Root()}/yolo-batch`
}

export { probeBackendHealth }

export function modelNameToSlug(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return ""
  let slug = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
  slug = slug.replace(/\s+/g, "_").replace(/^\.+|\.+$/g, "")
  return slug.slice(0, 120)
}

export async function fetchYoloBatchCatalog(): Promise<{
  tasks: Array<{ id: YoloBatchTaskId; label: string }>
  model_temp_dir: string
}> {
  const res = await fetchWithTimeout(`${yoloBatchRoot()}/catalog`, undefined, FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

/** 检测当前连接的后端是否已挂载 `/api/v1/yolo-batch`（避免 404 Not Found）。 */
export async function probeYoloBatchApiAvailable(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${yoloBatchRoot()}/catalog`, undefined, 10_000)
    return res.ok
  } catch {
    return false
  }
}

/** 若内存中未加载则先启动（自动标注前调用，避免「模型未启动」）。 */
export async function ensureYoloBatchModelRunning(modelSlug: string): Promise<void> {
  const slug = modelSlug.trim()
  if (!slug) throw new Error("未选择模型")
  const status = await fetchYoloBatchStatus()
  if (status.running_models.includes(slug)) return
  await startYoloBatchModel(slug)
}

export async function fetchYoloBatchModels(): Promise<YoloBatchModel[]> {
  const res = await fetchWithTimeout(`${yoloBatchRoot()}/models`, undefined, FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { items: YoloBatchModel[] }
  return data.items ?? []
}

export async function fetchYoloBatchStatus(): Promise<{ running_models: string[]; count: number }> {
  const res = await fetchWithTimeout(`${yoloBatchRoot()}/status`, undefined, 10_000)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function prepareYoloBatchModel(body: {
  display_name: string
  task: YoloBatchTaskId
  conf: number
  iou: number
  imgsz: number
  max_det: number
  use_gpu: boolean
}): Promise<YoloBatchModel> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export type { YoloBatchUploadProgress } from "@/lib/yolo-batch-file-upload"

export async function uploadYoloBatchDataYamlFromPath(
  modelSlug: string,
  sourcePath: string,
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  await uploadYoloBatchFileFromPathWithProgress(modelSlug, "data_yaml", sourcePath, options)
}

export async function uploadYoloBatchWeightsFromPath(
  modelSlug: string,
  sourcePtPath: string,
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  await uploadYoloBatchFileFromPathWithProgress(modelSlug, "weights", sourcePtPath, options)
}

/** 本地/远程均经主进程 WebSocket 分片上传 data.yaml。 */
export async function transferYoloBatchDataYaml(
  modelSlug: string,
  input: { localPath?: string },
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  const path = input.localPath?.trim()
  if (!path) throw new Error("请选择 data.yaml 文件")
  await uploadYoloBatchDataYamlFromPath(modelSlug, path, options)
}

/** 本地/远程均经主进程 WebSocket 分片上传 .pt。 */
export async function transferYoloBatchWeights(
  modelSlug: string,
  input: { localPath?: string },
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  const path = input.localPath?.trim()
  if (!path) throw new Error("请选择 .pt 权重文件")
  await uploadYoloBatchWeightsFromPath(modelSlug, path, options)
}

export async function finalizeYoloBatchModel(modelSlug: string): Promise<YoloBatchModel> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/${encodeUrlPathSegments(modelSlug)}/finalize`,
    { method: "POST" },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function updateYoloBatchModel(
  modelSlug: string,
  patch: Partial<Pick<YoloBatchModel, "display_name" | "conf" | "iou" | "imgsz" | "max_det" | "use_gpu">>,
): Promise<YoloBatchModel> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/${encodeUrlPathSegments(modelSlug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function startYoloBatchModel(modelSlug: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/${encodeUrlPathSegments(modelSlug)}/start`,
    { method: "POST" },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function stopYoloBatchModel(modelSlug: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/${encodeUrlPathSegments(modelSlug)}/stop`,
    { method: "POST" },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function predictYoloBatchImage(
  modelSlug: string,
  imagePath: string,
): Promise<YoloBatchPredictResult> {
  const payload = await yoloBatchPredictImageViaWs(modelSlug.trim(), imagePath.trim(), FETCH_TIMEOUT_MS)
  return payload as YoloBatchPredictResult
}

export async function deleteYoloBatchModel(modelSlug: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/${encodeUrlPathSegments(modelSlug)}`,
    { method: "DELETE" },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export {
  getYoloBatchLocalBackendDir,
  isYoloBatchRemoteBackend,
  resolveYoloBatchBackendContext,
  type YoloBatchBackendContext,
} from "@/lib/yolo-batch-backend"

import { postLocalImageAsMultipart } from "@/lib/backend-image-upload"
import { apiV1Root, encodeUrlPathSegments, fetchWithTimeout, readFetchError } from "@/lib/backend-http"
import type { YoloBatchPredictResult } from "@/lib/yolo-predict-to-annotation"
import { uploadYoloBatchFileWithProgress, type YoloBatchUploadProgress } from "@/lib/yolo-batch-chunk-transfer"
import { getYoloBatchLocalBackendDir, isYoloBatchRemoteBackend } from "@/lib/yolo-batch-backend"
import { probeBackendHealth } from "@/lib/training-yolo-api"
import { ipc } from "@/gen/ipc"

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

export type { YoloBatchUploadProgress }

export async function confirmYoloBatchDataYaml(modelSlug: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/${encodeUrlPathSegments(modelSlug)}/data-yaml/confirm`,
    { method: "POST" },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function confirmYoloBatchWeights(modelSlug: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${yoloBatchRoot()}/models/${encodeUrlPathSegments(modelSlug)}/weights/confirm`,
    { method: "POST" },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

async function copyYoloBatchFileLocal(
  modelSlug: string,
  kind: "data_yaml" | "weights",
  sourcePath: string,
): Promise<void> {
  const backendDir = getYoloBatchLocalBackendDir()
  if (!backendDir) {
    throw new Error("请先在设置中配置本地 backend 目录")
  }
  const copy = await ipc.app.CopyYoloBatchModelFile({
    backendDirectory: backendDir,
    modelSlug,
    sourcePath,
    kind,
  })
  if (!copy.ok) {
    throw new Error(copy.errorMessage?.trim() || "复制文件到 backend 失败")
  }
  if (kind === "data_yaml") {
    await confirmYoloBatchDataYaml(modelSlug)
  } else {
    await confirmYoloBatchWeights(modelSlug)
  }
}

export async function uploadYoloBatchDataYaml(
  modelSlug: string,
  file: File,
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  if (!isYoloBatchRemoteBackend()) {
    throw new Error("本地后端请使用文件选择器复制到 backend 目录")
  }
  await uploadYoloBatchFileWithProgress(modelSlug, "data_yaml", file, {
    onProgress: options?.onProgress,
  })
}

export async function uploadYoloBatchWeights(
  modelSlug: string,
  file: File,
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  if (!isYoloBatchRemoteBackend()) {
    throw new Error("本地后端请使用文件选择器复制到 backend 目录")
  }
  await uploadYoloBatchFileWithProgress(modelSlug, "weights", file, {
    onProgress: options?.onProgress,
  })
}

/** 本地：从磁盘路径复制；远程：分片上传 File。 */
export async function transferYoloBatchDataYaml(
  modelSlug: string,
  input: { file?: File | null; localPath?: string },
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  if (isYoloBatchRemoteBackend()) {
    if (!input.file) throw new Error("请选择 data.yaml 文件")
    await uploadYoloBatchDataYaml(modelSlug, input.file, options)
    return
  }
  const path = input.localPath?.trim()
  if (!path) throw new Error("请选择 data.yaml 文件")
  await copyYoloBatchFileLocal(modelSlug, "data_yaml", path)
  options?.onProgress?.({ kind: "data_yaml", percent: 100 })
}

export async function transferYoloBatchWeights(
  modelSlug: string,
  input: { file?: File | null; localPath?: string },
  options?: { onProgress?: (p: YoloBatchUploadProgress) => void },
): Promise<void> {
  if (isYoloBatchRemoteBackend()) {
    if (!input.file) throw new Error("请选择 .pt 权重文件")
    await uploadYoloBatchWeights(modelSlug, input.file, options)
    return
  }
  const path = input.localPath?.trim()
  if (!path) throw new Error("请选择 .pt 权重文件")
  await copyYoloBatchFileLocal(modelSlug, "weights", path)
  options?.onProgress?.({ kind: "weights", percent: 100 })
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
  const slug = modelSlug.trim()
  const path = imagePath.trim()
  const base = `${yoloBatchRoot()}/models/${encodeUrlPathSegments(slug)}`
  if (isYoloBatchRemoteBackend()) {
    const res = await postLocalImageAsMultipart(`${base}/predict-upload`, path, undefined, FETCH_TIMEOUT_MS)
    return res.json() as Promise<YoloBatchPredictResult>
  }
  const res = await fetchWithTimeout(
    `${base}/predict?${new URLSearchParams({ image_path: path })}`,
    { method: "POST" },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json() as Promise<YoloBatchPredictResult>
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

import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import { fetchYoloMonitorResultImageBytes, yoloMonitorRpc } from "@/lib/backend-yolo-monitor-ws"
import { apiV1Root, encodeUrlPathSegments, fetchWithTimeout, readFetchError } from "@/lib/backend-http"

const YOLO_FETCH_TIMEOUT_MS = 60_000
const YOLO_LOGS_TIMEOUT_MS = 120_000

/** 训练进行中轮询间隔：仅拉 status/history 等小 JSON，避免高频大日志 IPC。 */
export const TRAINING_RUNNING_POLL_MS = 60_000

export type YoloFamilyId = "yolov8" | "yolo26"
export type YoloTaskId = "detect" | "segment" | "pose" | "obb" | "classify"

export type YoloCatalogModel = { asset_id: string; label: string }

export type YoloWorkspaceSnapshot = {
  job_slug: string
  job_dir: string
  display_name: string
  created_at?: string | null
  dataset_zip: string | null
  dataset_zip_filename?: string | null
  dataset_dir: string | null
  data_yaml: string | null
  base_model: string | null
  base_model_filename?: string | null
  base_model_asset_id?: string | null
  train_log?: string | null
  meta?: Record<string, unknown>
}

export type YoloTrainJob = {
  job_slug: string
  status: "idle" | "running" | "success" | "failed"
  progress: number
  message: string
  epoch: number
  epochs: number
  runs_dir: string | null
  last_error: string | null
}

export type YoloDeviceOption = {
  id: string
  label: string
  memory_total_bytes?: number | null
  memory_used_bytes?: number | null
}

export type YoloCudaEnvironment = {
  torch_cuda_device_count: number
  cuda_visible_devices: string
  nvidia_smi_gpu_count: number | null
}

export type YoloDevicesResponse = {
  devices: YoloDeviceOption[]
  environment: YoloCudaEnvironment | null
}

export type YoloHistoryItem = {
  job_slug: string
  display_name: string
  created_at: string
  status: string
  job_dir: string
  family?: string | null
  task?: string | null
  model_label?: string | null
  imgsz?: number | null
  progress?: number
  epoch?: number
  epochs?: number
}

/** @deprecated 训练页不再持久化会话；仅训练历史详情删除任务时清理遗留项。 */
export const YOLO_ACTIVE_JOB_STORAGE_KEY = "easyannotate.yolo.activeJobSlug"

function yoloRoot(): string {
  return `${apiV1Root()}/training/yolo`
}

export async function probeBackendHealth(): Promise<boolean> {
  const { protocol, host, port, remoteConnected, basePath } = loadAppConfig().backend
  try {
    if (remoteConnected) {
      const response = await ipc.app.ProbeRemoteBackendHealth({
        protocol: protocol === "https" ? "https" : "http",
        host: host.trim() || "127.0.0.1",
        port: (port.trim() || "8000").replace(/^:/, ""),
        basePath: basePath.trim(),
        timeoutMs: 5000,
      })
      return response.ok
    }
    const local = await ipc.app.GetLocalBackendStatus({})
    return local.reachable
  } catch {
    return false
  }
}

export async function fetchYoloTrainingCatalog(): Promise<{
  families: Array<{ id: string; label: string }>
  tasks: Array<{ id: string; label: string }>
}> {
  const res = await fetchWithTimeout(`${yoloRoot()}/catalog`, undefined, YOLO_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

/** 与 backend `sanitize_training_slug` 一致，用于前端同名检测。 */
export function trainingNameToJobSlug(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return ""
  let slug = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
  slug = slug.replace(/\s+/g, "_").replace(/^[._]+|[._]+$/g, "")
  return slug.slice(0, 120)
}

export async function fetchYoloTrainingHistory(): Promise<YoloHistoryItem[]> {
  const res = await fetchWithTimeout(`${yoloRoot()}/history`, undefined, YOLO_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { items: YoloHistoryItem[] }
  return data.items ?? []
}

export async function fetchYoloTrainingLogs(jobSlug: string): Promise<string> {
  const data = await yoloMonitorRpc("training.yolo.logs.get", { job_slug: jobSlug }, YOLO_LOGS_TIMEOUT_MS)
  return String(data.logs ?? "")
}

export type YoloTrainingResultImage = {
  path: string
  name: string
  mtime: number
  size: number
}

export type YoloTrainingResultImagesResponse = {
  job_slug: string
  runs_dir: string
  run_dir: string | null
  items: YoloTrainingResultImage[]
}

export async function fetchYoloTrainingResultImages(
  jobSlug: string,
): Promise<YoloTrainingResultImagesResponse> {
  const data = await yoloMonitorRpc("training.yolo.results.list", { job_slug: jobSlug }, YOLO_FETCH_TIMEOUT_MS)
  return {
    job_slug: String(data.job_slug ?? jobSlug),
    runs_dir: String(data.runs_dir ?? ""),
    run_dir: (data.run_dir as string | null | undefined) ?? null,
    items: Array.isArray(data.items) ? (data.items as YoloTrainingResultImage[]) : [],
  }
}

/** @deprecated 结果图经 WebSocket 拉取，不再使用 HTTP URL */
export function yoloTrainingResultImageUrl(jobSlug: string, imagePath: string, mtime?: number): string {
  const q = new URLSearchParams({ path: imagePath })
  if (mtime != null && mtime > 0) q.set("t", String(mtime))
  return `${yoloRoot()}/history/${encodeUrlPathSegments(jobSlug)}/results/image?${q}`
}

/** 经 IPC + WebSocket 拉取结果图并转为 blob URL。 */
export async function fetchYoloTrainingResultImageObjectUrl(
  jobSlug: string,
  imagePath: string,
  mtime?: number,
): Promise<string> {
  void mtime
  const { bytes, contentType } = await fetchYoloMonitorResultImageBytes(jobSlug, imagePath, YOLO_FETCH_TIMEOUT_MS)
  const blob = new Blob([new Uint8Array(bytes)], { type: contentType })
  return URL.createObjectURL(blob)
}

export type YoloTrainingModelFile = {
  path: string
  name: string
  kind: string
  mtime: number
  size: number
}

export type YoloTrainingModelFilesResponse = {
  job_slug: string
  job_dir: string
  items: YoloTrainingModelFile[]
}

export async function fetchYoloTrainingModelFiles(
  jobSlug: string,
): Promise<YoloTrainingModelFilesResponse> {
  const data = await yoloMonitorRpc("training.yolo.models.list", { job_slug: jobSlug }, YOLO_FETCH_TIMEOUT_MS)
  return {
    job_slug: String(data.job_slug ?? jobSlug),
    job_dir: String(data.job_dir ?? ""),
    items: Array.isArray(data.items) ? (data.items as YoloTrainingModelFile[]) : [],
  }
}

/** @deprecated 模型下载经 WebSocket 分片，不再使用 HTTP URL */
export function yoloTrainingModelDownloadUrl(jobSlug: string, filePath: string, mtime?: number): string {
  const q = new URLSearchParams({ path: filePath })
  if (mtime != null && mtime > 0) q.set("t", String(mtime))
  return `${yoloRoot()}/history/${encodeUrlPathSegments(jobSlug)}/models/file?${q}`
}

const YOLO_MODEL_DOWNLOAD_POLL_MS = 400
const YOLO_MODEL_DOWNLOAD_POLL_TIMEOUT_MS = 5 * 60 * 60 * 1000

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function downloadYoloTrainingModelWithSaveDialog(
  jobSlug: string,
  file: YoloTrainingModelFile,
): Promise<{ canceled: boolean; savedPath: string; errorMessage: string }> {
  const response = await ipc.app.DownloadYoloTrainingModel({
    jobSlug,
    filePath: file.path,
    suggestedFileName: file.name,
  })
  if (response.canceled) {
    return { canceled: true, savedPath: "", errorMessage: "" }
  }
  if (response.errorMessage?.trim()) {
    return { canceled: true, savedPath: "", errorMessage: response.errorMessage.trim() }
  }

  const downloadId = response.downloadId?.trim()
  if (!downloadId) {
    return { canceled: true, savedPath: "", errorMessage: "下载未启动" }
  }

  const deadline = Date.now() + YOLO_MODEL_DOWNLOAD_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleepMs(YOLO_MODEL_DOWNLOAD_POLL_MS)
    const status = await ipc.app.GetYoloModelDownloadStatus({ downloadId })
    if (status.status === "pending") continue
    if (status.status === "success") {
      return { canceled: false, savedPath: status.savedPath?.trim() || "", errorMessage: "" }
    }
    return {
      canceled: true,
      savedPath: "",
      errorMessage: status.errorMessage?.trim() || "下载失败",
    }
  }
  return { canceled: true, savedPath: "", errorMessage: "下载超时" }
}

export async function deleteYoloTrainingJob(jobSlug: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${yoloRoot()}/history/${encodeUrlPathSegments(jobSlug)}`,
    { method: "DELETE" },
    YOLO_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function prepareYoloTrainingJob(trainingName: string): Promise<{
  job_slug: string
  job_dir: string
  display_name: string
  created_at: string
}> {
  const res = await fetchWithTimeout(
    `${yoloRoot()}/jobs/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ training_name: trainingName }),
    },
    YOLO_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchYoloModels(family: YoloFamilyId, task: YoloTaskId): Promise<YoloCatalogModel[]> {
  const q = new URLSearchParams({ family, task })
  const res = await fetchWithTimeout(`${yoloRoot()}/models?${q}`, undefined, YOLO_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { models: YoloCatalogModel[] }
  return data.models ?? []
}

export async function fetchYoloWorkspace(jobSlug: string): Promise<YoloWorkspaceSnapshot> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetchWithTimeout(`${yoloRoot()}/workspace?${q}`, undefined, YOLO_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchYoloDevices(): Promise<YoloDevicesResponse> {
  const res = await fetchWithTimeout(`${yoloRoot()}/devices`, undefined, YOLO_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as {
    devices?: YoloDeviceOption[]
    environment?: Partial<YoloCudaEnvironment> | null
  }
  const envRaw = data.environment
  const environment =
    envRaw && typeof envRaw === "object"
      ? {
          torch_cuda_device_count: Math.max(0, Math.floor(Number(envRaw.torch_cuda_device_count) || 0)),
          cuda_visible_devices:
            typeof envRaw.cuda_visible_devices === "string" ? envRaw.cuda_visible_devices : "",
          nvidia_smi_gpu_count:
            envRaw.nvidia_smi_gpu_count == null
              ? null
              : Math.max(0, Math.floor(Number(envRaw.nvidia_smi_gpu_count) || 0)),
        }
      : null
  return { devices: data.devices ?? [], environment }
}

export async function fetchYoloTrainStatus(jobSlug: string): Promise<{ job: YoloTrainJob; workspace: YoloWorkspaceSnapshot }> {
  const data = await yoloMonitorRpc("training.yolo.status.get", { job_slug: jobSlug }, YOLO_FETCH_TIMEOUT_MS)
  return {
    job: data.job as YoloTrainJob,
    workspace: data.workspace as YoloWorkspaceSnapshot,
  }
}

export async function unpackYoloDataset(
  jobSlug: string,
  originalFilename?: string,
): Promise<{ data_yaml: string; dataset_zip_filename?: string | null }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  if (originalFilename?.trim()) {
    q.set("original_filename", originalFilename.trim())
  }
  const res = await fetchWithTimeout(
    `${yoloRoot()}/dataset/unpack?${q}`,
    { method: "POST" },
    YOLO_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export type YoloWeightMeta = {
  task: string | null
  family: string | null
  model_name: string | null
  source: string
}

export function weightMetaMatchesTrainingConfig(
  meta: YoloWeightMeta | null | undefined,
  family: YoloFamilyId,
  task: YoloTaskId,
): boolean {
  if (!meta) return false
  if (meta.task && meta.task !== task) return false
  if (meta.family && meta.family !== family) return false
  return true
}

export function weightMetaHasMismatch(
  meta: YoloWeightMeta | null | undefined,
  family: YoloFamilyId,
  task: YoloTaskId,
): boolean {
  if (!meta) return false
  if (meta.task && meta.task !== task) return true
  if (meta.family && meta.family !== family) return true
  return false
}

export type YoloWeightValidationResponse = {
  weight_meta: YoloWeightMeta | null
  weight_warnings: string[]
}

export function readWorkspaceWeightBinding(meta: Record<string, unknown> | undefined): {
  weightMeta: YoloWeightMeta | null
  savedFamily: string | null
  savedTask: string | null
  weightWarnings: string[]
} {
  if (!meta) return { weightMeta: null, savedFamily: null, savedTask: null, weightWarnings: [] }
  const rawWarnings = meta.base_model_weight_warnings
  const weightWarnings = Array.isArray(rawWarnings)
    ? rawWarnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    : []
  const raw = meta.base_model_weight_meta
  const weightMeta =
    raw && typeof raw === "object"
      ? ({
          task: typeof (raw as YoloWeightMeta).task === "string" ? (raw as YoloWeightMeta).task : null,
          family:
            typeof (raw as YoloWeightMeta).family === "string" ? (raw as YoloWeightMeta).family : null,
          model_name:
            typeof (raw as YoloWeightMeta).model_name === "string"
              ? (raw as YoloWeightMeta).model_name
              : null,
          source:
            typeof (raw as YoloWeightMeta).source === "string" ? (raw as YoloWeightMeta).source : "",
        } satisfies YoloWeightMeta)
      : null
  const savedFamily =
    typeof meta.base_model_family === "string" && meta.base_model_family.trim()
      ? meta.base_model_family
      : null
  const savedTask =
    typeof meta.base_model_task === "string" && meta.base_model_task.trim() ? meta.base_model_task : null
  return { weightMeta, savedFamily, savedTask, weightWarnings }
}

export async function selectYoloBaseModel(
  jobSlug: string,
  assetId: string,
  family: YoloFamilyId,
  task: YoloTaskId,
): Promise<YoloWeightValidationResponse> {
  const res = await fetchWithTimeout(
    `${yoloRoot()}/base-model/select`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_slug: jobSlug, asset_id: assetId, family, task }),
    },
    YOLO_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as {
    weight_meta?: YoloWeightMeta | null
    weight_warnings?: string[]
  }
  return {
    weight_meta: data.weight_meta ?? null,
    weight_warnings: data.weight_warnings ?? [],
  }
}

export async function uploadYoloBaseModelFromPath(
  jobSlug: string,
  sourcePtPath: string,
  family: YoloFamilyId,
  task: YoloTaskId,
): Promise<YoloWeightValidationResponse> {
  const globalConfigDir = loadAppConfig().storagePaths.globalConfigDir.trim()
  const res = await ipc.app.UploadYoloBaseModelFromPath({
    globalConfigDir,
    jobSlug,
    sourcePtPath,
    family,
    task,
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "上传权重失败")
  }
  const data = JSON.parse(res.responseJson || "{}") as {
    weight_meta?: YoloWeightMeta | null
    weight_warnings?: string[]
  }
  return {
    weight_meta: data.weight_meta ?? null,
    weight_warnings: data.weight_warnings ?? [],
  }
}

export async function validateYoloBaseModel(
  jobSlug: string,
  family: YoloFamilyId,
  task: YoloTaskId,
): Promise<YoloWeightValidationResponse> {
  const q = new URLSearchParams({ job_slug: jobSlug, family, task })
  const res = await fetchWithTimeout(
    `${yoloRoot()}/base-model/validate?${q}`,
    { method: "POST" },
    YOLO_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as YoloWeightValidationResponse
  return {
    weight_meta: data.weight_meta ?? null,
    weight_warnings: data.weight_warnings ?? [],
  }
}

export function formatWeightWarnings(warnings: string[]): string | null {
  if (!warnings.length) return null
  return warnings.join("；")
}

export async function startYoloTraining(
  jobSlug: string,
  payload: {
    epochs: number
    imgsz: number
    batch: number
    workers: number
    device: string
    time_hours: number | null
    use_custom_augment: boolean
    augment: Record<string, unknown> | null
    use_custom_optimizer: boolean
    optimizer: Record<string, unknown> | null
    export_onnx: boolean
    onnx_simplify: boolean
  },
): Promise<void> {
  const res = await fetchWithTimeout(
    `${yoloRoot()}/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_slug: jobSlug, ...payload }),
    },
    YOLO_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

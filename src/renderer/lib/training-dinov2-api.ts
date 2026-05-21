import { loadAppConfig } from "@/lib/app-config-storage"
import { apiV1Root, encodeUrlPathSegments, fetchWithTimeout, readFetchError } from "@/lib/backend-http"

const DINOV2_FETCH_TIMEOUT_MS = 60_000

export type Dinov2ObjectiveId = "linear_probe" | "fine_tune" | "partial_tune"

export type Dinov2CatalogModel = { asset_id: string; label: string }

export type Dinov2WorkspaceSnapshot = {
  job_slug: string
  job_dir: string
  display_name: string
  created_at?: string | null
  objective?: string | null
  dataset_zip: string | null
  dataset_zip_filename?: string | null
  dataset_dir: string | null
  dataset_ready: boolean
  dataset_image_count?: number
  base_model: string | null
  base_model_filename?: string | null
  base_model_asset_id?: string | null
  train_log?: string | null
  meta?: Record<string, unknown>
}

export type Dinov2TrainJob = {
  job_slug: string
  status: "idle" | "running" | "success" | "failed"
  progress: number
  message: string
  epoch: number
  epochs: number
  last_error: string | null
}

export type Dinov2DeviceOption = {
  id: string
  label: string
  memory_total_bytes?: number | null
  memory_used_bytes?: number | null
}

export type Dinov2HistoryItem = {
  job_slug: string
  display_name: string
  created_at: string
  status: string
  job_dir: string
  objective?: string | null
  model_label?: string | null
  progress?: number
}

function dinov2Root(): string {
  return `${apiV1Root()}/training/dinov2`
}

export { trainingNameToJobSlug, probeBackendHealth } from "@/lib/training-yolo-api"

export async function fetchDinov2TrainingCatalog(): Promise<{
  objectives: Array<{ id: Dinov2ObjectiveId; label: string }>
}> {
  const res = await fetchWithTimeout(`${dinov2Root()}/catalog`, undefined, DINOV2_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchDinov2TrainingHistory(): Promise<Dinov2HistoryItem[]> {
  const res = await fetchWithTimeout(`${dinov2Root()}/history`, undefined, DINOV2_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { items: Dinov2HistoryItem[] }
  return data.items ?? []
}

export async function prepareDinov2TrainingJob(trainingName: string): Promise<{
  job_slug: string
  job_dir: string
  display_name: string
  created_at: string
}> {
  const res = await fetchWithTimeout(
    `${dinov2Root()}/jobs/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ training_name: trainingName }),
    },
    DINOV2_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchDinov2Models(): Promise<Dinov2CatalogModel[]> {
  const res = await fetchWithTimeout(`${dinov2Root()}/models`, undefined, DINOV2_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { models: Dinov2CatalogModel[] }
  return data.models ?? []
}

export async function fetchDinov2Workspace(jobSlug: string): Promise<Dinov2WorkspaceSnapshot> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetchWithTimeout(`${dinov2Root()}/workspace?${q}`, undefined, DINOV2_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchDinov2Devices(): Promise<Dinov2DeviceOption[]> {
  const res = await fetchWithTimeout(`${dinov2Root()}/devices`, undefined, DINOV2_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { devices: Dinov2DeviceOption[] }
  return data.devices ?? []
}

export async function fetchDinov2TrainStatus(
  jobSlug: string,
): Promise<{ job: Dinov2TrainJob; workspace: Dinov2WorkspaceSnapshot }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetchWithTimeout(`${dinov2Root()}/status?${q}`, undefined, DINOV2_FETCH_TIMEOUT_MS)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function selectDinov2BaseModel(
  jobSlug: string,
  assetId: string,
  objective: Dinov2ObjectiveId,
): Promise<void> {
  const res = await fetchWithTimeout(
    `${dinov2Root()}/base-model/select`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_slug: jobSlug, asset_id: assetId, objective }),
    },
    DINOV2_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function uploadDinov2BaseModel(
  jobSlug: string,
  file: File,
  objective: Dinov2ObjectiveId,
  archAssetId?: string,
): Promise<void> {
  const form = new FormData()
  form.append("file", file)
  const q = new URLSearchParams({ job_slug: jobSlug, objective })
  if (archAssetId?.trim()) {
    q.set("arch_asset_id", archAssetId.trim())
  }
  const res = await fetchWithTimeout(
    `${dinov2Root()}/base-model/upload?${q}`,
    { method: "POST", body: form },
    DINOV2_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function unpackDinov2Dataset(
  jobSlug: string,
  originalFilename?: string,
): Promise<{ dataset_ready: boolean; dataset_image_count: number; dataset_zip_filename?: string | null }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  if (originalFilename?.trim()) {
    q.set("original_filename", originalFilename.trim())
  }
  const res = await fetchWithTimeout(
    `${dinov2Root()}/dataset/unpack?${q}`,
    { method: "POST" },
    DINOV2_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function uploadDinov2DatasetZip(
  jobSlug: string,
  file: File,
): Promise<{ dataset_ready: boolean; dataset_image_count: number; dataset_zip_filename?: string | null }> {
  const form = new FormData()
  form.append("file", file)
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetchWithTimeout(
    `${dinov2Root()}/dataset/upload?${q}`,
    { method: "POST", body: form },
    DINOV2_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export type Dinov2StartTrainParams = {
  epochs: number
  batch: number
  lr: number
  imgsz: number
  workers: number
  device: string
  freeze_backbone: boolean
  weight_decay: number
}

export async function startDinov2Training(jobSlug: string, params: Dinov2StartTrainParams): Promise<void> {
  const res = await fetchWithTimeout(
    `${dinov2Root()}/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_slug: jobSlug, ...params }),
    },
    DINOV2_FETCH_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
}

export function formatDinov2BackendEndpointLabel(): { mode: "local" | "remote"; label: string } {
  const { protocol, host, port, remoteConnected, basePath } = loadAppConfig().backend
  if (!remoteConnected) {
    return { mode: "local", label: "127.0.0.1:8000" }
  }
  const scheme = protocol === "https" ? "https" : "http"
  const h = host.trim() || "127.0.0.1"
  const p = (port.trim() || "8000").replace(/^:/, "")
  const base = basePath.trim()
    ? basePath.trim().startsWith("/")
      ? basePath.trim()
      : `/${basePath.trim()}`
    : ""
  return { mode: "remote", label: `${scheme}://${h}:${p}${base}` }
}

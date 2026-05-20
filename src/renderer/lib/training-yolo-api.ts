import { loadAppConfig } from "@/lib/app-config-storage"
import { apiV1Root, encodeUrlPathSegments, readFetchError } from "@/lib/backend-http"

export type YoloFamilyId = "yolov8" | "yolo26"
export type YoloTaskId = "detect" | "segment" | "pose" | "obb"

export type YoloCatalogModel = { asset_id: string; label: string }

export type YoloWorkspaceSnapshot = {
  job_slug: string
  job_dir: string
  display_name: string
  created_at?: string | null
  dataset_zip: string | null
  dataset_dir: string | null
  data_yaml: string | null
  base_model: string | null
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

export type YoloDeviceOption = { id: string; label: string }

export type YoloHistoryItem = {
  job_slug: string
  display_name: string
  created_at: string
  status: string
  job_dir: string
}

function yoloRoot(): string {
  return `${apiV1Root()}/training/yolo`
}

export async function probeBackendHealth(): Promise<boolean> {
  const { protocol, host, port, remoteConnected, basePath } = loadAppConfig().backend
  let origin: string
  if (!remoteConnected) {
    origin = "http://127.0.0.1:8000"
  } else {
    const scheme = protocol === "https" ? "https" : "http"
    origin = `${scheme}://${host.trim() || "127.0.0.1"}:${(port.trim() || "8000").replace(/^:/, "")}`
  }
  const base = basePath.trim() ? (basePath.trim().startsWith("/") ? basePath.trim() : `/${basePath.trim()}`) : ""
  try {
    const res = await fetch(`${origin}${base}/health`, { signal: AbortSignal.timeout(2500) })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchYoloTrainingCatalog(): Promise<{
  families: Array<{ id: string; label: string }>
  tasks: Array<{ id: string; label: string }>
}> {
  const res = await fetch(`${yoloRoot()}/catalog`)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchYoloTrainingHistory(): Promise<YoloHistoryItem[]> {
  const res = await fetch(`${yoloRoot()}/history`)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { items: YoloHistoryItem[] }
  return data.items ?? []
}

export async function fetchYoloTrainingLogs(jobSlug: string): Promise<string> {
  const res = await fetch(`${yoloRoot()}/history/${encodeUrlPathSegments(jobSlug)}/logs`)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { logs: string }
  return data.logs ?? ""
}

export async function prepareYoloTrainingJob(trainingName: string): Promise<{
  job_slug: string
  job_dir: string
  display_name: string
  created_at: string
}> {
  const res = await fetch(`${yoloRoot()}/jobs/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ training_name: trainingName }),
  })
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchYoloModels(family: YoloFamilyId, task: YoloTaskId): Promise<YoloCatalogModel[]> {
  const q = new URLSearchParams({ family, task })
  const res = await fetch(`${yoloRoot()}/models?${q}`)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { models: YoloCatalogModel[] }
  return data.models ?? []
}

export async function fetchYoloWorkspace(jobSlug: string): Promise<YoloWorkspaceSnapshot> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetch(`${yoloRoot()}/workspace?${q}`)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function fetchYoloDevices(): Promise<YoloDeviceOption[]> {
  const res = await fetch(`${yoloRoot()}/devices`)
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { devices: YoloDeviceOption[] }
  return data.devices ?? []
}

export async function fetchYoloTrainStatus(jobSlug: string): Promise<{ job: YoloTrainJob; workspace: YoloWorkspaceSnapshot }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetch(`${yoloRoot()}/status?${q}`)
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function unpackYoloDataset(jobSlug: string): Promise<{ data_yaml: string }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetch(`${yoloRoot()}/dataset/unpack?${q}`, { method: "POST" })
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

export async function uploadYoloDatasetZip(jobSlug: string, file: File): Promise<{ data_yaml: string }> {
  const form = new FormData()
  form.append("file", file)
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetch(`${yoloRoot()}/dataset/upload?${q}`, { method: "POST", body: form })
  if (!res.ok) throw new Error(await readFetchError(res))
  const data = (await res.json()) as { data_yaml: string }
  return { data_yaml: data.data_yaml }
}

export async function selectYoloBaseModel(jobSlug: string, assetId: string): Promise<void> {
  const res = await fetch(`${yoloRoot()}/base-model/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_slug: jobSlug, asset_id: assetId }),
  })
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function uploadYoloBaseModel(jobSlug: string, file: File): Promise<void> {
  const form = new FormData()
  form.append("file", file)
  const q = new URLSearchParams({ job_slug: jobSlug })
  const res = await fetch(`${yoloRoot()}/base-model/upload?${q}`, { method: "POST", body: form })
  if (!res.ok) throw new Error(await readFetchError(res))
}

export async function startYoloTraining(
  jobSlug: string,
  payload: {
    epochs: number
    imgsz: number
    batch: number
    device: string
    patience: number
  },
): Promise<void> {
  const res = await fetch(`${yoloRoot()}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_slug: jobSlug, ...payload }),
  })
  if (!res.ok) throw new Error(await readFetchError(res))
}

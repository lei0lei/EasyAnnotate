import { apiV1Root, encodeUrlPathSegments, fetchWithTimeout, readFetchError } from "@/lib/backend-http"

/** 与后端 ``yolo_chunk_transfer.CHUNK_SIZE`` 一致 */
export const YOLO_CHUNK_SIZE = 5 * 1024 * 1024

/** 数据集分片上传整次任务（含续传）最长 5 小时 */
export const YOLO_DATASET_UPLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000

/** 模型分片下载整次任务最长 5 小时 */
export const YOLO_MODEL_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000

const CHUNK_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000

export type YoloDatasetUploadPhase = "uploading" | "unpacking"

export type YoloDatasetUploadProgress = {
  phase: YoloDatasetUploadPhase
  percent: number
}

type DatasetUploadInitResponse = {
  upload_id: string
  chunk_size: number
  total_size: number
  total_chunks: number
  uploaded_chunks: number[]
  missing_chunks: number[]
}

function yoloDatasetUploadInitUrl(): string {
  return `${apiV1Root()}/training/yolo/dataset/upload/init`
}

function yoloDatasetUploadChunkUrl(jobSlug: string, uploadId: string, chunkIndex: number): string {
  const q = new URLSearchParams({
    job_slug: jobSlug,
    upload_id: uploadId,
    chunk_index: String(chunkIndex),
  })
  return `${apiV1Root()}/training/yolo/dataset/upload/chunk?${q}`
}

function yoloDatasetUploadCompleteUrl(jobSlug: string, uploadId: string): string {
  const q = new URLSearchParams({ job_slug: jobSlug, upload_id: uploadId })
  return `${apiV1Root()}/training/yolo/dataset/upload/complete?${q}`
}

function uploadResumeStorageKey(jobSlug: string, file: File): string {
  return `easyannotate.yolo.upload:${jobSlug}:${file.name}:${file.size}:${file.lastModified}`
}

export function yoloModelDownloadInfoUrl(jobSlug: string, modelPath: string): string {
  const q = new URLSearchParams({ path: modelPath })
  return `${apiV1Root()}/training/yolo/history/${encodeUrlPathSegments(jobSlug)}/models/download-info?${q}`
}

export async function fetchYoloModelDownloadInfo(
  jobSlug: string,
  modelPath: string,
): Promise<{ total_size: number; chunk_size: number; total_chunks: number; filename: string }> {
  const res = await fetchWithTimeout(
    yoloModelDownloadInfoUrl(jobSlug, modelPath),
    undefined,
    60_000,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json() as Promise<{
    total_size: number
    chunk_size: number
    total_chunks: number
    filename: string
  }>
}

export async function uploadYoloDatasetZipWithProgress(
  jobSlug: string,
  file: File,
  options?: {
    onProgress?: (progress: YoloDatasetUploadProgress) => void
    timeoutMs?: number
  },
): Promise<{ data_yaml: string; dataset_zip_filename?: string | null }> {
  const timeoutMs = options?.timeoutMs ?? YOLO_DATASET_UPLOAD_TIMEOUT_MS
  const onProgress = options?.onProgress
  const deadline = Date.now() + timeoutMs
  const totalChunks = Math.ceil(file.size / YOLO_CHUNK_SIZE)

  const resumeKey = uploadResumeStorageKey(jobSlug, file)
  let uploadId = sessionStorage.getItem(resumeKey) ?? ""

  const initBody: Record<string, unknown> = {
    job_slug: jobSlug,
    filename: file.name,
    total_size: file.size,
  }
  if (uploadId) initBody.upload_id = uploadId

  const initRes = await fetchWithTimeout(
    yoloDatasetUploadInitUrl(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initBody),
    },
    60_000,
  )
  if (!initRes.ok) throw new Error(await readFetchError(initRes))
  const init = (await initRes.json()) as DatasetUploadInitResponse
  uploadId = init.upload_id
  sessionStorage.setItem(resumeKey, uploadId)

  const missing =
    init.missing_chunks?.length > 0
      ? [...init.missing_chunks].sort((a, b) => a - b)
      : Array.from({ length: totalChunks }, (_, i) => i)

  const uploadedSet = new Set(init.uploaded_chunks ?? [])

  for (let i = 0; i < missing.length; i++) {
    if (Date.now() > deadline) {
      throw new Error(`上传超时（超过 ${Math.round(timeoutMs / 60_000)} 分钟）`)
    }
    const chunkIndex = missing[i]!
    const start = chunkIndex * YOLO_CHUNK_SIZE
    const end = Math.min(start + YOLO_CHUNK_SIZE, file.size)
    const blob = file.slice(start, end)

    const chunkRes = await fetchWithTimeout(
      yoloDatasetUploadChunkUrl(jobSlug, uploadId, chunkIndex),
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      },
      CHUNK_UPLOAD_TIMEOUT_MS,
    )
    if (!chunkRes.ok) throw new Error(await readFetchError(chunkRes))

    uploadedSet.add(chunkIndex)
    const doneCount = uploadedSet.size
    const ratio = doneCount / totalChunks
    const percent = Math.min(90, Math.max(0, Math.round(ratio * 90)))
    onProgress?.({ phase: "uploading", percent })
  }

  onProgress?.({ phase: "unpacking", percent: 92 })

  const completeRes = await fetchWithTimeout(
    yoloDatasetUploadCompleteUrl(jobSlug, uploadId),
    { method: "POST" },
    30 * 60_000,
  )
  if (!completeRes.ok) throw new Error(await readFetchError(completeRes))

  sessionStorage.removeItem(resumeKey)
  onProgress?.({ phase: "unpacking", percent: 100 })

  const data = (await completeRes.json()) as {
    data_yaml?: string
    dataset_zip_filename?: string | null
  }
  if (!data.data_yaml) throw new Error("上传完成但响应缺少 data_yaml")
  return {
    data_yaml: data.data_yaml,
    dataset_zip_filename: data.dataset_zip_filename,
  }
}

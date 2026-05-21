import { apiV1Root, encodeUrlPathSegments, fetchWithTimeout, readFetchError } from "@/lib/backend-http"

/** 与后端 ``yolo_batch_chunk_transfer.CHUNK_SIZE`` 一致 */
export const YOLO_BATCH_CHUNK_SIZE = 5 * 1024 * 1024

export const YOLO_BATCH_UPLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000

const CHUNK_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000

export type YoloBatchUploadKind = "data_yaml" | "weights"

export type YoloBatchUploadProgress = {
  kind: YoloBatchUploadKind
  percent: number
}

type ChunkUploadInitResponse = {
  upload_id: string
  chunk_size: number
  total_size: number
  total_chunks: number
  uploaded_chunks: number[]
  missing_chunks: number[]
}

function uploadResumeStorageKey(modelSlug: string, kind: YoloBatchUploadKind, file: File): string {
  return `easyannotate.yoloBatch.upload:${modelSlug}:${kind}:${file.name}:${file.size}:${file.lastModified}`
}

function initUrl(modelSlug: string, kind: YoloBatchUploadKind): string {
  const segment = kind === "data_yaml" ? "data-yaml" : "weights"
  return `${apiV1Root()}/yolo-batch/models/${encodeUrlPathSegments(modelSlug)}/${segment}/upload/init`
}

function chunkUrl(modelSlug: string, kind: YoloBatchUploadKind, uploadId: string, chunkIndex: number): string {
  const segment = kind === "data_yaml" ? "data-yaml" : "weights"
  const q = new URLSearchParams({
    upload_id: uploadId,
    chunk_index: String(chunkIndex),
  })
  return `${apiV1Root()}/yolo-batch/models/${encodeUrlPathSegments(modelSlug)}/${segment}/upload/chunk?${q}`
}

function completeUrl(modelSlug: string, kind: YoloBatchUploadKind, uploadId: string): string {
  const segment = kind === "data_yaml" ? "data-yaml" : "weights"
  const q = new URLSearchParams({ upload_id: uploadId })
  return `${apiV1Root()}/yolo-batch/models/${encodeUrlPathSegments(modelSlug)}/${segment}/upload/complete?${q}`
}

export async function uploadYoloBatchFileWithProgress(
  modelSlug: string,
  kind: YoloBatchUploadKind,
  file: File,
  options?: {
    onProgress?: (progress: YoloBatchUploadProgress) => void
    timeoutMs?: number
  },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? YOLO_BATCH_UPLOAD_TIMEOUT_MS
  const onProgress = options?.onProgress
  const deadline = Date.now() + timeoutMs
  const totalChunks = Math.ceil(file.size / YOLO_BATCH_CHUNK_SIZE)

  const resumeKey = uploadResumeStorageKey(modelSlug, kind, file)
  let uploadId = sessionStorage.getItem(resumeKey) ?? ""

  const initBody: Record<string, unknown> = {
    filename: file.name,
    total_size: file.size,
  }
  if (uploadId) initBody.upload_id = uploadId

  const initRes = await fetchWithTimeout(
    initUrl(modelSlug, kind),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initBody),
    },
    60_000,
  )
  if (!initRes.ok) throw new Error(await readFetchError(initRes))
  const init = (await initRes.json()) as ChunkUploadInitResponse
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
    const start = chunkIndex * YOLO_BATCH_CHUNK_SIZE
    const end = Math.min(start + YOLO_BATCH_CHUNK_SIZE, file.size)
    const blob = file.slice(start, end)

    const chunkRes = await fetchWithTimeout(
      chunkUrl(modelSlug, kind, uploadId, chunkIndex),
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      },
      CHUNK_UPLOAD_TIMEOUT_MS,
    )
    if (!chunkRes.ok) throw new Error(await readFetchError(chunkRes))

    uploadedSet.add(chunkIndex)
    const ratio = uploadedSet.size / totalChunks
    const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)))
    onProgress?.({ kind, percent })
  }

  const completeRes = await fetchWithTimeout(
    completeUrl(modelSlug, kind, uploadId),
    { method: "POST" },
    30 * 60_000,
  )
  if (!completeRes.ok) throw new Error(await readFetchError(completeRes))

  sessionStorage.removeItem(resumeKey)
  onProgress?.({ kind, percent: 100 })
}

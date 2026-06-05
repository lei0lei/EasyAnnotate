import { apiV1Root, encodeUrlPathSegments, fetchWithTimeout, readFetchError } from "@/lib/backend-http"

/** 与后端 ``yolo_chunk_transfer.CHUNK_SIZE`` 一致 */
export const YOLO_CHUNK_SIZE = 5 * 1024 * 1024

/** 数据集 WebSocket 分片上传整次任务（含续传）最长 5 小时 */
export const YOLO_DATASET_UPLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000

/** 模型分片下载整次任务最长 5 小时 */
export const YOLO_MODEL_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000

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

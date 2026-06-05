import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import {
  uploadYoloDatasetZipWithProgress,
  YOLO_DATASET_UPLOAD_TIMEOUT_MS,
  type YoloDatasetUploadPhase,
  type YoloDatasetUploadProgress,
} from "@/lib/yolo-chunk-transfer"
import { apiV1Root, fetchWithTimeout, readFetchError } from "@/lib/backend-http"

export {
  uploadYoloDatasetZipWithProgress,
  YOLO_DATASET_UPLOAD_TIMEOUT_MS,
  type YoloDatasetUploadPhase,
  type YoloDatasetUploadProgress,
}

/** 本地选文件后仅解压 */
export const YOLO_DATASET_UNPACK_TIMEOUT_MS = 30 * 60 * 1000

const UPLOAD_JOB_POLL_MS = 1500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** 主进程从磁盘分片上传（远程/大文件），避免渲染进程 IPC 传 5MB 分片导致闪退。 */
export async function uploadYoloDatasetZipFromPathWithProgress(
  jobSlug: string,
  sourceZipPath: string,
  options?: {
    onProgress?: (progress: YoloDatasetUploadProgress) => void
    timeoutMs?: number
  },
): Promise<{ data_yaml: string; dataset_zip_filename?: string | null }> {
  const timeoutMs = options?.timeoutMs ?? YOLO_DATASET_UPLOAD_TIMEOUT_MS
  const onProgress = options?.onProgress
  const globalConfigDir = loadAppConfig().storagePaths.globalConfigDir.trim()

  const started = await ipc.app.StartYoloDatasetZipUpload({
    globalConfigDir,
    jobSlug,
    sourceZipPath,
  })
  if (!started.jobId?.trim()) {
    throw new Error(started.errorMessage?.trim() || "无法启动数据集上传")
  }

  const deadline = Date.now() + timeoutMs
  const jobId = started.jobId.trim()

  while (Date.now() < deadline) {
    const snapshot = await ipc.app.GetYoloDatasetZipUploadJob({ jobId })
    if (!snapshot.found || !snapshot.job) {
      throw new Error(snapshot.errorMessage?.trim() || "上传任务不存在")
    }
    const job = snapshot.job
    const phase: YoloDatasetUploadPhase =
      job.phase === "unpacking" ? "unpacking" : "uploading"
    onProgress?.({ phase, percent: Math.max(0, Math.min(100, job.progress ?? 0)) })

    if (job.status === "success") {
      if (!job.dataYaml?.trim()) throw new Error("上传完成但缺少 data_yaml")
      return {
        data_yaml: job.dataYaml,
        dataset_zip_filename: job.datasetZipFilename || undefined,
      }
    }
    if (job.status === "failed") {
      throw new Error(job.errorMessage?.trim() || job.message?.trim() || "上传失败")
    }
    await sleep(UPLOAD_JOB_POLL_MS)
  }

  throw new Error(`上传超时（超过 ${Math.round(timeoutMs / 60_000)} 分钟）`)
}

export function formatYoloBackendEndpointLabel(): { mode: "local" | "remote"; label: string } {
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

export async function unpackYoloDatasetWithTimeout(
  jobSlug: string,
  originalFilename?: string,
  timeoutMs: number = YOLO_DATASET_UNPACK_TIMEOUT_MS,
): Promise<{ data_yaml: string; dataset_zip_filename?: string | null }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  if (originalFilename?.trim()) {
    q.set("original_filename", originalFilename.trim())
  }
  const res = await fetchWithTimeout(
    `${apiV1Root()}/training/yolo/dataset/unpack?${q}`,
    { method: "POST" },
    timeoutMs,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

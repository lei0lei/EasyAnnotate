import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"

export type YoloBatchUploadKind = "data_yaml" | "weights"

export type YoloBatchUploadProgress = {
  kind: YoloBatchUploadKind
  percent: number
}

export const YOLO_BATCH_FILE_UPLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000

const UPLOAD_JOB_POLL_MS = 400

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** 主进程从磁盘经 WebSocket 分片上传（本地/远程同一通道）。 */
export async function uploadYoloBatchFileFromPathWithProgress(
  modelSlug: string,
  kind: YoloBatchUploadKind,
  sourcePath: string,
  options?: {
    onProgress?: (progress: YoloBatchUploadProgress) => void
    timeoutMs?: number
  },
): Promise<{ data_yaml?: string; weights_pt?: string }> {
  const timeoutMs = options?.timeoutMs ?? YOLO_BATCH_FILE_UPLOAD_TIMEOUT_MS
  const onProgress = options?.onProgress
  const globalConfigDir = loadAppConfig().storagePaths.globalConfigDir.trim()

  const started = await ipc.app.StartYoloBatchFileUpload({
    globalConfigDir,
    modelSlug,
    sourcePath,
    kind,
  })
  if (!started.jobId?.trim()) {
    throw new Error(started.errorMessage?.trim() || "无法启动文件上传")
  }

  const jobId = started.jobId.trim()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(UPLOAD_JOB_POLL_MS)
    const res = await ipc.app.GetYoloBatchFileUploadJob({ jobId })
    if (!res.found || !res.job) continue
    const job = res.job
    if (job.status === "running") {
      onProgress?.({ kind, percent: Math.min(99, job.progress ?? 0) })
      continue
    }
    if (job.status === "success") {
      onProgress?.({ kind, percent: 100 })
      if (kind === "data_yaml") {
        const dataYaml = job.dataYaml?.trim()
        if (!dataYaml) throw new Error("上传完成但缺少 data_yaml")
        return { data_yaml: dataYaml }
      }
      const weightsPt = job.weightsPt?.trim()
      if (!weightsPt) throw new Error("上传完成但缺少 weights_pt")
      return { weights_pt: weightsPt }
    }
    throw new Error(job.errorMessage?.trim() || job.message?.trim() || "文件上传失败")
  }
  throw new Error(`上传超时（超过 ${Math.round(timeoutMs / 60_000)} 分钟）`)
}

/** @deprecated 使用 uploadYoloBatchFileFromPathWithProgress */
export async function uploadYoloBatchWeightsFromPathWithProgress(
  modelSlug: string,
  sourcePtPath: string,
  options?: {
    onProgress?: (progress: YoloBatchUploadProgress) => void
    timeoutMs?: number
  },
): Promise<{ weights_pt: string }> {
  const result = await uploadYoloBatchFileFromPathWithProgress(modelSlug, "weights", sourcePtPath, options)
  return { weights_pt: result.weights_pt ?? "" }
}

import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import { apiV1Root } from "@/lib/backend-http"
import { countTaskSourceStats, type ProjectTag } from "@/lib/projects-api"
import { updateTaskAnnotatedFileCount } from "@/lib/project-tasks-storage"
import { buildAllowedProjectLabelSet } from "@/lib/yolo-predict-to-annotation"
import { ensureYoloBatchModelRunning, probeYoloBatchApiAvailable } from "@/lib/yolo-batch-api"

export type YoloAutoAnnotatePhase = "idle" | "running" | "done" | "error" | "cancelled"

export type YoloAutoAnnotateProgress = {
  phase: YoloAutoAnnotatePhase
  done: number
  total: number
  currentFile?: string
  statusMessage?: string
  errorMessage?: string
  skippedAlreadyAnnotated?: number
  skippedLabelMismatch?: number
  summaryMessage?: string
}

export type RunYoloBatchAutoAnnotateParams = {
  projectId: string
  taskId: string
  modelSlug: string
  projectTags: ProjectTag[]
  skipAnnotated?: boolean
  overwriteExisting?: boolean
  signal?: AbortSignal
  onProgress: (progress: YoloAutoAnnotateProgress) => void
}

const JOB_POLL_MS = 400
const JOB_TIMEOUT_MS = 24 * 60 * 60 * 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function mapJobToProgress(job: {
  status: string
  done: number
  total: number
  currentFile?: string
  message?: string
  errorMessage?: string
  skippedAlreadyAnnotated?: number
  skippedLabelMismatch?: number
  summaryMessage?: string
}): YoloAutoAnnotateProgress {
  const status = job.status.trim()
  let phase: YoloAutoAnnotatePhase = "running"
  if (status === "success") phase = "done"
  else if (status === "failed") phase = "error"
  else if (status === "cancelled") phase = "cancelled"
  const summary = job.summaryMessage?.trim() || undefined
  return {
    phase,
    done: job.done ?? 0,
    total: job.total ?? 0,
    currentFile: job.currentFile?.trim() || undefined,
    statusMessage: summary || job.message?.trim() || undefined,
    errorMessage: job.errorMessage?.trim() || undefined,
    skippedAlreadyAnnotated: job.skippedAlreadyAnnotated ?? 0,
    skippedLabelMismatch: job.skippedLabelMismatch ?? 0,
    summaryMessage: summary,
  }
}

async function refreshTaskAnnotatedFileCount(projectId: string, taskId: string): Promise<void> {
  const stats = await countTaskSourceStats({ projectId, taskIds: [taskId] })
  if (stats.errorMessage) return
  await updateTaskAnnotatedFileCount(projectId, taskId, stats.annotationCount)
}

export async function runYoloBatchAutoAnnotate(params: RunYoloBatchAutoAnnotateParams): Promise<void> {
  const {
    projectId,
    taskId,
    modelSlug,
    projectTags,
    skipAnnotated = true,
    overwriteExisting = false,
    signal,
    onProgress,
  } = params

  onProgress({ phase: "running", done: 0, total: 0, statusMessage: "检查后端接口…" })

  const apiOk = await probeYoloBatchApiAvailable()
  if (!apiOk) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage:
        "当前连接的后端没有 YOLO 批量标注接口（HTTP 404）。请用最新 backend 代码重启本地或远程后端后再试。",
    })
    return
  }

  onProgress({ phase: "running", done: 0, total: 0, statusMessage: "启动/加载模型…" })
  try {
    await ensureYoloBatchModelRunning(modelSlug)
  } catch (e) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: e instanceof Error ? e.message : "启动模型失败",
    })
    return
  }

  const allowed = buildAllowedProjectLabelSet(projectTags)
  if (allowed.size === 0) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: "项目尚未配置可用的普通类别标签（需与模型 data.yaml 中的类别名一致）",
    })
    return
  }

  const modeHint = overwriteExisting
    ? "覆盖已有标注"
    : skipAnnotated
      ? "跳过已有标注"
      : "包含已有标注图片"
  onProgress({
    phase: "running",
    done: 0,
    total: 0,
    statusMessage: `启动子进程自动标注（${modeHint}）…`,
  })

  const globalConfigDir = loadAppConfig().storagePaths.globalConfigDir.trim()
  const started = await ipc.app.StartYoloBatchAutoAnnotateJob({
    globalConfigDir,
    projectId: projectId.trim(),
    taskId: taskId.trim(),
    apiRoot: apiV1Root(),
    modelSlug: modelSlug.trim(),
    allowedLabels: [...allowed],
    skipAnnotated,
    overwriteExisting,
  })
  if (!started.jobId?.trim()) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: started.errorMessage?.trim() || "无法启动自动标注任务",
    })
    return
  }

  const jobId = started.jobId.trim()
  const deadline = Date.now() + JOB_TIMEOUT_MS

  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        await ipc.app.CancelYoloBatchAutoAnnotateJob({ jobId })
        onProgress({
          phase: "cancelled",
          done: 0,
          total: 0,
          statusMessage: "已取消",
        })
        await refreshTaskAnnotatedFileCount(projectId, taskId).catch(() => undefined)
        return
      }

      const res = await ipc.app.GetYoloBatchAutoAnnotateJob({ jobId })
      if (!res.found || !res.job) {
        await sleep(JOB_POLL_MS)
        continue
      }

      const progress = mapJobToProgress(res.job)
      onProgress(progress)

      if (progress.phase === "done" || progress.phase === "error" || progress.phase === "cancelled") {
        if (progress.phase === "done" || progress.phase === "cancelled") {
          await refreshTaskAnnotatedFileCount(projectId, taskId).catch(() => undefined)
        }
        return
      }

      await sleep(JOB_POLL_MS)
    }

    await ipc.app.CancelYoloBatchAutoAnnotateJob({ jobId })
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: `自动标注超时（超过 ${Math.round(JOB_TIMEOUT_MS / 3_600_000)} 小时）`,
    })
  } catch (e) {
    await ipc.app.CancelYoloBatchAutoAnnotateJob({ jobId }).catch(() => undefined)
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: e instanceof Error ? e.message : "自动标注异常退出",
    })
  }
}

export async function cancelYoloBatchAutoAnnotateJob(jobId: string): Promise<void> {
  await ipc.app.CancelYoloBatchAutoAnnotateJob({ jobId: jobId.trim() })
}

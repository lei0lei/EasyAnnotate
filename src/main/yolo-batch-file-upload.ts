import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { resolveChildScriptLaunch } from "./child-process-launch.js"
import { uploadYoloBatchFileViaWs, type YoloBatchUploadKind } from "./backend-yolo-batch-ws"
import { apiRootToWsUrl } from "./backend-yolo-training-ws"
import { resolveApiV1Root } from "./yolo-dataset-upload"

const UPLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000
const STATE_SYNC_POLL_MS = 400

export type YoloBatchFileUploadJobRecord = {
  id: string
  kind: YoloBatchUploadKind
  status: "running" | "success" | "failed"
  progress: number
  message: string
  dataYaml: string
  weightsPt: string
  errorMessage: string
}

type YoloBatchUploadRequest = {
  jobId: string
  kind: YoloBatchUploadKind
  modelSlug: string
  sourcePath: string
  apiRoot: string
}

type UploadChildLaunch = {
  command: string
  args: string[]
  cwd: string
}

const jobs = new Map<string, YoloBatchFileUploadJobRecord>()
const activeUploadChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()

function uploadRequestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-yolo-batch-upload-req-${jobId}.json`)
}

function uploadStatePath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-yolo-batch-upload-state-${jobId}.json`)
}

function isBatchUploadChildProcess(): boolean {
  return process.env.EA_YOLO_BATCH_UPLOAD_CHILD === "1" && Boolean(process.env.EA_YOLO_BATCH_UPLOAD_JOB_ID?.trim())
}

function writeUploadStateFile(jobId: string, job: YoloBatchFileUploadJobRecord): void {
  try {
    fs.writeFileSync(uploadStatePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function readUploadStateFile(jobId: string): YoloBatchFileUploadJobRecord | null {
  try {
    const raw = fs.readFileSync(uploadStatePath(jobId), "utf8")
    const parsed = JSON.parse(raw) as YoloBatchFileUploadJobRecord
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function syncYoloBatchUploadJobFromStateFile(jobId: string): void {
  const state = readUploadStateFile(jobId)
  if (!state) return
  jobs.set(jobId, state)
}

function updateJob(jobId: string, patch: Partial<YoloBatchFileUploadJobRecord>): void {
  const prev = jobs.get(jobId)
  if (!prev) return
  const next = { ...prev, ...patch }
  jobs.set(jobId, next)
  writeUploadStateFile(jobId, next)
}

function validateSourcePath(kind: YoloBatchUploadKind, sourcePath: string): string {
  const trimmed = sourcePath.trim()
  if (!trimmed) return kind === "data_yaml" ? "未选择 data.yaml 文件" : "未选择 .pt 文件"
  if (!fs.existsSync(trimmed)) return `源文件不存在：${trimmed}`
  const lower = trimmed.toLowerCase()
  if (kind === "data_yaml") {
    if (!lower.endsWith(".yaml") && !lower.endsWith(".yml")) return "仅支持 .yaml / .yml"
  } else if (!lower.endsWith(".pt")) {
    return "仅支持 .pt 权重"
  }
  return ""
}

function resolveApiRoot(globalConfigDir: string, apiRootOverride: string): { apiRoot: string; errorMessage: string } {
  const override = apiRootOverride.trim()
  if (override) return { apiRoot: override.replace(/\/+$/, ""), errorMessage: "" }
  return resolveApiV1Root(globalConfigDir)
}

async function runBatchUploadJob(jobId: string, req: YoloBatchUploadRequest): Promise<void> {
  updateJob(jobId, { message: "连接 WebSocket…", progress: 0 })

  try {
    const result = await uploadYoloBatchFileViaWs({
      kind: req.kind,
      wsUrl: apiRootToWsUrl(req.apiRoot),
      clientId: `yolo-batch-${randomUUID()}`,
      modelSlug: req.modelSlug,
      sourcePath: req.sourcePath,
      onChunkProgress: (done, total) => {
        const progress = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0
        updateJob(jobId, { progress, message: `上传分片 ${done}/${total}` })
      },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
    updateJob(jobId, {
      status: "success",
      progress: 100,
      message: "上传完成",
      dataYaml: result.data_yaml ?? "",
      weightsPt: result.weights_pt ?? "",
      errorMessage: "",
    })
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: "上传失败",
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

function resolveBatchUploadChildLaunch(
  jobId: string,
  reqPath: string,
): { launch: UploadChildLaunch | null; reason: string } {
  const resolved = resolveChildScriptLaunch("yolo-batch-file-upload-child.js", [jobId, reqPath])
  if (!resolved.launch) {
    return { launch: null, reason: resolved.reason }
  }
  return {
    launch: {
      command: resolved.launch.command,
      args: resolved.launch.args,
      cwd: resolved.launch.cwd,
    },
    reason: "",
  }
}

function cleanupUploadChild(jobId: string): void {
  const active = activeUploadChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeUploadChildren.delete(jobId)
}

function spawnBatchUploadChild(job: YoloBatchFileUploadJobRecord, req: YoloBatchUploadRequest): boolean {
  const reqPath = uploadRequestPath(job.id)
  try {
    fs.writeFileSync(reqPath, JSON.stringify(req), "utf8")
    writeUploadStateFile(job.id, job)
  } catch (error) {
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return false
  }

  const resolved = resolveBatchUploadChildLaunch(job.id, reqPath)
  if (!resolved.launch) {
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      message: `无法启动上传子进程：${resolved.reason}`,
      errorMessage: `无法启动上传子进程：${resolved.reason}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    return false
  }
  const launch = resolved.launch

  const child = spawn(launch.command, launch.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: launch.cwd,
    env: {
      ...process.env,
      EA_YOLO_BATCH_UPLOAD_CHILD: "1",
      EA_YOLO_BATCH_UPLOAD_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.warn(`[yolo-batch-upload:${job.id}] ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncYoloBatchUploadJobFromStateFile(job.id)
  }, STATE_SYNC_POLL_MS)

  activeUploadChildren.set(job.id, { child, pollTimer })

  child.on("error", (error) => {
    cleanupUploadChild(job.id)
    updateJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: `上传子进程错误：${error.message}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
  })

  child.on("close", (code) => {
    cleanupUploadChild(job.id)
    syncYoloBatchUploadJobFromStateFile(job.id)
    const state = jobs.get(job.id)
    if (code !== 0 && state?.status !== "success" && state?.status !== "failed") {
      updateJob(job.id, {
        status: "failed",
        progress: 100,
        errorMessage: `上传子进程异常退出（code=${code ?? "null"}）`,
      })
    }
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    try {
      const finalState = jobs.get(job.id)
      if (finalState?.status === "success" || finalState?.status === "failed") {
        fs.unlinkSync(uploadStatePath(job.id))
      }
    } catch {
      /* ignore */
    }
  })

  return true
}

export async function runYoloBatchFileUploadFromChildArgv(jobId: string, reqPath: string): Promise<void> {
  process.env.EA_YOLO_BATCH_UPLOAD_CHILD = "1"
  process.env.EA_YOLO_BATCH_UPLOAD_JOB_ID = jobId

  const raw = await fs.promises.readFile(reqPath, "utf8")
  const req = JSON.parse(raw) as YoloBatchUploadRequest
  if (!req?.jobId || !req?.modelSlug || !req?.sourcePath || !req?.apiRoot || !req?.kind) {
    throw new Error("Invalid batch upload request payload")
  }

  const job: YoloBatchFileUploadJobRecord = {
    id: jobId,
    kind: req.kind,
    status: "running",
    progress: 0,
    message: "开始上传…",
    dataYaml: "",
    weightsPt: "",
    errorMessage: "",
  }
  jobs.set(jobId, job)
  writeUploadStateFile(jobId, job)

  await runBatchUploadJob(jobId, req)
}

export function startYoloBatchFileUploadFromPath(args: {
  globalConfigDir: string
  apiRoot?: string
  modelSlug: string
  kind: YoloBatchUploadKind
  sourcePath: string
}): { jobId: string; errorMessage: string } {
  const modelSlug = args.modelSlug.trim()
  const kind = args.kind
  const sourcePath = args.sourcePath.trim()
  if (!modelSlug) return { jobId: "", errorMessage: "模型标识为空" }
  const pathError = validateSourcePath(kind, sourcePath)
  if (pathError) return { jobId: "", errorMessage: pathError }

  const { apiRoot, errorMessage } = resolveApiRoot(args.globalConfigDir, args.apiRoot ?? "")
  if (errorMessage) return { jobId: "", errorMessage }
  if (!apiRoot) return { jobId: "", errorMessage: "无法解析后端地址" }

  const jobId = randomUUID()
  const job: YoloBatchFileUploadJobRecord = {
    id: jobId,
    kind,
    status: "running",
    progress: 0,
    message: "排队中…",
    dataYaml: "",
    weightsPt: "",
    errorMessage: "",
  }
  jobs.set(jobId, job)
  writeUploadStateFile(jobId, job)

  const req: YoloBatchUploadRequest = { jobId, kind, modelSlug, sourcePath, apiRoot }

  if (isBatchUploadChildProcess()) {
    void runBatchUploadJob(jobId, req).catch((error) => {
      updateJob(jobId, {
        status: "failed",
        progress: 100,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    })
    return { jobId, errorMessage: "" }
  }

  spawnBatchUploadChild(job, req)
  return { jobId, errorMessage: "" }
}

export function getYoloBatchFileUploadJob(jobId: string): YoloBatchFileUploadJobRecord | null {
  const trimmed = jobId.trim()
  if (!trimmed) return null
  syncYoloBatchUploadJobFromStateFile(trimmed)
  return jobs.get(trimmed) ?? null
}

export function startYoloBatchWeightsUploadFromPath(args: {
  globalConfigDir: string
  apiRoot?: string
  modelSlug: string
  sourcePtPath: string
}): { jobId: string; errorMessage: string } {
  return startYoloBatchFileUploadFromPath({
    globalConfigDir: args.globalConfigDir,
    apiRoot: args.apiRoot,
    modelSlug: args.modelSlug,
    kind: "weights",
    sourcePath: args.sourcePtPath,
  })
}

export function getYoloBatchWeightsUploadJob(jobId: string): YoloBatchFileUploadJobRecord | null {
  return getYoloBatchFileUploadJob(jobId)
}

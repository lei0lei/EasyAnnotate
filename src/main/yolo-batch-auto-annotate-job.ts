import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import type { YoloAutoAnnotateRunRequest } from "./yolo-batch-auto-annotate-runner"

const STATE_SYNC_POLL_MS = 400

export type YoloAutoAnnotateJobRecord = {
  id: string
  status: "running" | "success" | "failed" | "cancelled"
  done: number
  total: number
  currentFile: string
  message: string
  errorMessage: string
  skippedAlreadyAnnotated: number
  skippedLabelMismatch: number
  summaryMessage: string
}

type ChildLaunch = {
  command: string
  args: string[]
  cwd: string
}

const jobs = new Map<string, YoloAutoAnnotateJobRecord>()
const activeChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()
const cancelRequested = new Set<string>()
let globalActiveJobId: string | null = null

function requestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-yolo-auto-annotate-req-${jobId}.json`)
}

function statePath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-yolo-auto-annotate-state-${jobId}.json`)
}

function cancelFlagPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-yolo-auto-annotate-cancel-${jobId}.flag`)
}

function writeStateFile(jobId: string, job: YoloAutoAnnotateJobRecord): void {
  try {
    fs.writeFileSync(statePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function normalizeJobRecord(parsed: Partial<YoloAutoAnnotateJobRecord>): YoloAutoAnnotateJobRecord | null {
  if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") return null
  return {
    id: parsed.id,
    status:
      parsed.status === "success" ||
      parsed.status === "failed" ||
      parsed.status === "cancelled" ||
      parsed.status === "running"
        ? parsed.status
        : "running",
    done: Math.max(0, Math.floor(Number(parsed.done) || 0)),
    total: Math.max(0, Math.floor(Number(parsed.total) || 0)),
    currentFile: typeof parsed.currentFile === "string" ? parsed.currentFile : "",
    message: typeof parsed.message === "string" ? parsed.message : "",
    errorMessage: typeof parsed.errorMessage === "string" ? parsed.errorMessage : "",
    skippedAlreadyAnnotated: Math.max(0, Math.floor(Number(parsed.skippedAlreadyAnnotated) || 0)),
    skippedLabelMismatch: Math.max(0, Math.floor(Number(parsed.skippedLabelMismatch) || 0)),
    summaryMessage: typeof parsed.summaryMessage === "string" ? parsed.summaryMessage : "",
  }
}

function readStateFile(jobId: string): YoloAutoAnnotateJobRecord | null {
  try {
    const raw = fs.readFileSync(statePath(jobId), "utf8")
    const parsed = JSON.parse(raw) as Partial<YoloAutoAnnotateJobRecord>
    return normalizeJobRecord(parsed)
  } catch {
    return null
  }
}

export function syncYoloAutoAnnotateJobFromStateFile(jobId: string): void {
  const state = readStateFile(jobId)
  if (!state) return
  jobs.set(jobId, state)
}

function updateJob(jobId: string, patch: Partial<YoloAutoAnnotateJobRecord>): void {
  const prev = jobs.get(jobId)
  if (!prev) return
  const next = { ...prev, ...patch }
  jobs.set(jobId, next)
  writeStateFile(jobId, next)
}

function findProjectRoot(): string | null {
  const seeds = new Set<string>([process.cwd()])
  try {
    seeds.add(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    /* ignore */
  }
  for (const seed of seeds) {
    let dir = path.resolve(seed)
    for (let depth = 0; depth < 12; depth += 1) {
      const pkgPath = path.join(dir, "package.json")
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string }
          if (pkg.name === "easy-annotate") return dir
        } catch {
          /* ignore */
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

function resolveSystemNodeExecutable(): string | null {
  const execBase = path.basename(process.execPath).toLowerCase()
  if (execBase === "node.exe" || execBase === "node") {
    return process.execPath
  }
  for (const envCandidate of [process.env.NODE_EXE, process.env.npm_node_execpath]) {
    const trimmed = (envCandidate || "").trim()
    if (trimmed && fs.existsSync(trimmed)) return trimmed
  }
  if (process.platform === "win32") {
    try {
      const output = execFileSync("where.exe", ["node"], { encoding: "utf8", windowsHide: true }).trim()
      const candidate = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (candidate && fs.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return null
}

function resolveChildLaunch(jobId: string): { launch: ChildLaunch | null; reason: string } {
  const root = findProjectRoot()
  const nodeExe = resolveSystemNodeExecutable()
  if (!nodeExe) {
    return { launch: null, reason: "未找到 Node.js" }
  }
  if (!root) {
    return { launch: null, reason: `未找到项目根目录（cwd=${process.cwd()}）` }
  }
  const bundledScript = path.join(root, "out", "main", "yolo-batch-auto-annotate-child.js")
  const bundledDir = path.dirname(bundledScript)
  const bundledAssetsDir = path.join(bundledDir, "assets")
  if (!fs.existsSync(bundledScript)) {
    return {
      launch: null,
      reason: `未找到 ${bundledScript}，请执行：npx vite build --mode main`,
    }
  }
  if (!fs.existsSync(bundledAssetsDir)) {
    return {
      launch: null,
      reason: `缺少 ${bundledAssetsDir}，请重新执行：npx vite build --mode main`,
    }
  }
  const req = requestPath(jobId)
  const state = statePath(jobId)
  const cancel = cancelFlagPath(jobId)
  return {
    launch: {
      command: nodeExe,
      args: [bundledScript, jobId, req, state, cancel],
      cwd: bundledDir,
    },
    reason: "",
  }
}

function cleanupChild(jobId: string): void {
  const active = activeChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeChildren.delete(jobId)
  if (globalActiveJobId === jobId) {
    globalActiveJobId = null
  }
}

function removeCancelFlag(jobId: string): void {
  try {
    fs.unlinkSync(cancelFlagPath(jobId))
  } catch {
    /* ignore */
  }
}

function spawnAutoAnnotateChild(job: YoloAutoAnnotateJobRecord, req: YoloAutoAnnotateRunRequest): boolean {
  const reqFile = requestPath(job.id)
  removeCancelFlag(job.id)
  try {
    fs.writeFileSync(reqFile, JSON.stringify(req), "utf8")
    writeStateFile(job.id, job)
  } catch (error) {
    updateJob(job.id, {
      status: "failed",
      message: "无法写入任务请求",
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return false
  }

  const resolved = resolveChildLaunch(job.id)
  if (!resolved.launch) {
    updateJob(job.id, {
      status: "failed",
      message: "无法启动子进程",
      errorMessage: resolved.reason,
    })
    try {
      fs.unlinkSync(reqFile)
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
      EA_YOLO_AUTO_ANNOTATE_CHILD: "1",
      EA_YOLO_AUTO_ANNOTATE_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.warn(`[yolo-auto-annotate:${job.id}] ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncYoloAutoAnnotateJobFromStateFile(job.id)
  }, STATE_SYNC_POLL_MS)

  activeChildren.set(job.id, { child, pollTimer })
  globalActiveJobId = job.id

  child.on("error", (error) => {
    cleanupChild(job.id)
    updateJob(job.id, {
      status: "failed",
      message: "子进程错误",
      errorMessage: `子进程错误：${error.message}`,
    })
    removeTempFiles(job.id)
  })

  child.on("close", (code) => {
    cleanupChild(job.id)
    syncYoloAutoAnnotateJobFromStateFile(job.id)
    const state = jobs.get(job.id)
    if (cancelRequested.has(job.id)) {
      cancelRequested.delete(job.id)
      if (state?.status === "running") {
        updateJob(job.id, {
          status: "cancelled",
          message: "已取消",
          errorMessage: "",
        })
      }
    } else if (code !== 0 && state?.status !== "success" && state?.status !== "failed" && state?.status !== "cancelled") {
      updateJob(job.id, {
        status: "failed",
        message: "子进程异常退出",
        errorMessage: `子进程异常退出（code=${code ?? "null"}）`,
      })
    }
    removeTempFiles(job.id)
  })

  return true
}

function removeTempFiles(jobId: string): void {
  for (const fp of [requestPath(jobId), cancelFlagPath(jobId)]) {
    try {
      fs.unlinkSync(fp)
    } catch {
      /* ignore */
    }
  }
  try {
    const state = jobs.get(jobId)
    if (state?.status === "success" || state?.status === "failed" || state?.status === "cancelled") {
      fs.unlinkSync(statePath(jobId))
    }
  } catch {
    /* ignore */
  }
}

export function cancelYoloAutoAnnotateJob(jobId: string): boolean {
  const trimmed = jobId.trim()
  if (!trimmed) return false
  cancelRequested.add(trimmed)
  try {
    fs.writeFileSync(cancelFlagPath(trimmed), "1", "utf8")
  } catch {
    /* ignore */
  }
  const active = activeChildren.get(trimmed)
  if (active?.child && !active.child.killed) {
    active.child.kill()
  }
  return true
}

export function getActiveYoloAutoAnnotateJobId(): string | null {
  return globalActiveJobId
}

export function startYoloAutoAnnotateJob(args: {
  modelSlug: string
  apiRoot: string
  imagePaths: string[]
  allowedLabels: string[]
  skipAnnotated?: boolean
  overwriteExisting?: boolean
}): { jobId: string; errorMessage: string } {
  const modelSlug = args.modelSlug.trim()
  if (!modelSlug) return { jobId: "", errorMessage: "模型标识为空" }
  const apiRoot = args.apiRoot.trim()
  if (!apiRoot) return { jobId: "", errorMessage: "无法解析后端地址" }
  const imagePaths = args.imagePaths.map((p) => p.trim()).filter(Boolean)
  if (imagePaths.length === 0) return { jobId: "", errorMessage: "没有可标注的图片" }
  const allowedLabels = args.allowedLabels.map((l) => l.trim()).filter(Boolean)
  if (allowedLabels.length === 0) {
    return { jobId: "", errorMessage: "项目尚未配置可用的普通类别标签" }
  }

  if (globalActiveJobId) {
    cancelYoloAutoAnnotateJob(globalActiveJobId)
  }

  const jobId = randomUUID()
  const job: YoloAutoAnnotateJobRecord = {
    id: jobId,
    status: "running",
    done: 0,
    total: imagePaths.length,
    currentFile: "",
    message: "排队中…",
    errorMessage: "",
    skippedAlreadyAnnotated: 0,
    skippedLabelMismatch: 0,
    summaryMessage: "",
  }
  jobs.set(jobId, job)
  writeStateFile(jobId, job)

  const req: YoloAutoAnnotateRunRequest = {
    jobId,
    modelSlug,
    apiRoot,
    imagePaths,
    allowedLabels,
    skipAnnotated: args.skipAnnotated,
    overwriteExisting: args.overwriteExisting,
  }

  if (!spawnAutoAnnotateChild(job, req)) {
    return { jobId: "", errorMessage: jobs.get(jobId)?.errorMessage || "无法启动自动标注" }
  }

  return { jobId, errorMessage: "" }
}

export function getYoloAutoAnnotateJob(jobId: string): YoloAutoAnnotateJobRecord | null {
  const trimmed = jobId.trim()
  if (!trimmed) return null
  syncYoloAutoAnnotateJobFromStateFile(trimmed)
  return jobs.get(trimmed) ?? null
}

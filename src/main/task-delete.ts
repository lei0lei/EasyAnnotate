import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveChildScriptLaunch } from "./child-process-launch.js"
import { runTaskDelete, type TaskDeleteRequest } from "./task-delete-core"

type DeleteStatus = "queued" | "running" | "success" | "failed"

export type TaskDeleteJobRecord = {
  id: string
  projectId: string
  taskId: string
  status: DeleteStatus
  progress: number
  message: string
  statusMessage: string
  deletedFileCount: number
  totalFileCount: number
  errorMessage: string
  createdAt: string
  updatedAt: string
}

const deleteJobs = new Map<string, TaskDeleteJobRecord>()
const activeDeleteChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()
const deleteProgressThrottle = new Map<string, number>()
const DELETE_PROGRESS_MIN_INTERVAL_MS = 400

function nowIso(): string {
  return new Date().toISOString()
}

function deleteRequestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-delete-req-${jobId}.json`)
}

function deleteStatePath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-delete-state-${jobId}.json`)
}

function isDeleteChildProcess(): boolean {
  return process.env.EA_DELETE_CHILD === "1" && Boolean(process.env.EA_DELETE_JOB_ID?.trim())
}

function writeDeleteStage(jobId: string, stage: string): void {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), `easyannotate-delete-${jobId}.stage.log`),
      `${new Date().toISOString()} ${stage}\n`,
      "utf8",
    )
  } catch {
    /* ignore */
  }
}

function writeDeleteStateFile(jobId: string, job: TaskDeleteJobRecord): void {
  try {
    fs.writeFileSync(deleteStatePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function readDeleteStateFile(jobId: string): TaskDeleteJobRecord | null {
  try {
    const raw = fs.readFileSync(deleteStatePath(jobId), "utf8")
    const parsed = JSON.parse(raw) as TaskDeleteJobRecord
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function syncDeleteJobFromStateFile(jobId: string): void {
  const state = readDeleteStateFile(jobId)
  if (!state) return
  deleteJobs.set(jobId, state)
}

function updateDeleteJob(jobId: string, patch: Partial<TaskDeleteJobRecord>): void {
  const current = deleteJobs.get(jobId)
  if (!current) return

  const terminal = patch.status === "success" || patch.status === "failed"
  const progressOnly =
    typeof patch.progress === "number" &&
    patch.status === undefined &&
    typeof patch.message !== "string" &&
    typeof patch.statusMessage !== "string" &&
    typeof patch.deletedFileCount !== "number" &&
    typeof patch.totalFileCount !== "number"
  if (progressOnly && !terminal) {
    const now = Date.now()
    const last = deleteProgressThrottle.get(jobId) ?? 0
    if (now - last < DELETE_PROGRESS_MIN_INTERVAL_MS) return
    deleteProgressThrottle.set(jobId, now)
  }

  const nextStatusMessage =
    typeof patch.statusMessage === "string"
      ? patch.statusMessage
      : typeof patch.message === "string"
        ? patch.message
        : current.statusMessage || current.message || ""

  const next: TaskDeleteJobRecord = {
    ...current,
    ...patch,
    statusMessage: nextStatusMessage,
    message: nextStatusMessage,
    updatedAt: nowIso(),
  }
  deleteJobs.set(jobId, next)

  if (isDeleteChildProcess() && process.env.EA_DELETE_JOB_ID === jobId) {
    writeDeleteStateFile(jobId, next)
  }
}

type DeleteChildLaunch = {
  command: string
  args: string[]
  cwd: string
  mode: "packaged" | "dev"
}

function resolveDeleteChildLaunch(
  jobId: string,
  reqPath: string,
): { launch: DeleteChildLaunch | null; reason: string } {
  const resolved = resolveChildScriptLaunch("task-delete-child.js", [jobId, reqPath])
  if (!resolved.launch) {
    return { launch: null, reason: resolved.reason }
  }
  return {
    launch: {
      command: resolved.launch.command,
      args: resolved.launch.args,
      cwd: resolved.launch.cwd,
      mode: resolved.launch.mode,
    },
    reason: "",
  }
}

function cleanupDeleteChild(jobId: string): void {
  const active = activeDeleteChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeDeleteChildren.delete(jobId)
}

function spawnDeleteChild(job: TaskDeleteJobRecord, req: TaskDeleteRequest): boolean {
  const reqPath = deleteRequestPath(job.id)
  try {
    fs.writeFileSync(reqPath, JSON.stringify({ job, req }), "utf8")
    writeDeleteStateFile(job.id, job)
  } catch (error) {
    updateDeleteJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: error instanceof Error ? error.message : String(error),
      statusMessage: error instanceof Error ? error.message : String(error),
    })
    return false
  }

  const resolved = resolveDeleteChildLaunch(job.id, reqPath)
  if (!resolved.launch) {
    writeDeleteStage(job.id, `child launch failed: ${resolved.reason}`)
    updateDeleteJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: `无法启动删除子进程：${resolved.reason}`,
      statusMessage: `无法启动删除子进程：${resolved.reason}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    return false
  }
  const launch = resolved.launch
  writeDeleteStage(job.id, `spawn child mode=${launch.mode} ${launch.command} ${launch.args.join(" ")}`)

  const child = spawn(launch.command, launch.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: launch.cwd,
    env: {
      ...process.env,
      EA_DELETE_CHILD: "1",
      EA_DELETE_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) writeDeleteStage(job.id, `child stderr: ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncDeleteJobFromStateFile(job.id)
  }, 400)

  activeDeleteChildren.set(job.id, { child, pollTimer })

  child.on("error", (error) => {
    cleanupDeleteChild(job.id)
    updateDeleteJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: `删除子进程错误：${error.message}`,
      statusMessage: `删除子进程错误：${error.message}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
  })

  child.on("close", (code) => {
    cleanupDeleteChild(job.id)
    syncDeleteJobFromStateFile(job.id)
    const state = deleteJobs.get(job.id)
    if (code !== 0 && state?.status !== "success" && state?.status !== "failed") {
      updateDeleteJob(job.id, {
        status: "failed",
        progress: 100,
        errorMessage: `删除子进程异常退出（code=${code ?? "null"}）`,
        statusMessage: `删除子进程异常退出（code=${code ?? "null"}）`,
      })
    }
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    try {
      const finalState = deleteJobs.get(job.id)
      if (finalState?.status === "success" || finalState?.status === "failed") {
        fs.unlinkSync(deleteStatePath(job.id))
      }
    } catch {
      /* ignore */
    }
  })

  return true
}

function createDeleteJobRecord(req: TaskDeleteRequest): TaskDeleteJobRecord {
  const now = nowIso()
  return {
    id: randomUUID(),
    projectId: req.projectId,
    taskId: req.taskId,
    status: "queued",
    progress: 0,
    message: "等待删除…",
    statusMessage: "等待删除…",
    deletedFileCount: 0,
    totalFileCount: 0,
    errorMessage: "",
    createdAt: now,
    updatedAt: now,
  }
}

async function runDeleteJob(job: TaskDeleteJobRecord, req: TaskDeleteRequest): Promise<void> {
  updateDeleteJob(job.id, { status: "running", progress: 1, statusMessage: "正在删除…" })
  const result = await runTaskDelete(req, (patch) => {
    updateDeleteJob(job.id, {
      progress: patch.progress,
      statusMessage: patch.statusMessage,
      deletedFileCount: patch.deletedFileCount,
      totalFileCount: patch.totalFileCount,
    })
  })
  if (result.errorMessage) {
    updateDeleteJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: result.errorMessage,
      statusMessage: result.errorMessage,
      deletedFileCount: result.deletedFileCount,
    })
    return
  }
  updateDeleteJob(job.id, {
    status: "success",
    progress: 100,
    deletedFileCount: result.deletedFileCount,
    statusMessage:
      result.deletedFileCount > 0
        ? `删除完成：已删除 ${result.deletedFileCount} 个文件`
        : "删除完成",
  })
}

export async function runDeleteFromChildArgv(jobId: string, reqPath: string): Promise<void> {
  process.env.EA_DELETE_CHILD = "1"
  process.env.EA_DELETE_JOB_ID = jobId
  const raw = fs.readFileSync(reqPath, "utf8")
  const payload = JSON.parse(raw) as { job: TaskDeleteJobRecord; req: TaskDeleteRequest }
  if (!payload?.job?.id || !payload.req) {
    throw new Error("Invalid delete request payload")
  }
  deleteJobs.set(jobId, payload.job)
  writeDeleteStateFile(jobId, payload.job)
  await runDeleteJob(payload.job, payload.req)
}

export const TASK_DELETE_EXPORT_FORMAT = "task-delete"
export const DELETE_JOB_META_SEP = "\n---DELETE_META---\n"

export type TaskDeleteJobExportItem = {
  id: string
  projectId: string
  taskId: string
  versionName: string
  exportFormat: string
  keepProjectStructure: boolean
  outputDir: string
  status: string
  progress: number
  message: string
  createdAt: string
  updatedAt: string
}

export function mapTaskDeleteJobToExportJobItem(job: TaskDeleteJobRecord): TaskDeleteJobExportItem {
  const statusMessage = job.statusMessage || job.message || ""
  const meta = `${job.deletedFileCount}|${job.totalFileCount}|${job.errorMessage || ""}`
  return {
    id: job.id,
    projectId: job.projectId,
    taskId: job.taskId,
    versionName: "",
    exportFormat: TASK_DELETE_EXPORT_FORMAT,
    keepProjectStructure: false,
    outputDir: "",
    status: job.status,
    progress: Math.max(0, Math.min(100, Math.floor(Number(job.progress) || 0))),
    message: `${statusMessage}${DELETE_JOB_META_SEP}${meta}`,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

export function listTaskDeleteJobsForIpc(): TaskDeleteJobRecord[] {
  return [...deleteJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listTaskDeleteJobsAsExportJobsForIpc(): TaskDeleteJobExportItem[] {
  for (const job of listTaskDeleteJobsForIpc()) {
    if (job.status === "queued" || job.status === "running") {
      syncDeleteJobFromStateFile(job.id)
    }
  }
  return listTaskDeleteJobsForIpc()
    .slice(0, 16)
    .map(mapTaskDeleteJobToExportJobItem)
}

export function startTaskDeleteJob(req: TaskDeleteRequest): { jobId: string; errorMessage: string } {
  const job = createDeleteJobRecord(req)
  deleteJobs.set(job.id, job)

  const spawned = spawnDeleteChild(job, req)
  if (spawned) {
    return { jobId: job.id, errorMessage: "" }
  }

  const failed = deleteJobs.get(job.id)
  return {
    jobId: job.id,
    errorMessage:
      failed?.errorMessage ||
      failed?.statusMessage ||
      "无法启动删除子进程（请先运行 npx vite build --mode main 并重启应用）",
  }
}

export async function runTaskDeleteJobFallback(jobId: string, req: TaskDeleteRequest): Promise<void> {
  const job = deleteJobs.get(jobId)
  if (!job) return
  await runDeleteJob(job, req)
}

export function getTaskDeleteJob(jobId: string): TaskDeleteJobRecord | undefined {
  syncDeleteJobFromStateFile(jobId)
  return deleteJobs.get(jobId)
}

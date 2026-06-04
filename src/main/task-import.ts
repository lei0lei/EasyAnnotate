import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  runAnnotatedTaskZipImport,
  type AnnotatedImportRequest,
} from "./annotated-task-import-core"

type ImportStatus = "queued" | "running" | "success" | "failed"

export type AnnotatedImportJobRecord = {
  id: string
  projectId: string
  taskId: string
  subset: string
  zipPath: string
  importFormat: string
  status: ImportStatus
  progress: number
  message: string
  statusMessage: string
  importedImageCount: number
  importedAnnotationCount: number
  detectedFormat: string
  errorMessage: string
  createdAt: string
  updatedAt: string
}

const importJobs = new Map<string, AnnotatedImportJobRecord>()
const activeImportChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()
const importProgressThrottle = new Map<string, number>()
const importJobPruneTimers = new Map<string, ReturnType<typeof setTimeout>>()
const IMPORT_PROGRESS_MIN_INTERVAL_MS = 400
const IMPORT_JOB_PRUNE_DELAY_MS = 2000

function nowIso(): string {
  return new Date().toISOString()
}

function importRequestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-import-req-${jobId}.json`)
}

function importStatePath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-import-state-${jobId}.json`)
}

function isImportChildProcess(): boolean {
  return process.env.EA_IMPORT_CHILD === "1" && Boolean(process.env.EA_IMPORT_JOB_ID?.trim())
}

function writeImportStage(jobId: string, stage: string): void {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), `easyannotate-import-${jobId}.stage.log`),
      `${new Date().toISOString()} ${stage}\n`,
      "utf8",
    )
  } catch {
    /* ignore */
  }
}

function writeImportStateFile(jobId: string, job: AnnotatedImportJobRecord): void {
  try {
    fs.writeFileSync(importStatePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function readImportStateFile(jobId: string): AnnotatedImportJobRecord | null {
  try {
    const raw = fs.readFileSync(importStatePath(jobId), "utf8")
    const parsed = JSON.parse(raw) as AnnotatedImportJobRecord
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function syncImportJobFromStateFile(jobId: string): void {
  const state = readImportStateFile(jobId)
  if (!state) return
  importJobs.set(jobId, state)
  if (state.status === "success" || state.status === "failed") {
    scheduleImportJobPrune(jobId)
  }
}

function scheduleImportJobPrune(jobId: string): void {
  if (isImportChildProcess()) return
  const existing = importJobPruneTimers.get(jobId)
  if (existing) clearTimeout(existing)
  importJobPruneTimers.set(
    jobId,
    setTimeout(() => {
      importJobs.delete(jobId)
      importProgressThrottle.delete(jobId)
      importJobPruneTimers.delete(jobId)
      try {
        fs.unlinkSync(importStatePath(jobId))
      } catch {
        /* ignore */
      }
    }, IMPORT_JOB_PRUNE_DELAY_MS),
  )
}

function updateImportJob(jobId: string, patch: Partial<AnnotatedImportJobRecord>): void {
  const current = importJobs.get(jobId)
  if (!current) return

  const terminal = patch.status === "success" || patch.status === "failed"
  const progressOnly =
    typeof patch.progress === "number" &&
    patch.status === undefined &&
    typeof patch.message !== "string" &&
    typeof patch.statusMessage !== "string"
  if (progressOnly && !terminal) {
    const now = Date.now()
    const last = importProgressThrottle.get(jobId) ?? 0
    if (now - last < IMPORT_PROGRESS_MIN_INTERVAL_MS) return
    importProgressThrottle.set(jobId, now)
  }

  const nextStatusMessage =
    typeof patch.statusMessage === "string"
      ? patch.statusMessage
      : typeof patch.message === "string"
        ? patch.message
        : current.statusMessage || current.message || ""

  const next: AnnotatedImportJobRecord = {
    ...current,
    ...patch,
    statusMessage: nextStatusMessage,
    message: nextStatusMessage,
    updatedAt: nowIso(),
  }
  importJobs.set(jobId, next)

  if (isImportChildProcess() && process.env.EA_IMPORT_JOB_ID === jobId) {
    writeImportStateFile(jobId, next)
  } else if (terminal) {
    scheduleImportJobPrune(jobId)
  }
}

function findProjectRoot(): string | null {
  const seeds = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]
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
    const programFiles = process.env.ProgramFiles || "C:\\Program Files"
    const winCandidates = [
      path.join(programFiles, "nodejs", "node.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
    ]
    for (const candidate of winCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  } else {
    try {
      const output = execFileSync("which", ["node"], { encoding: "utf8" }).trim()
      if (output && fs.existsSync(output)) return output
    } catch {
      /* ignore */
    }
  }
  return null
}

type ImportChildLaunch = {
  command: string
  args: string[]
  cwd: string
  mode: "bundled"
}

function resolveImportChildLaunch(
  jobId: string,
  reqPath: string,
): { launch: ImportChildLaunch | null; reason: string } {
  const root = findProjectRoot()
  const nodeExe = resolveSystemNodeExecutable()
  if (!nodeExe) {
    return { launch: null, reason: "未找到 Node.js（请安装 Node 并加入 PATH，或安装到 Program Files\\nodejs）" }
  }
  if (!root) {
    return {
      launch: null,
      reason: "未找到项目根目录（需包含 package.json 且 name 为 easy-annotate）",
    }
  }
  const bundledScript = path.join(root, "out", "main", "task-import-child.js")
  if (!fs.existsSync(bundledScript)) {
    return {
      launch: null,
      reason: `未找到导入子进程脚本：${bundledScript}（请先运行 npx vite build --mode main）`,
    }
  }
  const bundledDir = path.dirname(bundledScript)
  return {
    launch: {
      command: nodeExe,
      args: [bundledScript, jobId, reqPath],
      cwd: bundledDir,
      mode: "bundled",
    },
    reason: "",
  }
}

function cleanupImportChild(jobId: string): void {
  const active = activeImportChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeImportChildren.delete(jobId)
}

function spawnImportChild(job: AnnotatedImportJobRecord, req: AnnotatedImportRequest): boolean {
  const reqPath = importRequestPath(job.id)
  try {
    fs.writeFileSync(reqPath, JSON.stringify({ job, req }), "utf8")
    writeImportStateFile(job.id, job)
  } catch (error) {
    updateImportJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: error instanceof Error ? error.message : String(error),
      statusMessage: error instanceof Error ? error.message : String(error),
    })
    return false
  }

  const resolved = resolveImportChildLaunch(job.id, reqPath)
  if (!resolved.launch) {
    writeImportStage(job.id, `child launch failed: ${resolved.reason}`)
    updateImportJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: `无法启动导入子进程：${resolved.reason}`,
      statusMessage: `无法启动导入子进程：${resolved.reason}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    return false
  }
  const launch = resolved.launch
  writeImportStage(job.id, `spawn child mode=${launch.mode} ${launch.command} ${launch.args.join(" ")}`)

  const child = spawn(launch.command, launch.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: launch.cwd,
    env: {
      ...process.env,
      EA_IMPORT_CHILD: "1",
      EA_IMPORT_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) writeImportStage(job.id, `child stderr: ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncImportJobFromStateFile(job.id)
  }, 400)

  activeImportChildren.set(job.id, { child, pollTimer })

  child.on("error", (error) => {
    cleanupImportChild(job.id)
    updateImportJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: `导入子进程错误：${error.message}`,
      statusMessage: `导入子进程错误：${error.message}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
  })

  child.on("close", (code) => {
    cleanupImportChild(job.id)
    syncImportJobFromStateFile(job.id)
    const state = importJobs.get(job.id)
    if (code !== 0 && state?.status !== "success" && state?.status !== "failed") {
      updateImportJob(job.id, {
        status: "failed",
        progress: 100,
        errorMessage: `导入子进程异常退出（code=${code ?? "null"}）`,
        statusMessage: `导入子进程异常退出（code=${code ?? "null"}）`,
      })
    }
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    try {
      const finalState = importJobs.get(job.id)
      if (finalState?.status === "success" || finalState?.status === "failed") {
        fs.unlinkSync(importStatePath(job.id))
      }
    } catch {
      /* ignore */
    }
  })

  return true
}

function createImportJobRecord(req: AnnotatedImportRequest): AnnotatedImportJobRecord {
  const now = nowIso()
  return {
    id: randomUUID(),
    projectId: req.projectId,
    taskId: req.taskId,
    subset: req.subset,
    zipPath: req.zipPath,
    importFormat: req.importFormat,
    status: "queued",
    progress: 0,
    message: "等待导入…",
    statusMessage: "等待导入…",
    importedImageCount: 0,
    importedAnnotationCount: 0,
    detectedFormat: "",
    errorMessage: "",
    createdAt: now,
    updatedAt: now,
  }
}

async function runImportInProcess(job: AnnotatedImportJobRecord, req: AnnotatedImportRequest): Promise<void> {
  updateImportJob(job.id, { status: "running", progress: 1, statusMessage: "正在导入…" })
  const result = await runAnnotatedTaskZipImport(req, (patch) => {
    updateImportJob(job.id, {
      progress: patch.progress,
      statusMessage: patch.statusMessage,
      importedImageCount: patch.importedImageCount,
      importedAnnotationCount: patch.importedAnnotationCount,
    })
  })
  if (result.errorMessage) {
    updateImportJob(job.id, {
      status: "failed",
      progress: 100,
      errorMessage: result.errorMessage,
      statusMessage: result.errorMessage,
    })
    return
  }
  updateImportJob(job.id, {
    status: "success",
    progress: 100,
    importedImageCount: result.importedImageCount,
    importedAnnotationCount: result.importedAnnotationCount,
    detectedFormat: result.detectedFormat,
    statusMessage: `导入完成：${result.importedImageCount} 张图片 / ${result.importedAnnotationCount} 份标注`,
  })
}

export async function runImportFromChildArgv(jobId: string, reqPath: string): Promise<void> {
  process.env.EA_IMPORT_CHILD = "1"
  process.env.EA_IMPORT_JOB_ID = jobId
  const raw = fs.readFileSync(reqPath, "utf8")
  const payload = JSON.parse(raw) as { job: AnnotatedImportJobRecord; req: AnnotatedImportRequest }
  if (!payload?.job?.id || !payload.req) {
    throw new Error("Invalid import request payload")
  }
  importJobs.set(jobId, payload.job)
  writeImportStateFile(jobId, payload.job)
  updateImportJob(jobId, { status: "running", progress: 1, statusMessage: "正在导入…" })

  const result = await runAnnotatedTaskZipImport(payload.req, (patch) => {
    updateImportJob(jobId, {
      progress: patch.progress,
      statusMessage: patch.statusMessage,
      importedImageCount: patch.importedImageCount,
      importedAnnotationCount: patch.importedAnnotationCount,
    })
  })

  if (result.errorMessage) {
    updateImportJob(jobId, {
      status: "failed",
      progress: 100,
      errorMessage: result.errorMessage,
      statusMessage: result.errorMessage,
    })
    return
  }

  updateImportJob(jobId, {
    status: "success",
    progress: 100,
    importedImageCount: result.importedImageCount,
    importedAnnotationCount: result.importedAnnotationCount,
    detectedFormat: result.detectedFormat,
    statusMessage: `导入完成：${result.importedImageCount} 张图片 / ${result.importedAnnotationCount} 份标注`,
  })
}

export const ANNOTATED_IMPORT_EXPORT_FORMAT = "annotated-import"
export const IMPORT_JOB_META_SEP = "\n---IMPORT_META---\n"

export type AnnotatedImportJobExportItem = {
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

export function mapAnnotatedImportJobToExportJobItem(job: AnnotatedImportJobRecord): AnnotatedImportJobExportItem {
  const statusMessage = job.statusMessage || job.message || ""
  const meta = `${job.importedImageCount}|${job.importedAnnotationCount}|${job.detectedFormat || ""}`
  return {
    id: job.id,
    projectId: job.projectId,
    taskId: job.taskId,
    versionName: job.subset || "default",
    exportFormat: ANNOTATED_IMPORT_EXPORT_FORMAT,
    keepProjectStructure: false,
    outputDir: job.importFormat,
    status: job.status,
    progress: Math.max(0, Math.min(100, Math.floor(Number(job.progress) || 0))),
    message: `${statusMessage}${IMPORT_JOB_META_SEP}${meta}`,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

export function listAnnotatedTaskImportJobsForIpc(): AnnotatedImportJobRecord[] {
  return [...importJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listAnnotatedTaskImportJobsAsExportJobsForIpc(): AnnotatedImportJobExportItem[] {
  for (const job of listAnnotatedTaskImportJobsForIpc()) {
    if (job.status === "queued" || job.status === "running") {
      syncImportJobFromStateFile(job.id)
    }
  }
  return listAnnotatedTaskImportJobsForIpc()
    .slice(0, 16)
    .map(mapAnnotatedImportJobToExportJobItem)
}

export function getAnnotatedImportJobRecord(jobId: string): AnnotatedImportJobRecord | null {
  const trimmed = jobId.trim()
  if (!trimmed) return null
  syncImportJobFromStateFile(trimmed)
  return importJobs.get(trimmed) ?? null
}

export function startAnnotatedTaskImportJob(req: AnnotatedImportRequest): { jobId: string; errorMessage: string } {
  const job = createImportJobRecord(req)
  importJobs.set(job.id, job)

  const spawned = spawnImportChild(job, req)
  if (spawned) {
    return { jobId: job.id, errorMessage: "" }
  }

  const failed = importJobs.get(job.id)
  return {
    jobId: job.id,
    errorMessage:
      failed?.errorMessage ||
      failed?.statusMessage ||
      "无法启动导入子进程（请先运行 npx vite build --mode main 并重启应用）",
  }
}

export async function runAnnotatedTaskImportJobFallback(
  jobId: string,
  req: AnnotatedImportRequest,
): Promise<void> {
  const job = importJobs.get(jobId)
  if (!job) return
  await runImportInProcess(job, req)
}

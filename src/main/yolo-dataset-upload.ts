import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { readAppConfigFromDisk } from "./app-config-disk"
import { apiRootToWsUrl, uploadYoloDatasetZipViaWs } from "./backend-yolo-training-ws"

const UPLOAD_TIMEOUT_MS = 5 * 60 * 60 * 1000
const STATE_SYNC_POLL_MS = 400

export type YoloDatasetUploadJobRecord = {
  id: string
  status: "running" | "success" | "failed"
  progress: number
  phase: "uploading" | "unpacking" | "idle"
  message: string
  dataYaml: string
  datasetZipFilename: string
  errorMessage: string
}

type YoloUploadRequest = {
  jobId: string
  jobSlug: string
  sourceZipPath: string
  apiRoot: string
}

type UploadChildLaunch = {
  command: string
  args: string[]
  cwd: string
  mode: "bundled"
}

const jobs = new Map<string, YoloDatasetUploadJobRecord>()
const activeUploadChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()

function uploadRequestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-yolo-upload-req-${jobId}.json`)
}

function uploadStatePath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-yolo-upload-state-${jobId}.json`)
}

function isUploadChildProcess(): boolean {
  return process.env.EA_YOLO_UPLOAD_CHILD === "1" && Boolean(process.env.EA_YOLO_UPLOAD_JOB_ID?.trim())
}

function writeUploadStateFile(jobId: string, job: YoloDatasetUploadJobRecord): void {
  try {
    fs.writeFileSync(uploadStatePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function readUploadStateFile(jobId: string): YoloDatasetUploadJobRecord | null {
  try {
    const raw = fs.readFileSync(uploadStatePath(jobId), "utf8")
    const parsed = JSON.parse(raw) as YoloDatasetUploadJobRecord
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function syncUploadJobFromStateFile(jobId: string): void {
  const state = readUploadStateFile(jobId)
  if (!state) return
  jobs.set(jobId, state)
}

function normalizeBasePath(input: string): string {
  const t = input.trim()
  if (!t) return ""
  const withLeading = t.startsWith("/") ? t : `/${t}`
  return withLeading.replace(/\/+$/, "")
}

export function resolveApiV1Root(globalConfigDir: string): { apiRoot: string; errorMessage: string } {
  const { jsonText, exists } = readAppConfigFromDisk(globalConfigDir)
  if (!exists || !jsonText.trim()) {
    return { apiRoot: "", errorMessage: "未找到应用配置。" }
  }
  try {
    const parsed = JSON.parse(jsonText) as {
      backend?: {
        protocol?: string
        host?: string
        port?: string
        basePath?: string
        remoteConnected?: boolean
      }
    }
    const backend = parsed.backend
    if (!backend?.remoteConnected) {
      return { apiRoot: "http://127.0.0.1:8000/api/v1", errorMessage: "" }
    }
    const scheme = backend.protocol === "https" ? "https" : "http"
    const host = (backend.host || "127.0.0.1").trim()
    const port = (backend.port || "8000").trim().replace(/^:/, "")
    const base = normalizeBasePath(backend.basePath || "")
    return { apiRoot: `${scheme}://${host}:${port}${base}/api/v1`, errorMessage: "" }
  } catch {
    return { apiRoot: "", errorMessage: "应用配置 JSON 无效。" }
  }
}

function updateJob(jobId: string, patch: Partial<YoloDatasetUploadJobRecord>): void {
  const job = jobs.get(jobId)
  if (!job) return
  const next = { ...job, ...patch }
  jobs.set(jobId, next)
  writeUploadStateFile(jobId, next)
}

async function runUploadJob(
  jobId: string,
  apiRoot: string,
  jobSlug: string,
  sourceZipPath: string,
): Promise<void> {
  updateJob(jobId, { message: "连接 WebSocket…", progress: 0, phase: "uploading" })

  const wsUrl = apiRootToWsUrl(apiRoot)
  const clientId = `yolo-train-${randomUUID()}`

  try {
    const result = await uploadYoloDatasetZipViaWs({
      wsUrl,
      clientId,
      jobSlug,
      sourceZipPath,
      onChunkProgress: (done, total) => {
        const ratio = done / total
        updateJob(jobId, {
          message: `上传分片 ${done}/${total}`,
          progress: Math.min(90, Math.max(0, Math.round(ratio * 90))),
          phase: "uploading",
        })
      },
      onBeforeComplete: () => {
        updateJob(jobId, { message: "正在解压数据集…", progress: 92, phase: "unpacking" })
      },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })

    updateJob(jobId, {
      status: "success",
      progress: 100,
      phase: "idle",
      message: "上传完成",
      dataYaml: result.data_yaml,
      datasetZipFilename: result.dataset_zip_filename || path.basename(sourceZipPath),
      errorMessage: "",
    })
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
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
          /* ignore invalid package.json */
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

function resolveUploadChildLaunch(
  jobId: string,
  reqPath: string,
): { launch: UploadChildLaunch | null; reason: string } {
  const root = findProjectRoot()
  const nodeExe = resolveSystemNodeExecutable()
  if (!nodeExe) {
    return { launch: null, reason: "未找到 Node.js（请安装 Node 并加入 PATH，或安装到 Program Files\\nodejs）" }
  }
  if (!root) {
    return { launch: null, reason: `未找到项目根目录（当前 cwd=${process.cwd()}）` }
  }

  const bundledScript = path.join(root, "out", "main", "yolo-dataset-upload-child.js")
  const bundledDir = path.dirname(bundledScript)
  const bundledAssetsDir = path.join(bundledDir, "assets")

  if (!fs.existsSync(bundledScript)) {
    return {
      launch: null,
      reason: `未找到 ${bundledScript}，请在项目根目录执行：npx vite build --mode main`,
    }
  }
  if (!fs.existsSync(bundledAssetsDir)) {
    return {
      launch: null,
      reason: `缺少 ${bundledAssetsDir}，请重新执行：npx vite build --mode main`,
    }
  }

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

function cleanupUploadChild(jobId: string): void {
  const active = activeUploadChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeUploadChildren.delete(jobId)
}

function spawnUploadChild(job: YoloDatasetUploadJobRecord, req: YoloUploadRequest): boolean {
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

  const resolved = resolveUploadChildLaunch(job.id, reqPath)
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
      EA_YOLO_UPLOAD_CHILD: "1",
      EA_YOLO_UPLOAD_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.warn(`[yolo-upload:${job.id}] ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncUploadJobFromStateFile(job.id)
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
    syncUploadJobFromStateFile(job.id)
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

export async function runUploadFromChildArgv(jobId: string, reqPath: string): Promise<void> {
  process.env.EA_YOLO_UPLOAD_CHILD = "1"
  process.env.EA_YOLO_UPLOAD_JOB_ID = jobId

  const raw = await fs.promises.readFile(reqPath, "utf8")
  const req = JSON.parse(raw) as YoloUploadRequest
  if (!req?.jobId || !req?.jobSlug || !req?.sourceZipPath || !req?.apiRoot) {
    throw new Error("Invalid upload request payload")
  }

  const job: YoloDatasetUploadJobRecord = {
    id: jobId,
    status: "running",
    progress: 0,
    phase: "uploading",
    message: "开始上传…",
    dataYaml: "",
    datasetZipFilename: "",
    errorMessage: "",
  }
  jobs.set(jobId, job)
  writeUploadStateFile(jobId, job)

  await runUploadJob(jobId, req.apiRoot, req.jobSlug, req.sourceZipPath)
}

export function startYoloDatasetZipUploadFromPath(args: {
  globalConfigDir: string
  jobSlug: string
  sourceZipPath: string
}): { jobId: string; errorMessage: string } {
  const jobSlug = args.jobSlug.trim()
  const sourceZipPath = args.sourceZipPath.trim()
  if (!jobSlug) return { jobId: "", errorMessage: "训练任务 ID 为空" }
  if (!sourceZipPath) return { jobId: "", errorMessage: "未选择 zip 文件" }
  if (!fs.existsSync(sourceZipPath)) return { jobId: "", errorMessage: `源文件不存在：${sourceZipPath}` }
  if (!sourceZipPath.toLowerCase().endsWith(".zip")) return { jobId: "", errorMessage: "仅支持 .zip 文件" }

  const { apiRoot, errorMessage } = resolveApiV1Root(args.globalConfigDir)
  if (errorMessage) return { jobId: "", errorMessage }
  if (!apiRoot) return { jobId: "", errorMessage: "无法解析后端地址" }

  const jobId = randomUUID()
  const job: YoloDatasetUploadJobRecord = {
    id: jobId,
    status: "running",
    progress: 0,
    phase: "uploading",
    message: "排队中…",
    dataYaml: "",
    datasetZipFilename: "",
    errorMessage: "",
  }
  jobs.set(jobId, job)
  writeUploadStateFile(jobId, job)

  if (isUploadChildProcess()) {
    void runUploadJob(jobId, apiRoot, jobSlug, sourceZipPath).catch((error) => {
      updateJob(jobId, {
        status: "failed",
        progress: 100,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    })
    return { jobId, errorMessage: "" }
  }

  const req: YoloUploadRequest = { jobId, jobSlug, sourceZipPath, apiRoot }
  spawnUploadChild(job, req)

  return { jobId, errorMessage: "" }
}

export function getYoloDatasetZipUploadJob(jobId: string): YoloDatasetUploadJobRecord | null {
  const trimmed = jobId.trim()
  if (!trimmed) return null
  syncUploadJobFromStateFile(trimmed)
  return jobs.get(trimmed) ?? null
}

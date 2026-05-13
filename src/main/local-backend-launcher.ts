import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "@mobrowser/api"

/** 与 backend/start.ps1 中 uvicorn 端口一致 */
const LOCAL_BACKEND_HEALTH_URL = "http://127.0.0.1:8000/health"

const LOCK_FILE = "ea-local-backend.lock.json"

/** 仅当本进程通过 StartLocalBackend 成功拉起 Python 时非空；不关用户自行启动的同名服务 */
let backendChild: ChildProcess | null = null

/** 同一主进程内串行化「启动后端」，避免连点并发 */
let startMutex: Promise<void> = Promise.resolve()

function lockPath(): string {
  return path.join(app.getPath("userData"), LOCK_FILE)
}

function isEexist(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as NodeJS.ErrnoException).code === "EEXIST"
}

type LockDoc = {
  claimingMainPid?: number
  backendPid?: number
  at?: number
}

function readLockDoc(): LockDoc | null {
  try {
    const raw = fs.readFileSync(lockPath(), "utf8")
    return JSON.parse(raw) as LockDoc
  } catch {
    return null
  }
}

function removeLockFile(): void {
  try {
    fs.unlinkSync(lockPath())
  } catch {
    /* ignore */
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 锁文件残留：后端 PID 已死、或仅占坑且主进程已死则删除 */
function cleanupDeadLock(): void {
  if (!fs.existsSync(lockPath())) return
  const doc = readLockDoc()
  if (!doc) {
    removeLockFile()
    return
  }
  const backendPid = doc.backendPid
  const claimPid = doc.claimingMainPid
  if (typeof backendPid === "number") {
    if (!isProcessAlive(backendPid)) removeLockFile()
    return
  }
  if (typeof claimPid === "number" && !isProcessAlive(claimPid)) removeLockFile()
}

function writeLockClaiming(): void {
  const dir = path.dirname(lockPath())
  fs.mkdirSync(dir, { recursive: true })
  const fd = fs.openSync(lockPath(), "wx")
  try {
    const payload = JSON.stringify({ claimingMainPid: process.pid, at: Date.now() })
    fs.writeSync(fd, payload, 0, "utf8")
  } finally {
    fs.closeSync(fd)
  }
}

function writeLockWithBackendPid(backendPid: number): void {
  fs.writeFileSync(
    lockPath(),
    JSON.stringify({
      claimingMainPid: process.pid,
      backendPid,
      at: Date.now(),
    }),
    "utf8",
  )
}

/** 仅清除本进程占坑、尚未写入 backendPid 的锁（启动失败时） */
function releaseOurClaimLock(): void {
  const doc = readLockDoc()
  if (doc?.claimingMainPid === process.pid && doc.backendPid == null) {
    removeLockFile()
  }
}

function clearLockIfBackendPid(pid: number | undefined): void {
  if (pid == null) return
  try {
    const doc = readLockDoc()
    if (doc?.backendPid === pid) removeLockFile()
  } catch {
    /* ignore */
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitForHealth(maxMs: number, stepMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await probeLocalBackendHealth()) return true
    await sleep(stepMs)
  }
  return false
}

/**
 * 跨进程互斥：独占创建锁文件；若已被占用则等待 /health 就绪（另一实例正在起服务）。
 * @returns claimed | already-up | blocked
 */
async function claimLockOrWaitForBackend(): Promise<"claimed" | "already-up" | "blocked"> {
  cleanupDeadLock()
  if (await probeLocalBackendHealth()) return "already-up"

  try {
    writeLockClaiming()
    return "claimed"
  } catch (e) {
    if (!isEexist(e)) throw e
  }

  if (await waitForHealth(8000, 400)) return "already-up"

  cleanupDeadLock()
  if (await probeLocalBackendHealth()) return "already-up"

  if (fs.existsSync(lockPath())) {
    const doc = readLockDoc()
    const b = doc?.backendPid
    const c = doc?.claimingMainPid
    if (typeof b === "number" && isProcessAlive(b)) return "blocked"
    if (typeof c === "number" && isProcessAlive(c)) return "blocked"
  }

  removeLockFile()
  try {
    writeLockClaiming()
    return "claimed"
  } catch (e2) {
    if (isEexist(e2)) return "blocked"
    throw e2
  }
}

function withStartMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = startMutex.then(fn)
  startMutex = next.then(
    () => {},
    () => {},
  )
  return next
}

/**
 * 退出应用时结束由本应用拉起的本地 Python 后端（含子进程树）。
 * 若后端是用户手动开的或检测为已在运行而未 spawn，则不会杀进程。
 */
export function stopEmbeddedPythonBackend(): boolean {
  const child = backendChild
  if (!child) return false
  backendChild = null
  const pid = child.pid
  try {
    child.removeAllListeners()
  } catch {
    /* ignore */
  }
  if (pid == null) return false
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
    } else {
      child.kill("SIGTERM")
    }
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {
      /* ignore */
    }
  } finally {
    clearLockIfBackendPid(pid)
  }
  return true
}

export async function probeLocalBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_BACKEND_HEALTH_URL, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

function isBackendRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, "start.ps1")) || fs.existsSync(path.join(dir, "start.bat"))
}

/**
 * 自动解析 `backend` 目录（需含 start.ps1，或旧版 start.bat）。
 * 顺序：cwd、主进程 bundle 相对路径、打包资源目录。
 */
export function resolveAutoBackendDirectory(): string | null {
  const tryDir = (dir: string): string | null => {
    if (isBackendRoot(dir)) return dir
    return null
  }

  const cwdCandidate = path.join(process.cwd(), "backend")
  const fromCwd = tryDir(cwdCandidate)
  if (fromCwd) return fromCwd

  const mainDir = path.dirname(fileURLToPath(import.meta.url))
  const fromOutMain = path.resolve(mainDir, "..", "..", "backend")
  const fromBundle = tryDir(fromOutMain)
  if (fromBundle) return fromBundle

  const resourcesBackend = path.join(app.getPath("appResources"), "backend")
  return tryDir(resourcesBackend)
}

export async function startEmbeddedPythonBackend(userBackendDirectory?: string): Promise<{
  ok: boolean
  errorMessage: string
  alreadyRunning: boolean
}> {
  return withStartMutex(() => startEmbeddedPythonBackendBody(userBackendDirectory))
}

async function startEmbeddedPythonBackendBody(userBackendDirectory?: string): Promise<{
  ok: boolean
  errorMessage: string
  alreadyRunning: boolean
}> {
  if (await probeLocalBackendHealth()) {
    return { ok: true, errorMessage: "", alreadyRunning: true }
  }

  if (process.platform !== "win32") {
    return {
      ok: false,
      errorMessage: "应用内启动本地后端目前仅支持 Windows（需要 backend 下 python-embed 与 start.ps1）。",
      alreadyRunning: false,
    }
  }

  const claim = await claimLockOrWaitForBackend()
  if (claim === "already-up") {
    return { ok: true, errorMessage: "", alreadyRunning: true }
  }
  if (claim === "blocked") {
    return {
      ok: false,
      errorMessage:
        "已有其他应用实例正在启动或占用本地后端，请稍候再试；若长时间不可用，可关闭多余的 EasyAnnotate 窗口后重试。",
      alreadyRunning: false,
    }
  }

  if (await probeLocalBackendHealth()) {
    releaseOurClaimLock()
    return { ok: true, errorMessage: "", alreadyRunning: true }
  }

  const trimmed = userBackendDirectory?.trim() ?? ""
  let backendDir: string | null = null
  if (trimmed) {
    const root = path.normalize(trimmed)
    if (isBackendRoot(root)) {
      backendDir = root
    } else {
      releaseOurClaimLock()
      return {
        ok: false,
        errorMessage: "所选目录中未找到 start.ps1（或旧版 start.bat），请选择包含便携后端的根目录。",
        alreadyRunning: false,
      }
    }
  } else {
    backendDir = resolveAutoBackendDirectory()
    if (!backendDir) {
      releaseOurClaimLock()
      return {
        ok: false,
        errorMessage: "未找到 backend 目录。请在上方选择目录，或保持项目内存在含 start.ps1 的 backend 文件夹。",
        alreadyRunning: false,
      }
    }
  }

  const pythonExe = path.join(backendDir, "python-embed", "python.exe")
  if (!fs.existsSync(pythonExe)) {
    releaseOurClaimLock()
    return {
      ok: false,
      errorMessage: `未找到便携 Python：${pythonExe}（请确认 backend 内含 python-embed）`,
      alreadyRunning: false,
    }
  }

  try {
    const child = spawn(
      pythonExe,
      ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
      {
        cwd: backendDir,
        detached: false,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, PYTHONNOUSERSITE: "1" },
      },
    )
    child.on("error", () => {
      if (backendChild === child) backendChild = null
      clearLockIfBackendPid(child.pid)
      releaseOurClaimLock()
    })
    child.on("exit", () => {
      if (backendChild === child) backendChild = null
      clearLockIfBackendPid(child.pid)
    })
    backendChild = child
    if (child.pid != null) {
      writeLockWithBackendPid(child.pid)
    }
    return { ok: true, errorMessage: "", alreadyRunning: false }
  } catch (error) {
    releaseOurClaimLock()
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      alreadyRunning: false,
    }
  }
}

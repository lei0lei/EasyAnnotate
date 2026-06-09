import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveChildScriptLaunch } from "./child-process-launch.js"

const ONNX2TENSORRT_EXE_NAME = "onnx2TensorRT.exe"
const ENGINE_POLL_MS = 500
const ENGINE_POLL_AFTER_EXIT_MS = 15_000
const STATE_SYNC_POLL_MS = 400

export type TensorRtConversionJobStatus = "queued" | "running" | "success" | "failed"

export type TensorRtConversionJobRecord = {
  id: string
  status: TensorRtConversionJobStatus
  message: string
  errorMessage: string
  enginePath: string
  logPath: string
  startedAt: string
  createdAt: string
  updatedAt: string
}

type TensorRtConversionRequest = {
  toolDir: string
  exePath: string
  outputDir: string
  onnxFileName: string
  engineFileName: string
  enginePath: string
  logPath: string
  scriptPath: string
}

type TensorRtChildLaunch = {
  command: string
  args: string[]
  cwd: string
  mode: "packaged" | "dev"
}

const jobs = new Map<string, TensorRtConversionJobRecord>()
const activeChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()

function nowIso(): string {
  return new Date().toISOString()
}

function conversionRequestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-tensorrt-conv-req-${jobId}.json`)
}

function conversionStatePath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-tensorrt-conv-state-${jobId}.json`)
}

function isTensorRtConversionChildProcess(): boolean {
  return process.env.EA_TENSORRT_CONV_CHILD === "1" && Boolean(process.env.EA_TENSORRT_CONV_JOB_ID?.trim())
}

function writeConversionStateFile(jobId: string, job: TensorRtConversionJobRecord): void {
  try {
    fs.writeFileSync(conversionStatePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function readConversionStateFile(jobId: string): TensorRtConversionJobRecord | null {
  try {
    const raw = fs.readFileSync(conversionStatePath(jobId), "utf8")
    const parsed = JSON.parse(raw) as TensorRtConversionJobRecord
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function syncTensorRtConversionJobFromStateFile(jobId: string): void {
  const state = readConversionStateFile(jobId)
  if (!state) return
  jobs.set(jobId, state)
}

function updateJob(jobId: string, patch: Partial<TensorRtConversionJobRecord>): void {
  const current = jobs.get(jobId)
  if (!current) return
  const next: TensorRtConversionJobRecord = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  }
  jobs.set(jobId, next)
  if (isTensorRtConversionChildProcess() || patch.status === "success" || patch.status === "failed") {
    writeConversionStateFile(jobId, next)
  }
}

function resolveOnnx2TensorRtExe(toolDir: string): string {
  return path.join(path.normalize(toolDir.trim()), ONNX2TENSORRT_EXE_NAME)
}

function resolvePowerShellExe(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR
  if (systemRoot) {
    return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  }
  return "powershell.exe"
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readLogTail(logPath: string, maxBytes = 8000): string {
  if (!logPath || !fs.existsSync(logPath)) return ""
  try {
    const stat = fs.statSync(logPath)
    if (stat.size <= 0) return ""
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(logPath, "r")
    try {
      const buf = Buffer.alloc(stat.size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString("utf8").trim()
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ""
  }
}

async function waitForEngineFile(enginePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(enginePath)) return true
    await sleep(ENGINE_POLL_MS)
  }
  return fs.existsSync(enginePath)
}

function removeFilesQuietly(filePaths: string[]): void {
  for (const filePath of filePaths) {
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* ignore */
    }
  }
}

function buildPowerShellScript(args: TensorRtConversionRequest): string {
  const { toolDir, exePath, outputDir, onnxFileName, engineFileName, enginePath, logPath } = args
  const onnxPath = path.join(outputDir, onnxFileName)
  return [
    "$ErrorActionPreference = 'Continue'",
    `function Write-Log([string]$Message) {`,
    `  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"`,
    `  Add-Content -LiteralPath '${escapePowerShellSingleQuoted(logPath)}' -Value $line -Encoding UTF8`,
    `}`,
    `Set-Location -LiteralPath '${escapePowerShellSingleQuoted(outputDir)}'`,
    `Write-Log 'TensorRT conversion started'`,
    `Write-Log 'tool_dir=${escapePowerShellSingleQuoted(toolDir)}'`,
    `Write-Log 'output_dir=${escapePowerShellSingleQuoted(outputDir)}'`,
    `Write-Log "command: & '${escapePowerShellSingleQuoted(exePath)}' '.\\${escapePowerShellSingleQuoted(onnxFileName)}' '${escapePowerShellSingleQuoted(engineFileName)}'"`,
    `if (-not (Test-Path -LiteralPath '${escapePowerShellSingleQuoted(onnxPath)}')) {`,
    `  Write-Log 'ERROR: ONNX not found: ${escapePowerShellSingleQuoted(onnxPath)}'`,
    `  exit 3`,
    `}`,
    `& '${escapePowerShellSingleQuoted(exePath)}' '.\\${escapePowerShellSingleQuoted(onnxFileName)}' '${escapePowerShellSingleQuoted(engineFileName)}' *>> '${escapePowerShellSingleQuoted(logPath)}' 2>&1`,
    `$code = $LASTEXITCODE`,
    `if (-not (Test-Path -LiteralPath '${escapePowerShellSingleQuoted(enginePath)}')) {`,
    `  Write-Log 'retry from tool_dir'`,
    `  Set-Location -LiteralPath '${escapePowerShellSingleQuoted(toolDir)}'`,
    `  & '${escapePowerShellSingleQuoted(exePath)}' '${escapePowerShellSingleQuoted(onnxPath)}' '${escapePowerShellSingleQuoted(enginePath)}' *>> '${escapePowerShellSingleQuoted(logPath)}' 2>&1`,
    `  $code = $LASTEXITCODE`,
    `}`,
    `if (Test-Path -LiteralPath '${escapePowerShellSingleQuoted(enginePath)}') {`,
    `  Write-Log 'engine_ready'`,
    `} else {`,
    `  Write-Log 'engine_missing: ${escapePowerShellSingleQuoted(enginePath)}'`,
    `}`,
    `Write-Log "exit_code=$code"`,
    `exit $code`,
  ].join("\r\n")
}

function runPowerShellScript(scriptPath: string, outputDir: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolvePowerShellExe(),
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
      {
        cwd: outputDir,
        windowsHide: true,
        stdio: "ignore",
      },
    )
    child.on("error", reject)
    child.on("close", (code) => resolve(code))
  })
}

function buildFailureMessage(args: {
  code: number | null
  engineFileName: string
  logPath: string
  manualScriptPath: string
}): string {
  const logTail = readLogTail(args.logPath)
  const base =
    args.code === null
      ? "转换进程异常退出（可能应用重启或进程被终止）"
      : args.code === 0
        ? `转换结束但未生成 ${args.engineFileName}`
        : `转换失败（退出码 ${args.code}）`
  const parts = [base]
  if (logTail) {
    parts.push(`日志摘要：\n${logTail.slice(-2000)}`)
  }
  if (args.manualScriptPath) {
    parts.push(`可手动在 PowerShell 中运行：powershell -ExecutionPolicy Bypass -File "${args.manualScriptPath}"`)
  }
  if (args.logPath) {
    parts.push(`完整日志：${args.logPath}`)
  }
  return parts.join("\n\n")
}

function resolveTensorRtChildLaunch(
  jobId: string,
  reqPath: string,
): { launch: TensorRtChildLaunch | null; reason: string } {
  const resolved = resolveChildScriptLaunch("tensorrt-conversion-child.js", [jobId, reqPath], {
    requireAssets: false,
  })
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

function cleanupTensorRtChild(jobId: string): void {
  const active = activeChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeChildren.delete(jobId)
}

function spawnTensorRtChild(job: TensorRtConversionJobRecord, req: TensorRtConversionRequest): boolean {
  const reqPath = conversionRequestPath(job.id)
  try {
    fs.writeFileSync(reqPath, JSON.stringify(req), "utf8")
    writeConversionStateFile(job.id, job)
  } catch (error) {
    updateJob(job.id, {
      status: "failed",
      message: "转换失败",
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return false
  }

  const resolved = resolveTensorRtChildLaunch(job.id, reqPath)
  if (!resolved.launch) {
    updateJob(job.id, {
      status: "failed",
      message: "转换失败",
      errorMessage: `无法启动转换子进程：${resolved.reason}`,
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
      EA_TENSORRT_CONV_CHILD: "1",
      EA_TENSORRT_CONV_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.warn(`[tensorrt-conv:${job.id}] ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncTensorRtConversionJobFromStateFile(job.id)
  }, STATE_SYNC_POLL_MS)

  activeChildren.set(job.id, { child, pollTimer })

  child.on("error", (error) => {
    cleanupTensorRtChild(job.id)
    updateJob(job.id, {
      status: "failed",
      message: "转换失败",
      errorMessage: `转换子进程错误：${error.message}`,
    })
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
  })

  child.on("close", () => {
    cleanupTensorRtChild(job.id)
    syncTensorRtConversionJobFromStateFile(job.id)
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    try {
      const state = jobs.get(job.id)
      if (state?.status === "success" || state?.status === "failed") {
        fs.unlinkSync(conversionStatePath(job.id))
      }
    } catch {
      /* ignore */
    }
  })

  return true
}

export async function runTensorRtConversionFromChildArgv(jobId: string, reqPath: string): Promise<void> {
  process.env.EA_TENSORRT_CONV_CHILD = "1"
  process.env.EA_TENSORRT_CONV_JOB_ID = jobId

  const raw = await fs.promises.readFile(reqPath, "utf8")
  const req = JSON.parse(raw) as TensorRtConversionRequest
  if (!req?.toolDir || !req?.exePath || !req?.outputDir || !req?.onnxFileName || !req?.engineFileName) {
    throw new Error("Invalid TensorRT conversion request payload")
  }

  const startedAt = nowIso()
  const job: TensorRtConversionJobRecord = {
    id: jobId,
    status: "running",
    message: "正在转换，请稍候…",
    errorMessage: "",
    enginePath: req.enginePath,
    logPath: req.logPath,
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  }
  jobs.set(jobId, job)
  writeConversionStateFile(jobId, job)

  fs.writeFileSync(req.scriptPath, buildPowerShellScript(req), "utf8")

  let exitCode: number | null = 1
  try {
    exitCode = await runPowerShellScript(req.scriptPath, req.outputDir)
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      message: "转换失败",
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return
  }

  const engineReady = await waitForEngineFile(req.enginePath, ENGINE_POLL_AFTER_EXIT_MS)
  if (engineReady) {
    removeFilesQuietly([req.scriptPath])
    updateJob(jobId, {
      status: "success",
      message: `转换完成：${req.engineFileName}`,
      errorMessage: "",
      logPath: req.logPath,
    })
    return
  }

  updateJob(jobId, {
    status: "failed",
    message: "转换失败",
    errorMessage: buildFailureMessage({
      code: exitCode,
      engineFileName: req.engineFileName,
      logPath: req.logPath,
      manualScriptPath: req.scriptPath,
    }),
    logPath: req.logPath,
  })
}

export function checkOnnx2TensorRtTool(toolDir: string): {
  toolDirExists: boolean
  exeExists: boolean
  exePath: string
} {
  const trimmed = toolDir.trim()
  const exePath = resolveOnnx2TensorRtExe(trimmed)
  return {
    toolDirExists: trimmed.length > 0 && fs.existsSync(trimmed),
    exeExists: trimmed.length > 0 && fs.existsSync(exePath),
    exePath,
  }
}

export function copyOnnxToTensorRtOutputDir(
  sourceOnnxPath: string,
  outputDir: string,
): { ok: boolean; destPath: string; fileName: string; errorMessage: string } {
  const sourcePath = sourceOnnxPath.trim()
  const targetDir = path.normalize(outputDir.trim())
  if (!sourcePath) {
    return { ok: false, destPath: "", fileName: "", errorMessage: "未选择 ONNX 源文件" }
  }
  if (!targetDir) {
    return { ok: false, destPath: "", fileName: "", errorMessage: "未选择 TensorRT 模型保存路径" }
  }
  if (!fs.existsSync(sourcePath)) {
    return { ok: false, destPath: "", fileName: "", errorMessage: `源文件不存在：${sourcePath}` }
  }
  if (!sourcePath.toLowerCase().endsWith(".onnx")) {
    return { ok: false, destPath: "", fileName: "", errorMessage: "仅支持 .onnx 文件" }
  }
  try {
    fs.mkdirSync(targetDir, { recursive: true })
    const fileName = path.basename(sourcePath)
    const destPath = path.join(targetDir, fileName)
    fs.copyFileSync(sourcePath, destPath)
    return { ok: true, destPath, fileName, errorMessage: "" }
  } catch (error) {
    return {
      ok: false,
      destPath: "",
      fileName: "",
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

export function getTensorRtConversionJob(jobId: string): TensorRtConversionJobRecord | null {
  const id = jobId.trim()
  if (!id) return null
  syncTensorRtConversionJobFromStateFile(id)
  return jobs.get(id) ?? null
}

export function startTensorRtConversion(args: {
  onnx2tensorRtDir: string
  outputDir: string
  onnxFileName: string
}): { jobId: string; errorMessage: string } {
  const toolDir = path.normalize(args.onnx2tensorRtDir.trim())
  const outputDir = path.normalize(args.outputDir.trim())
  const onnxFileName = path.basename(args.onnxFileName.trim())

  if (!toolDir) {
    return { jobId: "", errorMessage: "请先在设置中配置 onnx2tensorRT 路径" }
  }
  const exePath = resolveOnnx2TensorRtExe(toolDir)
  if (!fs.existsSync(exePath)) {
    return { jobId: "", errorMessage: `未找到 ${ONNX2TENSORRT_EXE_NAME}：${exePath}` }
  }
  if (!outputDir) {
    return { jobId: "", errorMessage: "请选择 TensorRT 模型保存路径" }
  }
  if (!onnxFileName.toLowerCase().endsWith(".onnx")) {
    return { jobId: "", errorMessage: "ONNX 文件名无效" }
  }

  const onnxPath = path.join(outputDir, onnxFileName)
  if (!fs.existsSync(onnxPath)) {
    return { jobId: "", errorMessage: `ONNX 文件不存在：${onnxPath}` }
  }

  const engineFileName = `${path.parse(onnxFileName).name}.engine`
  const enginePath = path.join(outputDir, engineFileName)
  const runId = randomUUID().slice(0, 8)
  const logPath = path.join(outputDir, `tensorrt-convert-${runId}.log`)
  const scriptPath = path.join(outputDir, `tensorrt-run-${runId}.ps1`)

  const jobId = randomUUID()
  const startedAt = nowIso()
  const job: TensorRtConversionJobRecord = {
    id: jobId,
    status: "running",
    message: "正在启动转换子进程…",
    errorMessage: "",
    enginePath,
    logPath,
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  }
  jobs.set(jobId, job)

  const req: TensorRtConversionRequest = {
    toolDir,
    exePath,
    outputDir,
    onnxFileName,
    engineFileName,
    enginePath,
    logPath,
    scriptPath,
  }

  const spawned = spawnTensorRtChild(job, req)
  if (!spawned) {
    const failed = jobs.get(jobId)
    return { jobId: "", errorMessage: failed?.errorMessage || "启动转换子进程失败" }
  }

  return { jobId, errorMessage: "" }
}

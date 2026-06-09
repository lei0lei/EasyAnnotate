import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveChildScriptLaunch } from "./child-process-launch.js"
import {
  beginExportJob,
  exportStatePath,
  listDatasetExportJobs,
  syncExportJobFromStateFile,
  updateJob,
  type ExportJobRecord,
  type ExportRequest,
} from "./dataset-export.js"

const activeExportChildren = new Map<string, { child: ChildProcess; pollTimer: ReturnType<typeof setInterval> }>()

function exportRequestPath(jobId: string): string {
  return path.join(os.tmpdir(), `ea-export-req-${jobId}.json`)
}

function writeExportStateFile(jobId: string, job: ExportJobRecord): void {
  try {
    fs.writeFileSync(exportStatePath(jobId), JSON.stringify(job), "utf8")
  } catch {
    /* ignore */
  }
}

function writeExportStage(jobId: string, stage: string): void {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), `easyannotate-export-${jobId}.stage.log`), `${new Date().toISOString()} ${stage}\n`, "utf8")
  } catch {
    /* ignore */
  }
}

function cleanupExportChild(jobId: string): void {
  const active = activeExportChildren.get(jobId)
  if (!active) return
  clearInterval(active.pollTimer)
  activeExportChildren.delete(jobId)
}

function failExportJob(job: ExportJobRecord, message: string): void {
  updateJob(job.id, {
    status: "failed",
    progress: 100,
    statusMessage: message,
    message,
  })
}

function spawnExportChild(job: ExportJobRecord, req: ExportRequest): void {
  const reqPath = exportRequestPath(job.id)
  try {
    fs.writeFileSync(reqPath, JSON.stringify({ job, req }), "utf8")
    writeExportStateFile(job.id, job)
  } catch (error) {
    failExportJob(job, error instanceof Error ? error.message : String(error))
    return
  }

  const resolved = resolveChildScriptLaunch("dataset-export-child.js", [job.id, reqPath])
  if (!resolved.launch) {
    writeExportStage(job.id, `child launch failed: ${resolved.reason}`)
    failExportJob(job, `无法启动导出子进程：${resolved.reason}`)
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    return
  }
  const launch = resolved.launch

  writeExportStage(job.id, `spawn child mode=${launch.mode} ${launch.command} ${launch.args.join(" ")}`)

  const child = spawn(launch.command, launch.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: launch.cwd,
    env: {
      ...process.env,
      EA_EXPORT_CHILD: "1",
      EA_EXPORT_JOB_ID: job.id,
    },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) writeExportStage(job.id, `child stderr: ${text.slice(0, 200)}`)
  })

  const pollTimer = setInterval(() => {
    syncExportJobFromStateFile(job.id)
  }, 400)

  activeExportChildren.set(job.id, { child, pollTimer })

  child.on("error", (error) => {
    cleanupExportChild(job.id)
    failExportJob(job, `导出子进程错误：${error.message}`)
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
  })

  child.on("close", (code) => {
    cleanupExportChild(job.id)
    syncExportJobFromStateFile(job.id)
    const state = listDatasetExportJobs().find((item) => item.id === job.id)
    if (code !== 0 && state?.status !== "success" && state?.status !== "failed") {
      failExportJob(job, `导出子进程异常退出（code=${code ?? "null"}）`)
    }
    try {
      fs.unlinkSync(reqPath)
    } catch {
      /* ignore */
    }
    try {
      const finalState = listDatasetExportJobs().find((item) => item.id === job.id)
      if (finalState?.status === "success" || finalState?.status === "failed") {
        fs.unlinkSync(exportStatePath(job.id))
      }
    } catch {
      /* ignore */
    }
  })
}

/** YOLO / X-AnyLabeling 导出：仅使用子进程，不回退主进程 */
export function startStreamingDatasetExportJob(req: ExportRequest): { jobId: string } {
  const job = beginExportJob(req)
  setImmediate(() => {
    spawnExportChild(job, req)
  })
  return { jobId: job.id }
}

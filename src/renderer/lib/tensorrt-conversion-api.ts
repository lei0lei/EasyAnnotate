import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"

export type TensorRtConversionJobStatus = "queued" | "running" | "success" | "failed"

export type TensorRtConversionJob = {
  id: string
  status: TensorRtConversionJobStatus
  message: string
  errorMessage: string
  enginePath: string
  startedAt: string
  logPath: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function getOnnx2tensorRtDir(): string {
  return loadAppConfig().storagePaths.onnx2tensorRtDir.trim()
}

export async function checkOnnx2TensorRtTool(): Promise<{
  toolDirExists: boolean
  exeExists: boolean
  exePath: string
}> {
  const res = await ipc.app.CheckOnnx2TensorRtTool({
    onnx2tensorRtDir: getOnnx2tensorRtDir(),
  })
  return {
    toolDirExists: Boolean(res.toolDirExists),
    exeExists: Boolean(res.exeExists),
    exePath: res.exePath?.trim() ?? "",
  }
}

export async function copyOnnxToTensorRtOutputDir(
  sourceOnnxPath: string,
  outputDir: string,
): Promise<{ destPath: string; fileName: string }> {
  const res = await ipc.app.CopyOnnxToTensorRtOutputDir({
    sourceOnnxPath,
    outputDir,
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "复制 ONNX 文件失败")
  }
  return {
    destPath: res.destPath?.trim() ?? "",
    fileName: res.fileName?.trim() ?? "",
  }
}

export async function startTensorRtConversion(
  outputDir: string,
  onnxFileName: string,
): Promise<string> {
  const res = await ipc.app.StartTensorRtConversion({
    onnx2tensorRtDir: getOnnx2tensorRtDir(),
    outputDir,
    onnxFileName,
  })
  const jobId = res.jobId?.trim() ?? ""
  if (!jobId) {
    throw new Error(res.errorMessage?.trim() || "启动 TensorRT 转换失败")
  }
  return jobId
}

export async function getTensorRtConversionJob(jobId: string): Promise<TensorRtConversionJob | null> {
  const res = await ipc.app.GetTensorRtConversionJob({ jobId })
  if (!res.found || !res.job) return null
  const status = res.job.status?.trim() as TensorRtConversionJobStatus
  return {
    id: res.job.id?.trim() ?? jobId,
    status,
    message: res.job.message?.trim() ?? "",
    errorMessage: res.job.errorMessage?.trim() ?? "",
    enginePath: res.job.enginePath?.trim() ?? "",
    startedAt: res.job.startedAt?.trim() ?? "",
    logPath: res.job.logPath?.trim() ?? "",
  }
}

export async function waitTensorRtConversionJob(
  jobId: string,
  options?: { onUpdate?: (job: TensorRtConversionJob) => void; pollMs?: number },
): Promise<TensorRtConversionJob> {
  const pollMs = options?.pollMs ?? 500
  for (;;) {
    const job = await getTensorRtConversionJob(jobId)
    if (!job) {
      throw new Error("转换任务不存在")
    }
    options?.onUpdate?.(job)
    if (job.status === "success" || job.status === "failed") {
      if (job.status === "failed") {
        throw new Error(job.errorMessage || job.message || "TensorRT 转换失败")
      }
      return job
    }
    await sleep(pollMs)
  }
}

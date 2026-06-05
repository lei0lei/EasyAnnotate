import fs from "node:fs"
import { randomUUID } from "node:crypto"
import { uploadYoloBatchFileViaWs, type YoloBatchUploadKind } from "./backend-yolo-batch-ws"
import { apiRootToWsUrl } from "./backend-yolo-training-ws"
import { resolveApiV1Root } from "./yolo-dataset-upload"

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

const jobs = new Map<string, YoloBatchFileUploadJobRecord>()

function updateJob(jobId: string, patch: Partial<YoloBatchFileUploadJobRecord>): void {
  const prev = jobs.get(jobId)
  if (!prev) return
  jobs.set(jobId, { ...prev, ...patch })
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

export function startYoloBatchFileUploadFromPath(args: {
  globalConfigDir: string
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

  const { apiRoot, errorMessage } = resolveApiV1Root(args.globalConfigDir)
  if (errorMessage) return { jobId: "", errorMessage }
  if (!apiRoot) return { jobId: "", errorMessage: "无法解析后端地址" }

  const jobId = randomUUID()
  jobs.set(jobId, {
    id: jobId,
    kind,
    status: "running",
    progress: 0,
    message: "开始上传…",
    dataYaml: "",
    weightsPt: "",
    errorMessage: "",
  })

  void (async () => {
    try {
      const result = await uploadYoloBatchFileViaWs({
        kind,
        wsUrl: apiRootToWsUrl(apiRoot),
        clientId: `yolo-batch-${randomUUID()}`,
        modelSlug,
        sourcePath,
        onChunkProgress: (done, total) => {
          const progress = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0
          updateJob(jobId, { progress, message: `上传分片 ${done}/${total}` })
        },
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
  })()

  return { jobId, errorMessage: "" }
}

export function getYoloBatchFileUploadJob(jobId: string): YoloBatchFileUploadJobRecord | null {
  const trimmed = jobId.trim()
  if (!trimmed) return null
  return jobs.get(trimmed) ?? null
}

export function startYoloBatchWeightsUploadFromPath(args: {
  globalConfigDir: string
  modelSlug: string
  sourcePtPath: string
}): { jobId: string; errorMessage: string } {
  return startYoloBatchFileUploadFromPath({
    globalConfigDir: args.globalConfigDir,
    modelSlug: args.modelSlug,
    kind: "weights",
    sourcePath: args.sourcePtPath,
  })
}

export function getYoloBatchWeightsUploadJob(jobId: string): YoloBatchFileUploadJobRecord | null {
  return getYoloBatchFileUploadJob(jobId)
}

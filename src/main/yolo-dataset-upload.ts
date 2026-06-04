import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { readAppConfigFromDisk } from "./app-config-disk"

const CHUNK_SIZE = 5 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000
const COMPLETE_TIMEOUT_MS = 30 * 60 * 1000

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

const jobs = new Map<string, YoloDatasetUploadJobRecord>()

function normalizeBasePath(input: string): string {
  const t = input.trim()
  if (!t) return ""
  const withLeading = t.startsWith("/") ? t : `/${t}`
  return withLeading.replace(/\/+$/, "")
}

function resolveApiV1Root(globalConfigDir: string): { apiRoot: string; errorMessage: string } {
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

function httpRequest(
  url: string,
  options: {
    method: string
    headers?: Record<string, string>
    body?: Buffer
    timeoutMs: number
  },
): Promise<{ ok: boolean; status: number; body: Buffer; errorMessage: string }> {
  return new Promise((resolve) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      resolve({ ok: false, status: 0, body: Buffer.alloc(0), errorMessage: "无效 URL" })
      return
    }
    const lib = parsed.protocol === "https:" ? https : http
    const req = lib.request(
      parsed,
      { method: options.method, headers: options.headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on("end", () => {
          const body = Buffer.concat(chunks)
          const status = res.statusCode ?? 0
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body,
            errorMessage: status >= 200 && status < 300 ? "" : body.toString("utf8").slice(0, 500) || res.statusMessage || `HTTP ${status}`,
          })
        })
      },
    )
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error("请求超时"))
    })
    req.on("error", (err) => {
      resolve({
        ok: false,
        status: 0,
        body: Buffer.alloc(0),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    })
    if (options.body && options.body.length > 0) {
      req.write(options.body)
    }
    req.end()
  })
}

function updateJob(jobId: string, patch: Partial<YoloDatasetUploadJobRecord>): void {
  const job = jobs.get(jobId)
  if (!job) return
  jobs.set(jobId, { ...job, ...patch })
}

async function runUploadJob(
  jobId: string,
  apiRoot: string,
  jobSlug: string,
  sourceZipPath: string,
): Promise<void> {
  const stat = fs.statSync(sourceZipPath)
  const totalSize = stat.size
  const filename = path.basename(sourceZipPath)
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
  const yoloRoot = `${apiRoot}/training/yolo`

  updateJob(jobId, { message: "初始化上传…", progress: 0, phase: "uploading" })

  const initRes = await httpRequest(`${yoloRoot}/dataset/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(
      JSON.stringify({
        job_slug: jobSlug,
        filename,
        total_size: totalSize,
      }),
      "utf8",
    ),
    timeoutMs: 60_000,
  })
  if (!initRes.ok) {
    updateJob(jobId, { status: "failed", progress: 100, errorMessage: initRes.errorMessage || "初始化上传失败" })
    return
  }

  let uploadId = ""
  try {
    const initJson = JSON.parse(initRes.body.toString("utf8")) as { upload_id?: string }
    uploadId = initJson.upload_id || ""
  } catch {
    updateJob(jobId, { status: "failed", progress: 100, errorMessage: "初始化响应无效" })
    return
  }
  if (!uploadId) {
    updateJob(jobId, { status: "failed", progress: 100, errorMessage: "初始化响应缺少 upload_id" })
    return
  }

  const fd = fs.openSync(sourceZipPath, "r")
  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      const length = Math.min(CHUNK_SIZE, totalSize - start)
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, start)

      const q = new URLSearchParams({
        job_slug: jobSlug,
        upload_id: uploadId,
        chunk_index: String(chunkIndex),
      })
      const chunkRes = await httpRequest(
        `${yoloRoot}/dataset/upload/chunk?${q}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: buffer,
          timeoutMs: UPLOAD_TIMEOUT_MS,
        },
      )
      if (!chunkRes.ok) {
        updateJob(jobId, {
          status: "failed",
          progress: 100,
          errorMessage: chunkRes.errorMessage || `分片 ${chunkIndex + 1}/${totalChunks} 上传失败`,
        })
        return
      }

      const ratio = (chunkIndex + 1) / totalChunks
      updateJob(jobId, {
        message: `上传分片 ${chunkIndex + 1}/${totalChunks}`,
        progress: Math.min(90, Math.max(0, Math.round(ratio * 90))),
        phase: "uploading",
      })
    }
  } finally {
    fs.closeSync(fd)
  }

  updateJob(jobId, { message: "正在解压数据集…", progress: 92, phase: "unpacking" })

  const completeQ = new URLSearchParams({ job_slug: jobSlug, upload_id: uploadId })
  const completeRes = await httpRequest(`${yoloRoot}/dataset/upload/complete?${completeQ}`, {
    method: "POST",
    timeoutMs: COMPLETE_TIMEOUT_MS,
  })
  if (!completeRes.ok) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      errorMessage: completeRes.errorMessage || "完成上传失败",
    })
    return
  }

  try {
    const data = JSON.parse(completeRes.body.toString("utf8")) as {
      data_yaml?: string
      dataset_zip_filename?: string | null
    }
    if (!data.data_yaml) {
      updateJob(jobId, { status: "failed", progress: 100, errorMessage: "完成响应缺少 data_yaml" })
      return
    }
    updateJob(jobId, {
      status: "success",
      progress: 100,
      phase: "idle",
      message: "上传完成",
      dataYaml: data.data_yaml,
      datasetZipFilename: data.dataset_zip_filename || filename,
      errorMessage: "",
    })
  } catch {
    updateJob(jobId, { status: "failed", progress: 100, errorMessage: "完成响应无效" })
  }
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
  jobs.set(jobId, {
    id: jobId,
    status: "running",
    progress: 0,
    phase: "uploading",
    message: "排队中…",
    dataYaml: "",
    datasetZipFilename: "",
    errorMessage: "",
  })

  void runUploadJob(jobId, apiRoot, jobSlug, sourceZipPath).catch((error) => {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  })

  return { jobId, errorMessage: "" }
}

export function getYoloDatasetZipUploadJob(jobId: string): YoloDatasetUploadJobRecord | null {
  return jobs.get(jobId.trim()) ?? null
}

export function encodeYoloJobSlugForUrl(jobSlug: string): string {
  return encodeJobSlug(jobSlug)
}

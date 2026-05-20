import { apiV1Root, readFetchError } from "@/lib/backend-http"
import { loadAppConfig } from "@/lib/app-config-storage"

/** 大 ZIP 上传 + 服务端解压（含远程）默认 2 小时 */
export const YOLO_DATASET_UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** 本地选文件后仅解压 */
export const YOLO_DATASET_UNPACK_TIMEOUT_MS = 30 * 60 * 1000

export type YoloDatasetUploadPhase = "uploading" | "unpacking"

export type YoloDatasetUploadProgress = {
  phase: YoloDatasetUploadPhase
  percent: number
}

function yoloDatasetUploadUrl(jobSlug: string): string {
  const q = new URLSearchParams({ job_slug: jobSlug })
  return `${apiV1Root()}/training/yolo/dataset/upload?${q}`
}

function parseXhrError(xhr: XMLHttpRequest, fallback: string): string {
  const text = xhr.responseText?.trim()
  if (!text) return fallback
  try {
    const data = JSON.parse(text) as { detail?: unknown }
    if (typeof data.detail === "string") return data.detail
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg: string }).msg) : String(d)))
        .join("; ")
    }
  } catch {
    /* not json */
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

export function formatYoloBackendEndpointLabel(): { mode: "local" | "remote"; label: string } {
  const { protocol, host, port, remoteConnected, basePath } = loadAppConfig().backend
  if (!remoteConnected) {
    return { mode: "local", label: "127.0.0.1:8000" }
  }
  const scheme = protocol === "https" ? "https" : "http"
  const h = host.trim() || "127.0.0.1"
  const p = (port.trim() || "8000").replace(/^:/, "")
  const base = basePath.trim()
    ? basePath.trim().startsWith("/")
      ? basePath.trim()
      : `/${basePath.trim()}`
    : ""
  return { mode: "remote", label: `${scheme}://${h}:${p}${base}` }
}

export function uploadYoloDatasetZipWithProgress(
  jobSlug: string,
  file: File,
  options?: {
    onProgress?: (progress: YoloDatasetUploadProgress) => void
    timeoutMs?: number
  },
): Promise<{ data_yaml: string; dataset_zip_filename?: string | null }> {
  const timeoutMs = options?.timeoutMs ?? YOLO_DATASET_UPLOAD_TIMEOUT_MS
  const onProgress = options?.onProgress

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append("file", file)

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const clearTimer = () => {
      if (timeoutId != null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const fail = (message: string) => {
      clearTimer()
      reject(new Error(message))
    }

    timeoutId = setTimeout(() => {
      xhr.abort()
    }, timeoutMs)

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable || e.total <= 0) return
      const ratio = e.loaded / e.total
      const percent = Math.min(90, Math.max(0, Math.round(ratio * 90)))
      onProgress?.({ phase: "uploading", percent })
    })

    xhr.upload.addEventListener("load", () => {
      onProgress?.({ phase: "unpacking", percent: 92 })
    })

    xhr.addEventListener("load", () => {
      clearTimer()
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ phase: "unpacking", percent: 100 })
        try {
          const data = JSON.parse(xhr.responseText) as {
            data_yaml?: string
            dataset_zip_filename?: string | null
          }
          if (!data.data_yaml) {
            fail("上传成功但响应缺少 data_yaml")
            return
          }
          resolve({
            data_yaml: data.data_yaml,
            dataset_zip_filename: data.dataset_zip_filename,
          })
        } catch {
          fail("无法解析上传响应")
        }
        return
      }
      fail(parseXhrError(xhr, `上传失败（HTTP ${xhr.status}）`))
    })

    xhr.addEventListener("error", () => {
      fail("网络错误，无法连接后端")
    })

    xhr.addEventListener("abort", () => {
      fail(`上传超时（超过 ${Math.round(timeoutMs / 60_000)} 分钟）`)
    })

    xhr.open("POST", yoloDatasetUploadUrl(jobSlug))
    xhr.send(form)
  })
}

export async function unpackYoloDatasetWithTimeout(
  jobSlug: string,
  originalFilename?: string,
  timeoutMs: number = YOLO_DATASET_UNPACK_TIMEOUT_MS,
): Promise<{ data_yaml: string; dataset_zip_filename?: string | null }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  if (originalFilename?.trim()) {
    q.set("original_filename", originalFilename.trim())
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiV1Root()}/training/yolo/dataset/unpack?${q}`, {
      method: "POST",
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(await readFetchError(res))
    return res.json()
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`解压超时（超过 ${Math.round(timeoutMs / 60_000)} 分钟）`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

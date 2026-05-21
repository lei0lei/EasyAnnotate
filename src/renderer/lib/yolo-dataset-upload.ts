import { loadAppConfig } from "@/lib/app-config-storage"
import {
  uploadYoloDatasetZipWithProgress,
  YOLO_DATASET_UPLOAD_TIMEOUT_MS,
  type YoloDatasetUploadPhase,
  type YoloDatasetUploadProgress,
} from "@/lib/yolo-chunk-transfer"
import { apiV1Root, fetchWithTimeout, readFetchError } from "@/lib/backend-http"

export {
  uploadYoloDatasetZipWithProgress,
  YOLO_DATASET_UPLOAD_TIMEOUT_MS,
  type YoloDatasetUploadPhase,
  type YoloDatasetUploadProgress,
}

/** 本地选文件后仅解压 */
export const YOLO_DATASET_UNPACK_TIMEOUT_MS = 30 * 60 * 1000

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

export async function unpackYoloDatasetWithTimeout(
  jobSlug: string,
  originalFilename?: string,
  timeoutMs: number = YOLO_DATASET_UNPACK_TIMEOUT_MS,
): Promise<{ data_yaml: string; dataset_zip_filename?: string | null }> {
  const q = new URLSearchParams({ job_slug: jobSlug })
  if (originalFilename?.trim()) {
    q.set("original_filename", originalFilename.trim())
  }
  const res = await fetchWithTimeout(
    `${apiV1Root()}/training/yolo/dataset/unpack?${q}`,
    { method: "POST" },
    timeoutMs,
  )
  if (!res.ok) throw new Error(await readFetchError(res))
  return res.json()
}

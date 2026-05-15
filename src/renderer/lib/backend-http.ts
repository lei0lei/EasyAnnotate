import { loadAppConfig } from "@/lib/app-config-storage"

/**
 * 与 `backend/app/main.py` 中 uvicorn 暴露的 FastAPI 服务通信。
 * 业务路由挂在 `prefix=/api/v1`（见 `backend/app/routes/__init__.py`）。
 *
 * 前端调用集中处：`model-runtime-api.ts`（model-runtime + predict）、
 * `sam2-encode-api.ts`（encode-image、decoder-onnx）。
 */
export function backendHttpOrigin(): string {
  const { host, port } = loadAppConfig().backend
  const h = host.trim() || "127.0.0.1"
  const p = (port.trim() || "8000").replace(/^:/, "")
  return `http://${h}:${p}`
}

export function apiV1Root(): string {
  return `${backendHttpOrigin()}/api/v1`
}

/** 将含 `/` 的 id 按段编码，供 FastAPI `{param:path}` 路由使用（与 `sam2-encode-api` 一致）。 */
export function encodeUrlPathSegments(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/")
}

export async function readFetchError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return text || res.statusText || "unknown"
}

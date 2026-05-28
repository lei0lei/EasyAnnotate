import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"

/**
 * 与 `backend/app/main.py` 中 uvicorn 暴露的 FastAPI 服务通信。
 * 业务路由挂在 `prefix=/api/v1`（见 `backend/app/routes/__init__.py`）。
 *
 * 前端调用集中处：`model-runtime-api.ts`（model-runtime + predict）、
 * `sam2-encode-api.ts`（encode-image、decoder-onnx）。
 */
export function backendHttpOrigin(): string {
  const { protocol, host, port, remoteConnected } = loadAppConfig().backend
  // 远程未连接时强制走本地后端；已连接时走设置中的远程地址。
  if (!remoteConnected) {
    return "http://127.0.0.1:8000"
  }
  const scheme = protocol === "https" ? "https" : "http"
  const h = host.trim() || "127.0.0.1"
  const p = (port.trim() || "8000").replace(/^:/, "")
  return `${scheme}://${h}:${p}`
}

function normalizeBasePath(input: string): string {
  const t = input.trim()
  if (!t) return ""
  const withLeading = t.startsWith("/") ? t : `/${t}`
  return withLeading.replace(/\/+$/, "")
}

function normalizePort(protocol: string, port: string): string {
  const p = port.trim()
  if (p) return p
  return protocol === "https:" ? "443" : "80"
}

function isConfiguredBackendUrl(rawUrl: string): boolean {
  try {
    const target = new URL(rawUrl, window.location.href)
    if (target.protocol !== "http:" && target.protocol !== "https:") return false
    const configured = new URL(backendHttpOrigin())
    if (configured.protocol !== target.protocol) return false
    if (configured.hostname !== target.hostname) return false
    return normalizePort(configured.protocol, configured.port) === normalizePort(target.protocol, target.port)
  } catch {
    return false
  }
}

let backendFetchProxyInstalled = false
let nativeFetchRef: typeof fetch | null = null

async function proxyFetchViaMainProcess(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = request.url
  if (!isConfiguredBackendUrl(url)) {
    return (nativeFetchRef ?? fetch)(input, init)
  }
  if (init?.signal?.aborted) {
    throw new Error("请求已取消")
  }
  const method = request.method || "GET"
  const headers = Object.fromEntries(request.headers.entries())
  const bodyBytes =
    method === "GET" || method === "HEAD" ? new Uint8Array() : new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)))
  const proxied = await ipc.app.ProxyBackendHttp({
    url,
    method,
    headers,
    body: bodyBytes,
    timeoutMs: 180_000,
  })
  if (!proxied.ok) {
    throw new Error(proxied.errorMessage || `请求失败：${url}`)
  }
  return new Response(proxied.body, {
    status: proxied.status || 500,
    statusText: proxied.statusText || "",
    headers: proxied.headers,
  })
}

function ensureBackendFetchProxyInstalled(): void {
  if (backendFetchProxyInstalled) return
  nativeFetchRef = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return await proxyFetchViaMainProcess(input, init)
  }) as typeof fetch
  backendFetchProxyInstalled = true
}

ensureBackendFetchProxyInstalled()

export function apiV1Root(): string {
  const { basePath } = loadAppConfig().backend
  return `${backendHttpOrigin()}${normalizeBasePath(basePath)}/api/v1`
}

/** 将含 `/` 的 id 按段编码，供 FastAPI `{param:path}` 路由使用（与 `sam2-encode-api` 一致）。 */
export function encodeUrlPathSegments(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/")
}

/** 解析 FastAPI 错误体（如 `{"detail":"Not Found"}` 或 `{"detail":"未找到模型：x"}`）。 */
export function formatFetchError(res: Response, rawBody: string): string {
  const trimmed = rawBody.trim()
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as { detail?: unknown; message?: unknown }
      const detail = parsed.detail
      if (typeof detail === "string" && detail.trim()) {
        if (res.status === 404 && detail === "Not Found") {
          return `HTTP 404：接口不存在（${res.url || "请求 URL 无效"}）。若使用远程后端，请用最新代码重启该后端。`
        }
        return detail.trim()
      }
      if (Array.isArray(detail)) {
        const parts = detail
          .map((item) => {
            if (typeof item === "string") return item
            if (item && typeof item === "object" && "msg" in item) {
              return String((item as { msg?: unknown }).msg ?? "")
            }
            return ""
          })
          .filter(Boolean)
        if (parts.length > 0) return parts.join("；")
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim()
      }
    } catch {
      /* 非 JSON，使用原文 */
    }
    return trimmed
  }
  if (res.status === 404) {
    return `HTTP 404：接口不存在（${res.url || ""}）。请确认当前连接的后端已包含 YOLO 批量标注 API 并已重启。`
  }
  return res.statusText || `HTTP ${res.status}`
}

export async function readFetchError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return formatFetchError(res, text)
}

/** 避免远程慢连/无响应时前端一直停在「正在加载」。 */
export async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 60_000,
): Promise<Response> {
  const safeTimeout = Math.max(500, timeoutMs)
  const timeoutPromise = new Promise<Response>((_, reject) => {
    window.setTimeout(() => reject(new Error(`请求超时（${Math.round(safeTimeout / 1000)} 秒）`)), safeTimeout)
  })
  return await Promise.race([fetch(input, init), timeoutPromise])
}

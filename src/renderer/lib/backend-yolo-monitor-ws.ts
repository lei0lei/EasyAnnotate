import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import { backendHttpOrigin } from "@/lib/backend-http"
import { getYoloMonitorClientId } from "@/lib/yolo-monitor-client-id"

export function backendYoloMonitorWsUrl(): string {
  const { basePath } = loadAppConfig().backend
  const origin = backendHttpOrigin()
  const wsOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  const base = basePath.trim().replace(/\/+$/, "")
  const prefix = base ? (base.startsWith("/") ? base : `/${base}`) : ""
  return `${wsOrigin}${prefix}/api/v1/ws`
}

export async function isYoloMonitorWsConnected(): Promise<boolean> {
  const res = await ipc.app.IsBackendYoloMonitorWsConnected({})
  return Boolean(res.connected)
}

export async function connectYoloMonitorWs(): Promise<void> {
  const res = await ipc.app.ConnectBackendYoloMonitorWs({
    url: backendYoloMonitorWsUrl(),
    clientId: getYoloMonitorClientId(),
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "无法连接 YOLO 监控 WebSocket")
  }
}

export async function disconnectYoloMonitorWs(): Promise<void> {
  await ipc.app.DisconnectBackendYoloMonitorWs({})
}

export async function yoloMonitorRpc(
  type: string,
  payload: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const res = await ipc.app.YoloMonitorWsSendJson({
    jsonText: JSON.stringify({ type, payload }),
    timeoutMs,
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "YOLO WebSocket 请求失败")
  }
  try {
    return JSON.parse(res.responseJson || "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function fetchYoloMonitorResultImageBytes(
  jobSlug: string,
  imagePath: string,
  timeoutMs = 60_000,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await ipc.app.YoloMonitorWsFetchResultImage({
    jobSlug,
    path: imagePath,
    timeoutMs,
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "拉取结果图失败")
  }
  return {
    bytes: res.body ?? new Uint8Array(),
    contentType: res.contentType?.trim() || "application/octet-stream",
  }
}

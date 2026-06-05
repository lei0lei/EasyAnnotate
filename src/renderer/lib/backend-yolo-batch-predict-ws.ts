import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import { backendHttpOrigin } from "@/lib/backend-http"
import { getYoloBatchPredictClientId } from "@/lib/yolo-batch-predict-client-id"

export function backendYoloBatchPredictWsUrl(): string {
  const { basePath } = loadAppConfig().backend
  const origin = backendHttpOrigin()
  const wsOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  const base = basePath.trim().replace(/\/+$/, "")
  const prefix = base ? (base.startsWith("/") ? base : `/${base}`) : ""
  return `${wsOrigin}${prefix}/api/v1/ws`
}

export async function isYoloBatchPredictWsConnected(): Promise<boolean> {
  const res = await ipc.app.IsBackendYoloBatchPredictWsConnected({})
  return Boolean(res.connected)
}

export async function connectYoloBatchPredictWs(): Promise<void> {
  const res = await ipc.app.ConnectBackendYoloBatchPredictWs({
    url: backendYoloBatchPredictWsUrl(),
    clientId: getYoloBatchPredictClientId(),
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "无法连接 YOLO 推理 WebSocket")
  }
}

export async function disconnectYoloBatchPredictWs(): Promise<void> {
  await ipc.app.DisconnectBackendYoloBatchPredictWs({})
}

export async function yoloBatchPredictImageViaWs(
  modelSlug: string,
  imagePath: string,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const res = await ipc.app.YoloBatchPredictImage({
    modelSlug,
    imagePath,
    timeoutMs,
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "YOLO 推理失败")
  }
  try {
    return JSON.parse(res.responseJson || "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

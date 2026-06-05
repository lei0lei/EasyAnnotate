import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import { backendHttpOrigin } from "@/lib/backend-http"
import { getSamClientId } from "@/lib/sam-client-id"

export function backendSamWsUrl(): string {
  const { basePath } = loadAppConfig().backend
  const origin = backendHttpOrigin()
  const wsOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  const base = basePath.trim().replace(/\/+$/, "")
  const prefix = base ? (base.startsWith("/") ? base : `/${base}`) : ""
  return `${wsOrigin}${prefix}/api/v1/ws`
}

export async function isSamBackendWsConnected(): Promise<boolean> {
  const res = await ipc.app.IsBackendSamWsConnected({})
  return Boolean(res.connected)
}

export async function connectSamBackendWs(): Promise<void> {
  const res = await ipc.app.ConnectBackendSamWs({
    url: backendSamWsUrl(),
    clientId: getSamClientId(),
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "无法连接 SAM WebSocket")
  }
}

export async function disconnectSamBackendWs(): Promise<void> {
  await ipc.app.DisconnectBackendSamWs({})
}

export async function samBackendWsRpc(
  type: string,
  payload: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const res = await ipc.app.SamWsSendJson({
    jsonText: JSON.stringify({ type, payload }),
    timeoutMs,
  })
  if (!res.ok) {
    const msg = res.errorMessage?.trim() || "SAM WebSocket 请求失败"
    throw new Error(msg)
  }
  try {
    return JSON.parse(res.responseJson || "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function samBackendWsPrepareImage(args: {
  modelId: string
  imagePath: string
  inferScale?: number
  runtimeSlot?: string
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const res = await ipc.app.SamWsPrepareImage({
    modelId: args.modelId,
    imagePath: args.imagePath,
    inferScale: args.inferScale ?? 0,
    runtimeSlot: args.runtimeSlot ?? "",
    timeoutMs: args.timeoutMs ?? 180_000,
  })
  if (!res.ok) {
    throw new Error(res.errorMessage?.trim() || "SAM prepare 失败")
  }
  return JSON.parse(res.responseJson || "{}") as Record<string, unknown>
}

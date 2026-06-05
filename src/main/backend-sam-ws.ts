/**
 * Main-process WebSocket client for SAM session API (single connection per task page).
 */
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"

type PendingRequest = {
  resolve: (msg: WsMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type WsMessage = {
  id?: string
  type: string
  payload?: Record<string, unknown>
}

let ws: WebSocket | null = null
let clientId = ""
const pendingById = new Map<string, PendingRequest>()

function rejectAllPending(err: Error): void {
  for (const p of pendingById.values()) {
    clearTimeout(p.timer)
    p.reject(err)
  }
  pendingById.clear()
}

function waitForMessage(id: string, timeoutMs: number): Promise<WsMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingById.delete(id)
      reject(new Error(`WebSocket 请求超时（>${timeoutMs}ms）`))
    }, timeoutMs)
    pendingById.set(id, { resolve, reject, timer })
  })
}

function handleIncoming(raw: string): void {
  let msg: WsMessage
  try {
    msg = JSON.parse(raw) as WsMessage
  } catch {
    return
  }
  const id = msg.id?.trim()
  if (id && pendingById.has(id)) {
    const p = pendingById.get(id)!
    pendingById.delete(id)
    clearTimeout(p.timer)
    if (msg.type === "error") {
      const payload = msg.payload ?? {}
      const code = String(payload.code ?? "error")
      const message = String(payload.message ?? "WebSocket error")
      p.reject(new Error(`${code}: ${message}`))
      return
    }
    p.resolve(msg)
  }
}

export function isBackendSamWsConnected(): boolean {
  return ws != null && ws.readyState === WebSocket.OPEN
}

export async function connectBackendSamWs(wsUrl: string, cid: string, timeoutMs = 30_000): Promise<void> {
  const url = wsUrl.trim()
  const nextClientId = cid.trim()
  if (!url || !nextClientId) {
    throw new Error("WebSocket url 与 client_id 不能为空")
  }
  if (isBackendSamWsConnected() && clientId === nextClientId) {
    return
  }
  await disconnectBackendSamWs()

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url)
    const connectTimer = setTimeout(() => {
      socket.terminate()
      reject(new Error("WebSocket 连接超时"))
    }, timeoutMs)

    socket.on("open", () => {
      clearTimeout(connectTimer)
      ws = socket
      clientId = nextClientId
      resolve()
    })
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8")
      handleIncoming(text)
    })
    socket.on("close", () => {
      if (ws === socket) {
        ws = null
        clientId = ""
      }
      rejectAllPending(new Error("WebSocket 已断开"))
    })
    socket.on("error", (err) => {
      clearTimeout(connectTimer)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })

  const helloId = randomUUID()
  ws!.send(
    JSON.stringify({
      id: helloId,
      type: "hello",
      payload: { client_id: clientId },
    }),
  )
  const helloRes = await waitForMessage(helloId, timeoutMs)
  if (helloRes.type !== "hello.ok") {
    throw new Error(`WebSocket hello 失败：${helloRes.type}`)
  }
}

export async function disconnectBackendSamWs(): Promise<void> {
  if (!ws) return
  const socket = ws
  ws = null
  clientId = ""
  rejectAllPending(new Error("WebSocket 已关闭"))
  await new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    socket.once("close", () => resolve())
    socket.close()
  })
}

async function sendJsonAndWait(msg: WsMessage, timeoutMs: number): Promise<WsMessage> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket 未连接")
  }
  const id = msg.id?.trim() || randomUUID()
  const body = { ...msg, id }
  ws.send(JSON.stringify(body))
  const res = await waitForMessage(id, timeoutMs)
  if (res.type === "error") {
    const payload = res.payload ?? {}
    throw new Error(`${String(payload.code ?? "error")}: ${String(payload.message ?? "unknown")}`)
  }
  return res
}

export async function samWsPrepareImage(args: {
  modelId: string
  imagePath: string
  inferScale?: number
  runtimeSlot?: string
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const timeoutMs = args.timeoutMs ?? 180_000
  const imagePath = args.imagePath.trim()
  if (!fs.existsSync(imagePath)) {
    throw new Error(`图片不存在：${imagePath}`)
  }
  const bytes = fs.readFileSync(imagePath)
  const suffix = path.extname(imagePath) || ".jpg"
  const beginId = randomUUID()
  const inferScale =
    args.inferScale !== undefined && Number.isFinite(args.inferScale)
      ? Math.min(1, Math.max(0.3, args.inferScale))
      : undefined

  const beginPayload: Record<string, unknown> = {
    model_id: args.modelId.trim(),
    byte_length: bytes.byteLength,
    suffix,
  }
  if (inferScale !== undefined) beginPayload.infer_scale = inferScale
  if (args.runtimeSlot?.trim()) beginPayload.runtime_slot = args.runtimeSlot.trim()

  const readyRes = await sendJsonAndWait(
    { id: beginId, type: "sam.prepare.begin", payload: beginPayload },
    timeoutMs,
  )
  if (readyRes.type !== "sam.prepare.ready") {
    throw new Error(`prepare 未就绪：${readyRes.type}`)
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket 未连接")
  }
  ws.send(bytes, { binary: true })

  const okRes = await waitForMessage(beginId, timeoutMs)
  if (okRes.type !== "sam.prepare.ok") {
    throw new Error(`prepare 失败：${okRes.type}`)
  }
  return (okRes.payload ?? {}) as Record<string, unknown>
}

export async function samWsSendJson(args: {
  type: string
  payload: Record<string, unknown>
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const timeoutMs = args.timeoutMs ?? 120_000
  const id = randomUUID()
  const res = await sendJsonAndWait({ id, type: args.type, payload: args.payload }, timeoutMs)
  return (res.payload ?? {}) as Record<string, unknown>
}

export async function samWsRelease(timeoutMs = 15_000): Promise<void> {
  if (!isBackendSamWsConnected()) return
  try {
    await samWsSendJson({ type: "sam.release", payload: {}, timeoutMs })
  } catch {
    // best-effort
  }
}

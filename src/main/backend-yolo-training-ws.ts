/**
 * Main-process WebSocket client for YOLO training uploads (dataset zip chunks, base .pt).
 * Opens on upload start, closes when upload completes.
 */
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"

const CHUNK_SIZE = 5 * 1024 * 1024

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

export function apiRootToWsUrl(apiRoot: string): string {
  const wsOrigin = apiRoot.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  const base = wsOrigin.replace(/\/+$/, "")
  return base.endsWith("/ws") ? base : `${base}/ws`
}

export function isYoloTrainingWsConnected(): boolean {
  return ws != null && ws.readyState === WebSocket.OPEN
}

export async function connectYoloTrainingWs(wsUrl: string, cid: string, timeoutMs = 30_000): Promise<void> {
  const url = wsUrl.trim()
  const nextClientId = cid.trim()
  if (!url || !nextClientId) {
    throw new Error("WebSocket url 与 client_id 不能为空")
  }
  if (isYoloTrainingWsConnected() && clientId === nextClientId) {
    return
  }
  await disconnectYoloTrainingWs()

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

export async function disconnectYoloTrainingWs(): Promise<void> {
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

export type YoloDatasetZipUploadResult = {
  data_yaml: string
  dataset_zip_filename?: string | null
}

export async function uploadYoloDatasetZipViaWs(args: {
  wsUrl: string
  clientId: string
  jobSlug: string
  sourceZipPath: string
  onChunkProgress?: (done: number, total: number) => void
  onBeforeComplete?: () => void
  timeoutMs?: number
}): Promise<YoloDatasetZipUploadResult> {
  const timeoutMs = args.timeoutMs ?? 15 * 60 * 1000
  const sourceZipPath = args.sourceZipPath.trim()
  if (!fs.existsSync(sourceZipPath)) {
    throw new Error(`zip 不存在：${sourceZipPath}`)
  }

  await connectYoloTrainingWs(args.wsUrl, args.clientId, timeoutMs)
  try {
    const stat = fs.statSync(sourceZipPath)
    const totalSize = stat.size
    const filename = path.basename(sourceZipPath)
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)

    const initId = randomUUID()
    const initRes = await sendJsonAndWait(
      {
        id: initId,
        type: "training.yolo.dataset.upload.init",
        payload: {
          job_slug: args.jobSlug,
          filename,
          total_size: totalSize,
        },
      },
      timeoutMs,
    )
    if (initRes.type !== "training.yolo.dataset.upload.init.ok") {
      throw new Error(`init 失败：${initRes.type}`)
    }
    const initPayload = initRes.payload ?? {}
    const uploadId = String(initPayload.upload_id ?? "")
    if (!uploadId) throw new Error("init 响应缺少 upload_id")

    const missingRaw = initPayload.missing_chunks
    const missing: number[] = Array.isArray(missingRaw)
      ? missingRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0)
      : Array.from({ length: totalChunks }, (_, i) => i)

    const fd = await fs.promises.open(sourceZipPath, "r")
    try {
      for (let i = 0; i < missing.length; i++) {
        const chunkIndex = missing[i]!
        const start = chunkIndex * CHUNK_SIZE
        const length = Math.min(CHUNK_SIZE, totalSize - start)
        const buffer = Buffer.alloc(length)
        await fd.read(buffer, 0, length, start)

        const beginId = randomUUID()
        const readyRes = await sendJsonAndWait(
          {
            id: beginId,
            type: "training.yolo.dataset.upload.chunk.begin",
            payload: {
              job_slug: args.jobSlug,
              upload_id: uploadId,
              chunk_index: chunkIndex,
              byte_length: length,
            },
          },
          timeoutMs,
        )
        if (readyRes.type !== "training.yolo.dataset.upload.chunk.ready") {
          throw new Error(`chunk ${chunkIndex} 未就绪：${readyRes.type}`)
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error("WebSocket 未连接")
        }
        ws.send(buffer, { binary: true })
        const okRes = await waitForMessage(beginId, timeoutMs)
        if (okRes.type !== "training.yolo.dataset.upload.chunk.ok") {
          throw new Error(`chunk ${chunkIndex} 失败：${okRes.type}`)
        }
        args.onChunkProgress?.(i + 1, missing.length)
      }
    } finally {
      await fd.close()
    }

    const completeId = randomUUID()
    args.onBeforeComplete?.()
    const completeRes = await sendJsonAndWait(
      {
        id: completeId,
        type: "training.yolo.dataset.upload.complete",
        payload: { job_slug: args.jobSlug, upload_id: uploadId },
      },
      30 * 60 * 1000,
    )
    if (completeRes.type !== "training.yolo.dataset.upload.complete.ok") {
      throw new Error(`complete 失败：${completeRes.type}`)
    }
    const completePayload = completeRes.payload ?? {}
    const dataYaml = String(completePayload.data_yaml ?? "")
    if (!dataYaml) throw new Error("complete 响应缺少 data_yaml")
    return {
      data_yaml: dataYaml,
      dataset_zip_filename: (completePayload.dataset_zip_filename as string | null | undefined) ?? null,
    }
  } finally {
    await disconnectYoloTrainingWs()
  }
}

export type YoloBaseModelUploadResult = {
  weight_meta: Record<string, unknown> | null
  weight_warnings: string[]
}

export async function uploadYoloBaseModelViaWs(args: {
  wsUrl: string
  clientId: string
  jobSlug: string
  sourcePtPath: string
  family: string
  task: string
  timeoutMs?: number
}): Promise<YoloBaseModelUploadResult> {
  const timeoutMs = args.timeoutMs ?? 10 * 60 * 1000
  const sourcePtPath = args.sourcePtPath.trim()
  if (!fs.existsSync(sourcePtPath)) {
    throw new Error(`权重文件不存在：${sourcePtPath}`)
  }
  const bytes = fs.readFileSync(sourcePtPath)
  const filename = path.basename(sourcePtPath)

  await connectYoloTrainingWs(args.wsUrl, args.clientId, timeoutMs)
  try {
    const beginId = randomUUID()
    const readyRes = await sendJsonAndWait(
      {
        id: beginId,
        type: "training.yolo.base_model.upload.begin",
        payload: {
          job_slug: args.jobSlug,
          family: args.family,
          task: args.task,
          filename,
          byte_length: bytes.byteLength,
        },
      },
      timeoutMs,
    )
    if (readyRes.type !== "training.yolo.base_model.upload.ready") {
      throw new Error(`upload 未就绪：${readyRes.type}`)
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket 未连接")
    }
    ws.send(bytes, { binary: true })
    const okRes = await waitForMessage(beginId, timeoutMs)
    if (okRes.type !== "training.yolo.base_model.upload.ok") {
      throw new Error(`upload 失败：${okRes.type}`)
    }
    const payload = okRes.payload ?? {}
    const warnings = payload.weight_warnings
    return {
      weight_meta: (payload.weight_meta as Record<string, unknown> | null) ?? null,
      weight_warnings: Array.isArray(warnings) ? warnings.map(String) : [],
    }
  } finally {
    await disconnectYoloTrainingWs()
  }
}

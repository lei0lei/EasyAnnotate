/**
 * Reusable WebSocket JSON + binary client for backend /api/v1/ws.
 */
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

export class BackendWsClient {
  private ws: WebSocket | null = null
  private clientId = ""
  private readonly pendingById = new Map<string, PendingRequest>()
  private readonly binaryQueue: Buffer[] = []
  private readonly jsonQueue = new Map<string, WsMessage[]>()
  private pendingBinary: {
    resolve: (data: Buffer) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  isConnected(): boolean {
    return this.ws != null && this.ws.readyState === WebSocket.OPEN
  }

  getClientId(): string {
    return this.clientId
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pendingById.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pendingById.clear()
    this.binaryQueue.length = 0
    this.jsonQueue.clear()
    if (this.pendingBinary) {
      clearTimeout(this.pendingBinary.timer)
      this.pendingBinary.reject(err)
      this.pendingBinary = null
    }
  }

  private waitForMessage(id: string, timeoutMs: number): Promise<WsMessage> {
    const queued = this.jsonQueue.get(id)
    if (queued && queued.length > 0) {
      return Promise.resolve(queued.shift()!)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingById.delete(id)
        reject(new Error(`WebSocket 请求超时（>${timeoutMs}ms）`))
      }, timeoutMs)
      this.pendingById.set(id, { resolve, reject, timer })
    })
  }

  waitForReply(id: string, timeoutMs: number): Promise<WsMessage> {
    const queued = this.jsonQueue.get(id)
    if (queued && queued.length > 0) {
      return Promise.resolve(queued.shift()!)
    }
    return this.waitForMessage(id, timeoutMs)
  }

  waitForBinary(timeoutMs: number): Promise<Buffer> {
    if (this.binaryQueue.length > 0) {
      return Promise.resolve(this.binaryQueue.shift()!)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBinary = null
        reject(new Error(`WebSocket 二进制接收超时（>${timeoutMs}ms）`))
      }, timeoutMs)
      this.pendingBinary = { resolve, reject, timer }
    })
  }

  private handleIncomingJson(raw: string): void {
    let msg: WsMessage
    try {
      msg = JSON.parse(raw) as WsMessage
    } catch {
      return
    }
    const id = msg.id?.trim()
    if (id && this.pendingById.has(id)) {
      const p = this.pendingById.get(id)!
      this.pendingById.delete(id)
      clearTimeout(p.timer)
      if (msg.type === "error") {
        const payload = msg.payload ?? {}
        const code = String(payload.code ?? "error")
        const message = String(payload.message ?? "WebSocket error")
        p.reject(new Error(`${code}: ${message}`))
        return
      }
      p.resolve(msg)
      return
    }
    if (id) {
      const list = this.jsonQueue.get(id) ?? []
      list.push(msg)
      this.jsonQueue.set(id, list)
    }
  }

  async connect(wsUrl: string, cid: string, timeoutMs = 30_000): Promise<void> {
    const url = wsUrl.trim()
    const nextClientId = cid.trim()
    if (!url || !nextClientId) {
      throw new Error("WebSocket url 与 client_id 不能为空")
    }
    if (this.isConnected() && this.clientId === nextClientId) {
      return
    }
    await this.disconnect()

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      const connectTimer = setTimeout(() => {
        socket.terminate()
        reject(new Error("WebSocket 连接超时"))
      }, timeoutMs)

      socket.on("open", () => {
        clearTimeout(connectTimer)
        this.ws = socket
        this.clientId = nextClientId
        resolve()
      })
      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
          if (this.pendingBinary) {
            const p = this.pendingBinary
            this.pendingBinary = null
            clearTimeout(p.timer)
            p.resolve(buf)
          } else {
            this.binaryQueue.push(buf)
          }
          return
        }
        const text =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Buffer.from(data as ArrayBuffer).toString("utf8")
        this.handleIncomingJson(text)
      })
      socket.on("close", () => {
        if (this.ws === socket) {
          this.ws = null
          this.clientId = ""
        }
        this.rejectAllPending(new Error("WebSocket 已断开"))
      })
      socket.on("error", (err) => {
        clearTimeout(connectTimer)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })

    const helloId = randomUUID()
    const helloWait = this.waitForMessage(helloId, timeoutMs)
    this.ws!.send(
      JSON.stringify({
        id: helloId,
        type: "hello",
        payload: { client_id: this.clientId },
      }),
    )
    const helloRes = await helloWait
    if (helloRes.type !== "hello.ok") {
      throw new Error(`WebSocket hello 失败：${helloRes.type}`)
    }
  }

  async disconnect(): Promise<void> {
    if (!this.ws) return
    const socket = this.ws
    this.ws = null
    this.clientId = ""
    this.rejectAllPending(new Error("WebSocket 已关闭"))
    await new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }
      socket.once("close", () => resolve())
      socket.close()
    })
  }

  async sendJsonAndWait(msg: WsMessage, timeoutMs: number): Promise<WsMessage> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket 未连接")
    }
    const id = msg.id?.trim() || randomUUID()
    const body = { ...msg, id }
    const wait = this.waitForMessage(id, timeoutMs)
    this.ws.send(JSON.stringify(body))
    const res = await wait
    if (res.type === "error") {
      const payload = res.payload ?? {}
      throw new Error(`${String(payload.code ?? "error")}: ${String(payload.message ?? "unknown")}`)
    }
    return res
  }

  sendBinary(data: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket 未连接")
    }
    this.ws.send(data, { binary: true })
  }

  async rpc(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const res = await this.sendJsonAndWait({ type, payload }, timeoutMs)
    return (res.payload ?? {}) as Record<string, unknown>
  }
}

export function apiRootToWsUrl(apiRoot: string): string {
  const wsOrigin = apiRoot.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  const base = wsOrigin.replace(/\/+$/, "")
  return base.endsWith("/ws") ? base : `${base}/ws`
}

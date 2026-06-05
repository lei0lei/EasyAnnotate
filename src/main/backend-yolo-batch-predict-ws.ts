/**
 * Persistent WebSocket client for YOLO batch predict (auto-annotate lifecycle).
 */
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BackendWsClient } from "./backend-ws-client"

const predictClient = new BackendWsClient()

export function isYoloBatchPredictWsConnected(): boolean {
  return predictClient.isConnected()
}

export async function connectYoloBatchPredictWs(wsUrl: string, cid: string, timeoutMs = 30_000): Promise<void> {
  await predictClient.connect(wsUrl, cid, timeoutMs)
}

export async function disconnectYoloBatchPredictWs(): Promise<void> {
  await predictClient.disconnect()
}

export async function yoloBatchPredictImageViaWs(args: {
  modelSlug: string
  imagePath: string
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const timeoutMs = args.timeoutMs ?? 120_000
  const imagePath = args.imagePath.trim()
  const modelSlug = args.modelSlug.trim()
  if (!modelSlug) throw new Error("model_slug 不能为空")
  if (!imagePath) throw new Error("图片路径不能为空")
  if (!fs.existsSync(imagePath)) {
    throw new Error(`图片不存在：${imagePath}`)
  }

  const bytes = fs.readFileSync(imagePath)
  const suffix = path.extname(imagePath) || ".jpg"
  const beginId = randomUUID()

  const readyRes = await predictClient.sendJsonAndWait(
    {
      id: beginId,
      type: "yolo.batch.predict.begin",
      payload: {
        model_slug: modelSlug,
        byte_length: bytes.byteLength,
        suffix,
      },
    },
    timeoutMs,
  )
  if (readyRes.type !== "yolo.batch.predict.ready") {
    throw new Error(`predict 未就绪：${readyRes.type}`)
  }

  predictClient.sendBinary(bytes)
  const okRes = await predictClient.waitForReply(beginId, timeoutMs)
  if (okRes.type !== "yolo.batch.predict.ok") {
    throw new Error(`predict 失败：${okRes.type}`)
  }
  return (okRes.payload ?? {}) as Record<string, unknown>
}

/**
 * Persistent WebSocket client for YOLO training monitor (status, logs, results, model download).
 * Separate from upload client in backend-yolo-training-ws.ts.
 */
import fs from "node:fs"
import { randomUUID } from "node:crypto"
import { BackendWsClient } from "./backend-ws-client"

const CHUNK_SIZE = 5 * 1024 * 1024
const monitorClient = new BackendWsClient()

export function isYoloTrainingMonitorWsConnected(): boolean {
  return monitorClient.isConnected()
}

export async function connectYoloTrainingMonitorWs(wsUrl: string, cid: string, timeoutMs = 30_000): Promise<void> {
  await monitorClient.connect(wsUrl, cid, timeoutMs)
}

export async function disconnectYoloTrainingMonitorWs(): Promise<void> {
  await monitorClient.disconnect()
}

export async function yoloMonitorWsSendJson(args: {
  type: string
  payload: Record<string, unknown>
  timeoutMs?: number
}): Promise<Record<string, unknown>> {
  const timeoutMs = args.timeoutMs ?? 120_000
  const res = await monitorClient.sendJsonAndWait(
    { type: args.type, payload: args.payload },
    timeoutMs,
  )
  return (res.payload ?? {}) as Record<string, unknown>
}

async function receiveBinaryThenOk(beginId: string, timeoutMs: number, expectedLen?: number): Promise<Buffer> {
  const binaryPromise = monitorClient.waitForBinary(timeoutMs)
  const okPromise = monitorClient.waitForReply(beginId, timeoutMs)
  const bytes = await binaryPromise
  if (expectedLen != null && expectedLen > 0 && bytes.byteLength !== expectedLen) {
    await okPromise.catch(() => undefined)
    throw new Error(`二进制大小不匹配：期望 ${expectedLen}，收到 ${bytes.byteLength}`)
  }
  const okRes = await okPromise
  if (!okRes.type.endsWith(".ok")) {
    throw new Error(`传输失败：${okRes.type}`)
  }
  return bytes
}

export async function yoloMonitorWsFetchResultImage(args: {
  jobSlug: string
  path: string
  timeoutMs?: number
}): Promise<{ bytes: Buffer; contentType: string }> {
  const timeoutMs = args.timeoutMs ?? 120_000
  const beginId = randomUUID()
  const readyRes = await monitorClient.sendJsonAndWait(
    {
      id: beginId,
      type: "training.yolo.results.image.begin",
      payload: { job_slug: args.jobSlug, path: args.path },
    },
    timeoutMs,
  )
  if (readyRes.type !== "training.yolo.results.image.ready") {
    throw new Error(`结果图未就绪：${readyRes.type}`)
  }
  const readyPayload = readyRes.payload ?? {}
  const expectedLen = Number(readyPayload.byte_length ?? 0)
  const contentType = String(readyPayload.content_type ?? "application/octet-stream")
  const bytes = await receiveBinaryThenOk(beginId, timeoutMs, expectedLen)
  return { bytes, contentType }
}

export type YoloModelDownloadInfo = {
  path: string
  filename: string
  total_size: number
  chunk_size: number
  total_chunks: number
}

export async function yoloMonitorWsModelDownloadInfo(args: {
  jobSlug: string
  path: string
  timeoutMs?: number
}): Promise<YoloModelDownloadInfo> {
  const timeoutMs = args.timeoutMs ?? 60_000
  const payload = await yoloMonitorWsSendJson({
    type: "training.yolo.model.download.info",
    payload: { job_slug: args.jobSlug, path: args.path },
    timeoutMs,
  })
  return {
    path: String(payload.path ?? args.path),
    filename: String(payload.filename ?? ""),
    total_size: Number(payload.total_size ?? 0),
    chunk_size: Number(payload.chunk_size ?? CHUNK_SIZE),
    total_chunks: Number(payload.total_chunks ?? 0),
  }
}

export async function yoloMonitorWsDownloadModelToFile(args: {
  jobSlug: string
  path: string
  targetPath: string
  onChunkProgress?: (done: number, total: number) => void
  timeoutMs?: number
}): Promise<void> {
  const timeoutMs = args.timeoutMs ?? 60 * 60 * 1000
  const info = await yoloMonitorWsModelDownloadInfo({
    jobSlug: args.jobSlug,
    path: args.path,
    timeoutMs,
  })
  const totalSize = info.total_size
  const chunkSize = info.chunk_size || CHUNK_SIZE
  const totalChunks = info.total_chunks || (totalSize > 0 ? Math.ceil(totalSize / chunkSize) : 0)

  const fd = await fs.promises.open(args.targetPath, "w")
  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize
      const byteLength = Math.min(chunkSize, totalSize - start)
      const beginId = randomUUID()
      const readyRes = await monitorClient.sendJsonAndWait(
        {
          id: beginId,
          type: "training.yolo.model.download.chunk.begin",
          payload: {
            job_slug: args.jobSlug,
            path: args.path,
            chunk_index: chunkIndex,
            byte_length: byteLength,
          },
        },
        timeoutMs,
      )
      if (readyRes.type !== "training.yolo.model.download.chunk.ready") {
        throw new Error(`模型分片 ${chunkIndex} 未就绪：${readyRes.type}`)
      }
      const bytes = await receiveBinaryThenOk(beginId, timeoutMs, byteLength)
      await fd.write(bytes, 0, bytes.byteLength, start)
      args.onChunkProgress?.(chunkIndex + 1, totalChunks)
    }
  } finally {
    await fd.close()
  }
}

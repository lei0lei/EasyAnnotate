/**
 * Short-lived WebSocket uploads for YOLO batch model files (data.yaml / weights.pt chunks).
 */
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BackendWsClient } from "./backend-ws-client"

const CHUNK_SIZE = 5 * 1024 * 1024
const batchUploadClient = new BackendWsClient()

export type YoloBatchUploadKind = "data_yaml" | "weights"

function wsKindPrefix(kind: YoloBatchUploadKind): string {
  return kind === "data_yaml" ? "data_yaml" : "weights"
}

function validateSourcePath(kind: YoloBatchUploadKind, sourcePath: string): void {
  const lower = sourcePath.toLowerCase()
  if (kind === "data_yaml") {
    if (!lower.endsWith(".yaml") && !lower.endsWith(".yml")) {
      throw new Error("仅支持 .yaml / .yml")
    }
    return
  }
  if (!lower.endsWith(".pt")) {
    throw new Error("仅支持 .pt 权重")
  }
}

export async function uploadYoloBatchFileViaWs(args: {
  kind: YoloBatchUploadKind
  wsUrl: string
  clientId: string
  modelSlug: string
  sourcePath: string
  onChunkProgress?: (done: number, total: number) => void
  timeoutMs?: number
}): Promise<{ data_yaml?: string; weights_pt?: string; class_count?: number }> {
  const timeoutMs = args.timeoutMs ?? 5 * 60 * 60 * 1000
  const sourcePath = args.sourcePath.trim()
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`文件不存在：${sourcePath}`)
  }
  validateSourcePath(args.kind, sourcePath)

  const prefix = wsKindPrefix(args.kind)
  await batchUploadClient.connect(args.wsUrl, args.clientId, timeoutMs)
  try {
    const stat = fs.statSync(sourcePath)
    const totalSize = stat.size
    const filename = path.basename(sourcePath)
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)

    const initId = randomUUID()
    const initRes = await batchUploadClient.sendJsonAndWait(
      {
        id: initId,
        type: `yolo.batch.${prefix}.upload.init`,
        payload: {
          model_slug: args.modelSlug,
          filename,
          total_size: totalSize,
        },
      },
      timeoutMs,
    )
    if (initRes.type !== `yolo.batch.${prefix}.upload.init.ok`) {
      throw new Error(`init 失败：${initRes.type}`)
    }
    const initPayload = initRes.payload ?? {}
    const uploadId = String(initPayload.upload_id ?? "")
    if (!uploadId) throw new Error("init 响应缺少 upload_id")

    const missingRaw = initPayload.missing_chunks
    const missing: number[] = Array.isArray(missingRaw)
      ? missingRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0)
      : Array.from({ length: totalChunks }, (_, i) => i)

    const fd = await fs.promises.open(sourcePath, "r")
    try {
      for (let i = 0; i < missing.length; i++) {
        const chunkIndex = missing[i]!
        const start = chunkIndex * CHUNK_SIZE
        const length = Math.min(CHUNK_SIZE, totalSize - start)
        const buffer = Buffer.alloc(length)
        await fd.read(buffer, 0, length, start)

        const beginId = randomUUID()
        const readyRes = await batchUploadClient.sendJsonAndWait(
          {
            id: beginId,
            type: `yolo.batch.${prefix}.upload.chunk.begin`,
            payload: {
              model_slug: args.modelSlug,
              upload_id: uploadId,
              chunk_index: chunkIndex,
              byte_length: length,
            },
          },
          timeoutMs,
        )
        if (readyRes.type !== `yolo.batch.${prefix}.upload.chunk.ready`) {
          throw new Error(`chunk ${chunkIndex} 未就绪：${readyRes.type}`)
        }
        batchUploadClient.sendBinary(buffer)
        const okRes = await batchUploadClient.waitForReply(beginId, timeoutMs)
        if (okRes.type !== `yolo.batch.${prefix}.upload.chunk.ok`) {
          throw new Error(`chunk ${chunkIndex} 失败：${okRes.type}`)
        }
        args.onChunkProgress?.(i + 1, missing.length)
      }
    } finally {
      await fd.close()
    }

    const completeId = randomUUID()
    const completeRes = await batchUploadClient.sendJsonAndWait(
      {
        id: completeId,
        type: `yolo.batch.${prefix}.upload.complete`,
        payload: { model_slug: args.modelSlug, upload_id: uploadId },
      },
      30 * 60 * 1000,
    )
    if (completeRes.type !== `yolo.batch.${prefix}.upload.complete.ok`) {
      throw new Error(`complete 失败：${completeRes.type}`)
    }
    const completePayload = completeRes.payload ?? {}
    if (args.kind === "data_yaml") {
      const dataYaml = String(completePayload.data_yaml ?? "")
      if (!dataYaml) throw new Error("complete 响应缺少 data_yaml")
      return {
        data_yaml: dataYaml,
        class_count: Number(completePayload.class_count ?? 0) || undefined,
      }
    }
    const weightsPt = String(completePayload.weights_pt ?? "")
    if (!weightsPt) throw new Error("complete 响应缺少 weights_pt")
    return { weights_pt: weightsPt }
  } finally {
    await batchUploadClient.disconnect()
  }
}

/** @deprecated 使用 uploadYoloBatchFileViaWs */
export async function uploadYoloBatchWeightsViaWs(args: {
  wsUrl: string
  clientId: string
  modelSlug: string
  sourcePtPath: string
  onChunkProgress?: (done: number, total: number) => void
  timeoutMs?: number
}): Promise<{ weights_pt: string }> {
  const result = await uploadYoloBatchFileViaWs({
    kind: "weights",
    wsUrl: args.wsUrl,
    clientId: args.clientId,
    modelSlug: args.modelSlug,
    sourcePath: args.sourcePtPath,
    onChunkProgress: args.onChunkProgress,
    timeoutMs: args.timeoutMs,
  })
  return { weights_pt: result.weights_pt ?? "" }
}

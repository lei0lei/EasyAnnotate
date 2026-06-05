/**
 * YOLO batch auto-annotate loop (runs in child process).
 * Processes images in batches of 10 over a single persistent WebSocket session.
 */
import {
  collectTaskImageListing,
  resolveTaskRootDir,
} from "./task-image-paths"
import {
  connectYoloBatchPredictWs,
  disconnectYoloBatchPredictWs,
  yoloBatchPredictImageViaWs,
} from "./backend-yolo-batch-predict-ws"
import { apiRootToWsUrl } from "./backend-yolo-training-ws"
import { getLocalImageFileInfo, resolveAnnotationJsonPath } from "./image-file-info"
import {
  annotationJsonHasShapes,
  writeShapesToAnnotationJsonFile,
} from "./xanylabel-annotation-merge"
import {
  detectionDebugSummary,
  yoloPredictResultToShapes,
  type YoloBatchPredictResult,
} from "./yolo-predict-to-annotation"

export const YOLO_AUTO_ANNOTATE_BATCH_SIZE = 10
const PREDICT_TIMEOUT_MS = 120_000
const LABEL_MISMATCH_SAMPLE_LIMIT = 5

export type YoloAutoAnnotateRunRequest = {
  jobId: string
  globalConfigDir: string
  projectId: string
  taskId: string
  modelSlug: string
  apiRoot: string
  allowedLabels: string[]
  skipAnnotated?: boolean
  overwriteExisting?: boolean
}

export type YoloAutoAnnotateRunState = {
  status: "running" | "success" | "failed" | "cancelled"
  done: number
  total: number
  currentFile: string
  message: string
  errorMessage: string
  skippedAlreadyAnnotated: number
  skippedLabelMismatch: number
  summaryMessage: string
}

function dimensionsFromPredict(predict: YoloBatchPredictResult): { width: number; height: number } {
  const shape = predict.results?.[0]?.shape
  if (!shape || shape.length < 2) return { width: 0, height: 0 }
  const h = Number(shape[0])
  const w = Number(shape[1])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { width: 0, height: 0 }
  return { width: Math.round(w), height: Math.round(h) }
}

function basenameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean)
  return parts[parts.length - 1] ?? filePath
}

function buildSummaryMessage(args: {
  annotatedCount: number
  skippedAlreadyAnnotated: number
  skippedLabelMismatch: number
  skippedNoDetection: number
  labelMismatchSamples: string[]
  cancelled: boolean
}): string {
  const parts: string[] = []
  if (args.cancelled) {
    parts.push("已取消")
  } else {
    parts.push("全部完成")
  }
  if (args.annotatedCount > 0) parts.push(`新标注 ${args.annotatedCount} 张`)
  if (args.skippedAlreadyAnnotated > 0) parts.push(`跳过已有标注 ${args.skippedAlreadyAnnotated} 张`)
  if (args.skippedNoDetection > 0) parts.push(`无检测结果 ${args.skippedNoDetection} 张`)
  if (args.skippedLabelMismatch > 0) {
    const sample = args.labelMismatchSamples.map(basenameFromPath).join("、")
    parts.push(`类别映射失败跳过 ${args.skippedLabelMismatch} 张${sample ? `（如 ${sample}）` : ""}`)
  }
  return parts.join("；")
}

export async function runYoloBatchAutoAnnotateInChild(
  request: YoloAutoAnnotateRunRequest,
  options: {
    onState: (state: YoloAutoAnnotateRunState) => void
    isCancelled: () => boolean
  },
): Promise<void> {
  const modelSlug = request.modelSlug.trim()
  const projectId = request.projectId.trim()
  const taskId = request.taskId.trim()
  const allowed = new Set(request.allowedLabels.map((l) => l.trim()).filter(Boolean))
  const wsUrl = apiRootToWsUrl(request.apiRoot.trim())
  const skipAnnotated = request.overwriteExisting ? false : request.skipAnnotated !== false
  const overwriteExisting = request.overwriteExisting === true

  if (!projectId || !taskId) {
    options.onState({
      status: "failed",
      done: 0,
      total: 0,
      currentFile: "",
      message: "任务无效",
      errorMessage: "项目或任务标识为空",
      skippedAlreadyAnnotated: 0,
      skippedLabelMismatch: 0,
      summaryMessage: "",
    })
    return
  }

  if (!modelSlug) {
    options.onState({
      status: "failed",
      done: 0,
      total: 0,
      currentFile: "",
      message: "模型标识为空",
      errorMessage: "模型标识为空",
      skippedAlreadyAnnotated: 0,
      skippedLabelMismatch: 0,
      summaryMessage: "",
    })
    return
  }
  if (allowed.size === 0) {
    options.onState({
      status: "failed",
      done: 0,
      total: 0,
      currentFile: "",
      message: "无可用类别标签",
      errorMessage: "项目尚未配置可用的普通类别标签（需与模型 data.yaml 中的类别名一致）",
      skippedAlreadyAnnotated: 0,
      skippedLabelMismatch: 0,
      summaryMessage: "",
    })
    return
  }

  let done = 0
  let annotatedCount = 0
  let skippedAlreadyAnnotated = 0
  let skippedLabelMismatch = 0
  let skippedNoDetection = 0
  const labelMismatchSamples: string[] = []
  let total = 0
  let imagePaths: string[] = []

  const emit = (patch: Partial<YoloAutoAnnotateRunState> & { total?: number }): void => {
    if (typeof patch.total === "number") {
      total = patch.total
    }
    options.onState({
      status: patch.status ?? "running",
      done: patch.done ?? done,
      total,
      currentFile: patch.currentFile ?? "",
      message: patch.message ?? "",
      errorMessage: patch.errorMessage ?? "",
      skippedAlreadyAnnotated: patch.skippedAlreadyAnnotated ?? skippedAlreadyAnnotated,
      skippedLabelMismatch: patch.skippedLabelMismatch ?? skippedLabelMismatch,
      summaryMessage: patch.summaryMessage ?? "",
    })
  }

  const patch = (patch: Partial<YoloAutoAnnotateRunState> & { total?: number }): void => {
    emit(patch)
  }

  patch({ message: "读取任务图片列表…", total: 0 })

  const resolved = resolveTaskRootDir(request.globalConfigDir, projectId, taskId)
  if (resolved.errorMessage) {
    options.onState({
      status: "failed",
      done: 0,
      total: 0,
      currentFile: "",
      message: "无法定位任务目录",
      errorMessage: resolved.errorMessage,
      skippedAlreadyAnnotated: 0,
      skippedLabelMismatch: 0,
      summaryMessage: "",
    })
    return
  }

  const listing = collectTaskImageListing(resolved.taskRootDir)
  imagePaths = listing.imagePaths
  total = imagePaths.length
  const batchCount = Math.ceil(total / YOLO_AUTO_ANNOTATE_BATCH_SIZE)

  if (total === 0) {
    if (listing.nonImageFileCount > 0) {
      options.onState({
        status: "failed",
        done: 0,
        total: 0,
        currentFile: "",
        message: "无可用图片",
        errorMessage:
          "任务中没有支持的图片文件（支持 .jpg/.jpeg/.png/.bmp/.gif/.webp/.tif/.tiff）",
        skippedAlreadyAnnotated: 0,
        skippedLabelMismatch: 0,
        summaryMessage: "",
      })
      return
    }
    options.onState({
      status: "success",
      done: 0,
      total: 0,
      currentFile: "",
      message: "完成",
      errorMessage: "",
      skippedAlreadyAnnotated: 0,
      skippedLabelMismatch: 0,
      summaryMessage: "无图片需要处理",
    })
    return
  }

  patch({ message: `共 ${total} 张图片，连接推理 WebSocket…`, total })

  try {
    await connectYoloBatchPredictWs(wsUrl, `yolo-batch-predict-${request.jobId}`, 30_000)
  } catch (error) {
    options.onState({
      status: "failed",
      done,
      total,
      currentFile: "",
      message: "连接失败",
      errorMessage: error instanceof Error ? error.message : "无法连接推理 WebSocket",
      skippedAlreadyAnnotated,
      skippedLabelMismatch,
      summaryMessage: "",
    })
    return
  }

  try {
    for (let batchStart = 0; batchStart < total; batchStart += YOLO_AUTO_ANNOTATE_BATCH_SIZE) {
      if (options.isCancelled()) {
        const summaryMessage = buildSummaryMessage({
          annotatedCount,
          skippedAlreadyAnnotated,
          skippedLabelMismatch,
          skippedNoDetection,
          labelMismatchSamples,
          cancelled: true,
        })
        options.onState({
          status: "cancelled",
          done,
          total,
          currentFile: "",
          message: "已取消",
          errorMessage: "",
          skippedAlreadyAnnotated,
          skippedLabelMismatch,
          summaryMessage,
        })
        return
      }

      const batchEnd = Math.min(batchStart + YOLO_AUTO_ANNOTATE_BATCH_SIZE, total)
      const batchIndex = Math.floor(batchStart / YOLO_AUTO_ANNOTATE_BATCH_SIZE) + 1
      patch({ message: `第 ${batchIndex}/${batchCount} 批（${batchStart + 1}–${batchEnd}/${total}）…` })

      for (let i = batchStart; i < batchEnd; i++) {
        if (options.isCancelled()) {
          const summaryMessage = buildSummaryMessage({
            annotatedCount,
            skippedAlreadyAnnotated,
            skippedLabelMismatch,
            skippedNoDetection,
            labelMismatchSamples,
            cancelled: true,
          })
          options.onState({
            status: "cancelled",
            done,
            total,
            currentFile: "",
            message: "已取消",
            errorMessage: "",
            skippedAlreadyAnnotated,
            skippedLabelMismatch,
            summaryMessage,
          })
          return
        }

        const imagePath = imagePaths[i]!
        const jsonPath = resolveAnnotationJsonPath(imagePath)

        if (skipAnnotated && annotationJsonHasShapes(jsonPath)) {
          skippedAlreadyAnnotated += 1
          done += 1
          patch({
            currentFile: imagePath,
            message: `跳过已有标注 (${done}/${total})`,
            skippedAlreadyAnnotated,
          })
          continue
        }

        patch({ currentFile: imagePath, message: `推理中 (${done + 1}/${total})…` })

        const info = getLocalImageFileInfo(imagePath)
        if (!info.exists) {
          options.onState({
            status: "failed",
            done,
            total,
            currentFile: imagePath,
            message: "图片不可用",
            errorMessage: info.errorMessage || `图片不存在或无法访问：${imagePath}`,
            skippedAlreadyAnnotated,
            skippedLabelMismatch,
            summaryMessage: "",
          })
          return
        }

        let predict: YoloBatchPredictResult
        try {
          const payload = await yoloBatchPredictImageViaWs({
            modelSlug,
            imagePath,
            timeoutMs: PREDICT_TIMEOUT_MS,
          })
          predict = payload as YoloBatchPredictResult
        } catch (error) {
          options.onState({
            status: "failed",
            done,
            total,
            currentFile: imagePath,
            message: "推理失败",
            errorMessage: error instanceof Error ? error.message : "推理失败",
            skippedAlreadyAnnotated,
            skippedLabelMismatch,
            summaryMessage: "",
          })
          return
        }

        const fromPredict = dimensionsFromPredict(predict)
        const imageWidth = fromPredict.width > 0 ? fromPredict.width : info.width
        const imageHeight = fromPredict.height > 0 ? fromPredict.height : info.height
        if (imageWidth <= 0 || imageHeight <= 0) {
          options.onState({
            status: "failed",
            done,
            total,
            currentFile: imagePath,
            message: "无法确定尺寸",
            errorMessage: `无法确定图片尺寸：${imagePath}`,
            skippedAlreadyAnnotated,
            skippedLabelMismatch,
            summaryMessage: "",
          })
          return
        }

        const newShapes = yoloPredictResultToShapes(predict, allowed, imageWidth, imageHeight)

        if (newShapes.length <= 0) {
          const detections = predict.results?.[0]?.detections ?? []
          if (detections.length > 0) {
            skippedLabelMismatch += 1
            if (labelMismatchSamples.length < LABEL_MISMATCH_SAMPLE_LIMIT) {
              labelMismatchSamples.push(imagePath)
            }
            done += 1
            patch({
              currentFile: imagePath,
              message: `类别映射失败，已跳过 (${done}/${total})`,
              skippedLabelMismatch,
            })
            continue
          }
          skippedNoDetection += 1
          done += 1
          patch({
            currentFile: imagePath,
            message: `未检测到目标，已跳过 (${done}/${total})`,
          })
          continue
        }

        patch({ currentFile: imagePath, message: `写入标注 (${done + 1}/${total})…` })

        const write = writeShapesToAnnotationJsonFile({
          jsonPath,
          imagePath,
          imageWidth,
          imageHeight,
          shapesJson: JSON.stringify(newShapes),
          mode: overwriteExisting ? "replace" : "append",
        })
        if (write.errorMessage) {
          options.onState({
            status: "failed",
            done,
            total,
            currentFile: imagePath,
            message: "写入失败",
            errorMessage: write.errorMessage,
            skippedAlreadyAnnotated,
            skippedLabelMismatch,
            summaryMessage: "",
          })
          return
        }

        annotatedCount += 1
        done += 1
        patch({ currentFile: imagePath, message: `已完成 ${done}/${total}` })
      }
    }

    const summaryMessage = buildSummaryMessage({
      annotatedCount,
      skippedAlreadyAnnotated,
      skippedLabelMismatch,
      skippedNoDetection,
      labelMismatchSamples,
      cancelled: false,
    })
    options.onState({
      status: "success",
      done: total,
      total,
      currentFile: "",
      message: summaryMessage,
      errorMessage: "",
      skippedAlreadyAnnotated,
      skippedLabelMismatch,
      summaryMessage,
    })
  } finally {
    await disconnectYoloBatchPredictWs()
  }
}

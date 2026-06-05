/**
 * YOLO batch auto-annotate loop (runs in child process).
 * Processes images in batches of 10 over a single persistent WebSocket session.
 */
import {
  connectYoloBatchPredictWs,
  disconnectYoloBatchPredictWs,
  yoloBatchPredictImageViaWs,
} from "./backend-yolo-batch-predict-ws"
import { apiRootToWsUrl } from "./backend-yolo-training-ws"
import { getLocalImageFileInfo, resolveAnnotationJsonPath } from "./image-file-info"
import { appendShapesToAnnotationJsonFile } from "./xanylabel-annotation-merge"
import {
  detectionDebugSummary,
  yoloPredictResultToShapes,
  type YoloBatchPredictResult,
} from "./yolo-predict-to-annotation"

export const YOLO_AUTO_ANNOTATE_BATCH_SIZE = 10
const PREDICT_TIMEOUT_MS = 120_000

export type YoloAutoAnnotateRunRequest = {
  jobId: string
  modelSlug: string
  apiRoot: string
  imagePaths: string[]
  allowedLabels: string[]
}

export type YoloAutoAnnotateRunState = {
  status: "running" | "success" | "failed" | "cancelled"
  done: number
  total: number
  currentFile: string
  message: string
  errorMessage: string
}

function dimensionsFromPredict(predict: YoloBatchPredictResult): { width: number; height: number } {
  const shape = predict.results?.[0]?.shape
  if (!shape || shape.length < 2) return { width: 0, height: 0 }
  const h = Number(shape[0])
  const w = Number(shape[1])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { width: 0, height: 0 }
  return { width: Math.round(w), height: Math.round(h) }
}

export async function runYoloBatchAutoAnnotateInChild(
  request: YoloAutoAnnotateRunRequest,
  options: {
    onState: (state: YoloAutoAnnotateRunState) => void
    isCancelled: () => boolean
  },
): Promise<void> {
  const modelSlug = request.modelSlug.trim()
  const imagePaths = request.imagePaths.map((p) => p.trim()).filter(Boolean)
  const total = imagePaths.length
  const allowed = new Set(request.allowedLabels.map((l) => l.trim()).filter(Boolean))
  const wsUrl = apiRootToWsUrl(request.apiRoot.trim())
  const batchCount = Math.ceil(total / YOLO_AUTO_ANNOTATE_BATCH_SIZE)

  if (!modelSlug) {
    options.onState({
      status: "failed",
      done: 0,
      total,
      currentFile: "",
      message: "模型标识为空",
      errorMessage: "模型标识为空",
    })
    return
  }
  if (allowed.size === 0) {
    options.onState({
      status: "failed",
      done: 0,
      total,
      currentFile: "",
      message: "无可用类别标签",
      errorMessage: "项目尚未配置可用的普通类别标签（需与模型 data.yaml 中的类别名一致）",
    })
    return
  }
  if (total === 0) {
    options.onState({
      status: "success",
      done: 0,
      total: 0,
      currentFile: "",
      message: "完成",
      errorMessage: "",
    })
    return
  }

  let done = 0

  const patch = (patch: Partial<YoloAutoAnnotateRunState>): void => {
    options.onState({
      status: "running",
      done,
      total,
      currentFile: patch.currentFile ?? "",
      message: patch.message ?? "",
      errorMessage: patch.errorMessage ?? "",
    })
  }

  patch({ message: "连接推理 WebSocket…" })

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
    })
    return
  }

  try {
    for (let batchStart = 0; batchStart < total; batchStart += YOLO_AUTO_ANNOTATE_BATCH_SIZE) {
      if (options.isCancelled()) {
        options.onState({
          status: "cancelled",
          done,
          total,
          currentFile: "",
          message: "已取消",
          errorMessage: "",
        })
        return
      }

      const batchEnd = Math.min(batchStart + YOLO_AUTO_ANNOTATE_BATCH_SIZE, total)
      const batchIndex = Math.floor(batchStart / YOLO_AUTO_ANNOTATE_BATCH_SIZE) + 1
      patch({ message: `第 ${batchIndex}/${batchCount} 批（${batchStart + 1}–${batchEnd}/${total}）…` })

      for (let i = batchStart; i < batchEnd; i++) {
        if (options.isCancelled()) {
          options.onState({
            status: "cancelled",
            done,
            total,
            currentFile: "",
            message: "已取消",
            errorMessage: "",
          })
          return
        }

        const imagePath = imagePaths[i]!
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
          })
          return
        }

        const newShapes = yoloPredictResultToShapes(predict, allowed, imageWidth, imageHeight)

        if (newShapes.length <= 0) {
          const detections = predict.results?.[0]?.detections ?? []
          if (detections.length > 0) {
            options.onState({
              status: "failed",
              done,
              total,
              currentFile: imagePath,
              message: "类别映射失败",
              errorMessage:
                `该图片有模型检测结果，但全部未转为标注（常见原因：类别名映射失败）。` +
                ` 调试信息：${detectionDebugSummary(predict)}`,
            })
            return
          }
          done += 1
          patch({
            currentFile: imagePath,
            message: `未检测到目标，已跳过 (${done}/${total})`,
          })
          continue
        }

        patch({ currentFile: imagePath, message: `写入标注 (${done + 1}/${total})…` })

        const jsonPath = resolveAnnotationJsonPath(imagePath)
        const write = appendShapesToAnnotationJsonFile({
          jsonPath,
          imagePath,
          imageWidth,
          imageHeight,
          shapesJson: JSON.stringify(newShapes),
        })
        if (write.errorMessage) {
          options.onState({
            status: "failed",
            done,
            total,
            currentFile: imagePath,
            message: "写入失败",
            errorMessage: write.errorMessage,
          })
          return
        }

        done += 1
        patch({ currentFile: imagePath, message: `已完成 ${done}/${total}` })
      }
    }

    options.onState({
      status: "success",
      done: total,
      total,
      currentFile: "",
      message: "全部完成",
      errorMessage: "",
    })
  } finally {
    await disconnectYoloBatchPredictWs()
  }
}

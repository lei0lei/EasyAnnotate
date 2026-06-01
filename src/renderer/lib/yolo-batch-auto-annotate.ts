import {
  appendImageAnnotationShapes,
  getImageFileInfo,
  listAllTaskFiles,
  type ProjectTag,
} from "@/lib/projects-api"
import {
  buildAllowedProjectLabelSet,
  yoloPredictResultToShapes,
  type YoloBatchPredictResult,
} from "@/lib/yolo-predict-to-annotation"
import { ensureYoloBatchModelRunning, predictYoloBatchImage, probeYoloBatchApiAvailable } from "@/lib/yolo-batch-api"
import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"

export type YoloAutoAnnotatePhase = "idle" | "running" | "done" | "error" | "cancelled"

export type YoloAutoAnnotateProgress = {
  phase: YoloAutoAnnotatePhase
  done: number
  total: number
  currentFile?: string
  statusMessage?: string
  errorMessage?: string
}

export type RunYoloBatchAutoAnnotateParams = {
  projectId: string
  taskId: string
  modelSlug: string
  projectTags: ProjectTag[]
  signal?: AbortSignal
  onProgress: (progress: YoloAutoAnnotateProgress) => void
}

function dimensionsFromPredict(predict: YoloBatchPredictResult): { width: number; height: number } {
  const shape = predict.results?.[0]?.shape
  if (!shape || shape.length < 2) return { width: 0, height: 0 }
  const h = Number(shape[0])
  const w = Number(shape[1])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { width: 0, height: 0 }
  return { width: Math.round(w), height: Math.round(h) }
}

function detectionDebugSummary(predict: YoloBatchPredictResult): string {
  const detections = predict.results?.[0]?.detections ?? []
  if (detections.length <= 0) return "detections=0"
  const sample = detections
    .slice(0, 6)
    .map((det) => {
      const name = (det.class_name ?? "").trim()
      return `${det.class_id}:${name || "<empty>"}`
    })
    .join(", ")
  return `detections=${detections.length}; sample=[${sample}]`
}

export async function runYoloBatchAutoAnnotate(params: RunYoloBatchAutoAnnotateParams): Promise<void> {
  const { projectId, taskId, modelSlug, projectTags, signal, onProgress } = params

  onProgress({ phase: "running", done: 0, total: 0, statusMessage: "检查后端接口…" })

  const apiOk = await probeYoloBatchApiAvailable()
  if (!apiOk) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage:
        "当前连接的后端没有 YOLO 批量标注接口（HTTP 404）。请用最新 backend 代码重启本地或远程后端后再试。",
    })
    return
  }

  onProgress({ phase: "running", done: 0, total: 0, statusMessage: "启动/加载模型…" })
  try {
    await ensureYoloBatchModelRunning(modelSlug)
  } catch (e) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: e instanceof Error ? e.message : "启动模型失败",
    })
    return
  }

  const allowed = buildAllowedProjectLabelSet(projectTags)
  if (allowed.size === 0) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: "项目尚未配置可用的普通类别标签（需与模型 data.yaml 中的类别名一致）",
    })
    return
  }

  onProgress({ phase: "running", done: 0, total: 0, statusMessage: "读取任务图片列表…" })
  const fileResult = await listAllTaskFiles({ projectId, taskId })
  if (fileResult.errorMessage) {
    onProgress({
      phase: "error",
      done: 0,
      total: 0,
      errorMessage: fileResult.errorMessage,
    })
    return
  }

  const files = fileResult.files.filter((f) => f.filePath?.trim())
  const total = files.length
  if (total === 0) {
    onProgress({ phase: "done", done: 0, total: 0 })
    return
  }

  onProgress({ phase: "running", done: 0, total })

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) {
      onProgress({ phase: "cancelled", done: i, total })
      return
    }

    const imagePath = files[i]!.filePath.trim()
    onProgress({ phase: "running", done: i, total, currentFile: imagePath, statusMessage: "推理中…" })

    const info = await getImageFileInfo(imagePath)
    if (!info.exists) {
      onProgress({
        phase: "error",
        done: i,
        total,
        errorMessage: info.errorMessage || `图片不存在或无法访问：${imagePath}`,
      })
      return
    }

    let predict: YoloBatchPredictResult
    try {
      predict = await predictYoloBatchImage(modelSlug, imagePath)
    } catch (e) {
      onProgress({
        phase: "error",
        done: i,
        total,
        errorMessage: e instanceof Error ? e.message : "推理失败",
      })
      return
    }

    const fromPredict = dimensionsFromPredict(predict)
    // 坐标基准统一：优先使用 YOLO 推理返回的原图尺寸（orig_shape）。
    // 这样可避免“预测坐标按 A 尺寸、文档按 B 尺寸写入”导致的加载期二次缩放偏移。
    const imageWidth = fromPredict.width > 0 ? fromPredict.width : info.width
    const imageHeight = fromPredict.height > 0 ? fromPredict.height : info.height
    if (imageWidth <= 0 || imageHeight <= 0) {
      onProgress({
        phase: "error",
        done: i,
        total,
        errorMessage: `无法确定图片尺寸：${imagePath}`,
      })
      return
    }

    const newShapes = normalizeDocPointsToInt({
      version: "2.5.4",
      flags: {},
      shapes: yoloPredictResultToShapes(predict, allowed, imageWidth, imageHeight),
      description: null,
      imagePath,
      imageData: null,
      imageHeight,
      imageWidth,
    }).shapes

    if (newShapes.length <= 0) {
      const detections = predict.results?.[0]?.detections ?? []
      if (detections.length > 0) {
        onProgress({
          phase: "error",
          done: i,
          total,
          errorMessage:
            `该图片有模型检测结果，但全部未转为标注（常见原因：类别名映射失败）。` +
            ` 调试信息：${detectionDebugSummary(predict)}`,
        })
        return
      }
      onProgress({
        phase: "running",
        done: i + 1,
        total,
        currentFile: imagePath,
        statusMessage: "未检测到目标，已跳过",
      })
      continue
    }

    onProgress({ phase: "running", done: i, total, currentFile: imagePath, statusMessage: "写入标注…" })

    const write = await appendImageAnnotationShapes({
      imagePath,
      shapesJson: JSON.stringify(newShapes),
      imageWidth,
      imageHeight,
    })
    if (write.errorMessage) {
      onProgress({ phase: "error", done: i, total, errorMessage: write.errorMessage })
      return
    }

    onProgress({ phase: "running", done: i + 1, total, currentFile: imagePath })
  }

  onProgress({ phase: "done", done: total, total })
}

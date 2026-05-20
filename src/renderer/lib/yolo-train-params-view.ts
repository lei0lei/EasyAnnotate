import { YOLO_AUGMENT_FIELDS, YOLO_OPTIMIZER_FIELDS } from "@/lib/yolo-train-advanced"
import type { YoloWorkspaceSnapshot } from "@/lib/training-yolo-api"

export type TrainParamRow = { label: string; value: string }
export type TrainParamSection = { title: string; rows: TrainParamRow[] }

const FAMILY_LABELS: Record<string, string> = {
  yolov8: "YOLOv8",
  yolo26: "YOLO26",
}

const TASK_LABELS: Record<string, string> = {
  detect: "检测",
  segment: "分割",
  pose: "姿态",
  obb: "OBB",
  classify: "分类",
}

const COMMON_LABELS: Record<string, string> = {
  epochs: "训练轮数 epochs",
  imgsz: "输入尺寸 imgsz",
  batch: "批大小 batch",
  workers: "数据加载 workers",
  device: "设备 device",
  time_hours: "训练时限（小时）",
  export_onnx: "训练后导出 ONNX",
}

const augmentLabelByKey = new Map(
  YOLO_AUGMENT_FIELDS.map((f) => [f.key, f.hint || f.label]),
)
const optimizerLabelByKey = new Map(
  YOLO_OPTIMIZER_FIELDS.map((f) => [f.key, f.hint || f.label]),
)

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "是" : "否"
  if (typeof value === "number") {
    if (value === 0 || Number.isInteger(value)) return String(value)
    return String(value)
  }
  if (typeof value === "string") return value.trim() || "—"
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(", ")
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function formatTimeHours(value: unknown): string {
  if (value === null || value === undefined) return "不限制"
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return "不限制"
  return String(n)
}

function formatBoolFlag(value: unknown): string {
  return value ? "已启用" : "未启用"
}

function dictRows(
  dict: Record<string, unknown> | null | undefined,
  labelMap: Map<string, string>,
): TrainParamRow[] {
  if (!dict || typeof dict !== "object") return []
  return Object.entries(dict)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([key, value]) => ({
      label: labelMap.get(key) ?? key,
      value: formatValue(value),
    }))
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function buildTrainParamSections(workspace: YoloWorkspaceSnapshot): TrainParamSection[] {
  const meta = workspace.meta ?? {}
  const sections: TrainParamSection[] = []

  const modelRows: TrainParamRow[] = []
  const family = metaString(meta, "base_model_family")
  const task = metaString(meta, "base_model_task")
  if (family) {
    modelRows.push({ label: "模型族", value: FAMILY_LABELS[family] ?? family })
  }
  if (task) {
    modelRows.push({ label: "任务类型", value: TASK_LABELS[task] ?? task })
  }
  const weightName =
    workspace.base_model_filename?.trim() ||
    metaString(meta, "base_model_filename") ||
    workspace.base_model_asset_id?.trim() ||
    null
  if (weightName) {
    modelRows.push({ label: "基础权重", value: weightName })
  }
  const datasetName =
    workspace.dataset_zip_filename?.trim() || metaString(meta, "dataset_zip_filename")
  if (datasetName) {
    modelRows.push({ label: "数据集 ZIP", value: datasetName })
  }
  if (modelRows.length > 0) {
    sections.push({ title: "模型与数据", rows: modelRows })
  }

  const rawTrainParams = meta.train_params
  if (!rawTrainParams || typeof rawTrainParams !== "object") {
    return sections
  }

  const trainParams = rawTrainParams as Record<string, unknown>
  const commonRows: TrainParamRow[] = []
  for (const key of ["epochs", "imgsz", "batch", "workers", "device"] as const) {
    if (trainParams[key] !== undefined && trainParams[key] !== null) {
      commonRows.push({
        label: COMMON_LABELS[key],
        value: formatValue(trainParams[key]),
      })
    }
  }
  if ("time_hours" in trainParams) {
    commonRows.push({
      label: COMMON_LABELS.time_hours,
      value: formatTimeHours(trainParams.time_hours),
    })
  }
  if ("export_onnx" in trainParams) {
    commonRows.push({
      label: COMMON_LABELS.export_onnx,
      value: formatBoolFlag(trainParams.export_onnx),
    })
  }
  if (commonRows.length > 0) {
    sections.push({ title: "常用参数", rows: commonRows })
  }

  sections.push({
    title: "图像增强",
    rows: [
      { label: "自定义增强", value: formatBoolFlag(trainParams.use_custom_augment) },
      ...dictRows(
        trainParams.use_custom_augment && typeof trainParams.augment === "object"
          ? (trainParams.augment as Record<string, unknown>)
          : null,
        augmentLabelByKey,
      ),
    ],
  })

  sections.push({
    title: "优化器",
    rows: [
      { label: "自定义优化器", value: formatBoolFlag(trainParams.use_custom_optimizer) },
      ...dictRows(
        trainParams.use_custom_optimizer && typeof trainParams.optimizer === "object"
          ? (trainParams.optimizer as Record<string, unknown>)
          : null,
        optimizerLabelByKey,
      ),
    ],
  })

  return sections
}

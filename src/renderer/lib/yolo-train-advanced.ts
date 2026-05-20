import type { YoloTaskId } from "@/lib/training-yolo-api"

export type AugmentFieldType = "float" | "string" | "select"

export type AugmentFieldDef = {
  key: string
  type: AugmentFieldType
  default: number | string
  min?: number
  max?: number
  step?: number
  tasks: YoloTaskId[] | "classify" | "detect_group"
  label: string
  hint?: string
  options?: string[]
}

/** detect/segment/pose/obb 检测类任务（不含 classify） */
const DET = ["detect", "segment", "pose", "obb"] as const
const ALL = ["detect", "segment", "pose", "obb", "classify"] as const

export const YOLO_AUGMENT_FIELDS: AugmentFieldDef[] = [
  { key: "hsv_h", type: "float", default: 0.015, min: 0, max: 1, step: 0.001, tasks: [...ALL], label: "hsv_h", hint: "色相增强" },
  { key: "hsv_s", type: "float", default: 0.7, min: 0, max: 1, step: 0.01, tasks: [...ALL], label: "hsv_s", hint: "饱和度增强" },
  { key: "hsv_v", type: "float", default: 0.4, min: 0, max: 1, step: 0.01, tasks: [...ALL], label: "hsv_v", hint: "亮度增强" },
  { key: "degrees", type: "float", default: 0, min: 0, max: 180, step: 1, tasks: [...DET], label: "degrees", hint: "随机旋转" },
  { key: "translate", type: "float", default: 0.1, min: 0, max: 1, step: 0.01, tasks: [...DET], label: "translate", hint: "平移" },
  { key: "scale", type: "float", default: 0.5, min: 0, max: 1, step: 0.01, tasks: [...ALL], label: "scale", hint: "缩放" },
  { key: "shear", type: "float", default: 0, min: -180, max: 180, step: 1, tasks: [...DET], label: "shear", hint: "错切" },
  { key: "perspective", type: "float", default: 0, min: 0, max: 0.001, step: 0.0001, tasks: [...DET], label: "perspective", hint: "透视" },
  { key: "flipud", type: "float", default: 0, min: 0, max: 1, step: 0.05, tasks: [...ALL], label: "flipud", hint: "上下翻转概率" },
  { key: "fliplr", type: "float", default: 0.5, min: 0, max: 1, step: 0.05, tasks: [...ALL], label: "fliplr", hint: "左右翻转概率" },
  { key: "bgr", type: "float", default: 0, min: 0, max: 1, step: 0.05, tasks: [...DET], label: "bgr", hint: "BGR 通道翻转概率" },
  { key: "mosaic", type: "float", default: 1, min: 0, max: 1, step: 0.05, tasks: [...DET], label: "mosaic", hint: "Mosaic 概率" },
  { key: "mixup", type: "float", default: 0, min: 0, max: 1, step: 0.05, tasks: [...DET], label: "mixup", hint: "MixUp 概率" },
  { key: "cutmix", type: "float", default: 0, min: 0, max: 1, step: 0.05, tasks: [...DET], label: "cutmix", hint: "CutMix 概率" },
  { key: "copy_paste", type: "float", default: 0, min: 0, max: 1, step: 0.05, tasks: ["segment"], label: "copy_paste", hint: "复制粘贴（segment）" },
  {
    key: "copy_paste_mode",
    type: "select",
    default: "flip",
    tasks: ["segment"],
    label: "copy_paste_mode",
    options: ["flip", "mixup"],
  },
  {
    key: "auto_augment",
    type: "select",
    default: "randaugment",
    tasks: ["classify"],
    label: "auto_augment",
    options: ["randaugment", "augmix", "autoaugment", "none"],
  },
  { key: "erasing", type: "float", default: 0.4, min: 0, max: 1, step: 0.05, tasks: ["classify"], label: "erasing", hint: "随机擦除（classify）" },
]

export type OptimizerFieldType = "float" | "select" | "int" | "bool" | "text"

export type OptimizerFieldDef = {
  key: string
  type: OptimizerFieldType
  default: number | string
  min?: number
  max?: number
  step?: number
  label: string
  hint?: string
  options?: string[]
  /** 未设置表示所有任务可见 */
  tasks?: readonly YoloTaskId[]
  placeholder?: string
}

export const YOLO_OPTIMIZER_FIELDS: OptimizerFieldDef[] = [
  {
    key: "optimizer",
    type: "select",
    default: "auto",
    label: "optimizer",
    hint: "优化器",
    options: ["auto", "SGD", "Adam", "AdamW", "NAdam", "RAdam", "RMSProp"],
  },
  {
    key: "freeze",
    type: "text",
    default: "",
    label: "freeze",
    hint: "冻结层",
    placeholder: "留空=不冻结；如 10 或 0,1,2",
  },
  { key: "lr0", type: "float", default: 0.01, min: 0, max: 1, step: 0.0001, label: "lr0", hint: "初始学习率" },
  { key: "lrf", type: "float", default: 0.01, min: 0, max: 1, step: 0.001, label: "lrf", hint: "最终学习率比例" },
  { key: "momentum", type: "float", default: 0.937, min: 0, max: 1, step: 0.001, label: "momentum", hint: "动量" },
  { key: "weight_decay", type: "float", default: 0.0005, min: 0, max: 0.1, step: 0.0001, label: "weight_decay", hint: "L2 正则" },
  { key: "warmup_epochs", type: "float", default: 3, min: 0, max: 100, step: 0.5, label: "warmup_epochs", hint: "warmup epoch" },
  { key: "warmup_momentum", type: "float", default: 0.8, min: 0, max: 1, step: 0.01, label: "warmup_momentum", hint: "warmup 动量" },
  { key: "warmup_bias_lr", type: "float", default: 0.1, min: 0, max: 1, step: 0.01, label: "warmup_bias_lr", hint: "warmup bias 学习率" },
  { key: "cos_lr", type: "bool", default: 0, label: "cos_lr", hint: "余弦学习率" },
  { key: "multi_scale", type: "float", default: 0, min: 0, max: 1, step: 0.05, tasks: [...DET], label: "multi_scale", hint: "多尺度训练" },
  { key: "close_mosaic", type: "int", default: 10, min: 0, max: 1000, tasks: [...DET], label: "close_mosaic", hint: "最后 N epoch 关闭 Mosaic" },
  { key: "patience", type: "int", default: 50, min: 0, max: 1000, label: "patience", hint: "早停 patience" },
  { key: "nbs", type: "int", default: 64, min: 1, max: 512, label: "nbs", hint: "标准 batch size" },
  { key: "dropout", type: "float", default: 0, min: 0, max: 1, step: 0.05, label: "dropout", hint: "dropout 比例" },
  { key: "box", type: "float", default: 7.5, min: 0, max: 100, step: 0.1, tasks: [...DET], label: "box", hint: "box loss 权重" },
  { key: "cls", type: "float", default: 0.5, min: 0, max: 100, step: 0.1, tasks: [...DET], label: "cls", hint: "分类 loss 权重" },
  { key: "cls_pw", type: "float", default: 0, min: 0, max: 10, step: 0.1, tasks: [...DET], label: "cls_pw", hint: "类别不均衡权重" },
  { key: "dfl", type: "float", default: 1.5, min: 0, max: 100, step: 0.1, tasks: [...DET], label: "dfl", hint: "DFL loss 权重" },
  { key: "pose", type: "float", default: 12, min: 0, max: 100, step: 0.1, tasks: ["pose"], label: "pose", hint: "姿态 loss 权重" },
  { key: "kobj", type: "float", default: 1, min: 0, max: 100, step: 0.1, tasks: ["pose"], label: "kobj", hint: "关键点 objectness" },
  { key: "rle", type: "float", default: 1, min: 0, max: 100, step: 0.1, tasks: ["pose"], label: "rle", hint: "姿态定位 loss" },
  { key: "angle", type: "float", default: 1, min: 0, max: 100, step: 0.1, tasks: ["obb"], label: "angle", hint: "OBB 角度 loss" },
  { key: "overlap_mask", type: "bool", default: 1, tasks: ["segment"], label: "overlap_mask", hint: "mask 是否合并" },
  { key: "mask_ratio", type: "int", default: 4, min: 1, max: 32, tasks: ["segment"], label: "mask_ratio", hint: "mask 下采样比例" },
]

export function augmentFieldVisible(field: AugmentFieldDef, task: YoloTaskId): boolean {
  return field.tasks.includes(task)
}

export function optimizerFieldVisible(field: OptimizerFieldDef, task: YoloTaskId): boolean {
  if (!field.tasks) return true
  return field.tasks.includes(task)
}

function parseFreezeValue(raw: string): number | number[] | undefined {
  const s = raw.trim()
  if (!s) return undefined
  if (s.includes(",")) {
    const parts = s
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n))
    return parts.length > 0 ? parts : undefined
  }
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : undefined
}

export function defaultAugmentValues(): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const f of YOLO_AUGMENT_FIELDS) {
    out[f.key] = f.default
  }
  return out
}

export function defaultOptimizerValues(): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const f of YOLO_OPTIMIZER_FIELDS) {
    out[f.key] = f.default
  }
  return out
}

export function buildAugmentTrainPayload(
  values: Record<string, number | string>,
  task: YoloTaskId,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of YOLO_AUGMENT_FIELDS) {
    if (!augmentFieldVisible(f, task)) continue
    const v = values[f.key]
    if (v === undefined || v === "") continue
    if (f.type === "float") out[f.key] = Number(v)
    else out[f.key] = String(v)
  }
  return out
}

export function buildOptimizerTrainPayload(
  values: Record<string, number | string>,
  task: YoloTaskId,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of YOLO_OPTIMIZER_FIELDS) {
    if (!optimizerFieldVisible(f, task)) continue
    const v = values[f.key]
    if (f.type === "text") {
      if (f.key === "freeze") {
        const parsed = parseFreezeValue(String(v ?? ""))
        if (parsed !== undefined) out[f.key] = parsed
      }
      continue
    }
    if (v === undefined || v === "") continue
    if (f.type === "bool") {
      out[f.key] = Number(v) !== 0
      continue
    }
    if (f.type === "float") out[f.key] = Number(v)
    else if (f.type === "int") out[f.key] = Math.round(Number(v))
    else out[f.key] = String(v)
  }
  return out
}

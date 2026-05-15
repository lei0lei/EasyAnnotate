/**
 * 模型 runtime 目录在 UI 上的划分：部分分类从「后端模型管理」挪到自动标注子页。
 * 须与后端 `app/model_runtime/catalog.py` 中 `CategorySpec.id` 一致。
 */

/** 不在「模型 → 后端模型管理」展示的分类 id（该页现为占位空白，与目录一致备查） */
export const RUNTIME_CATEGORY_IDS_HIDDEN_FROM_BACKEND_PAGE = new Set<string>([
  "sam2",
  "yolo",
  "dinov2",
  "mobile_sam",
  "efficient_sam",
])

/** 在「自动标注 → SAM2 标注」页中的展示顺序（同页多块平铺） */
export const RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE = ["sam2", "mobile_sam"] as const

export type RuntimeCategoryIdOnSam2AnnotationPage =
  (typeof RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE)[number]

/** 在「自动标注 → 扩散式标注」页中的展示顺序 */
export const RUNTIME_CATEGORY_ORDER_ON_DIFFUSION_ANNOTATION_PAGE = ["dinov2"] as const

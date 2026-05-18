/**
 * 模型 runtime 目录在 UI 上的划分：须与后端 `app/model_runtime/catalog.py` 中 `CategorySpec.id` 一致。
 */

/** 不在「模型 → 后端模型管理」展示的分类（暂未接入 UI 的族） */
export const RUNTIME_CATEGORY_IDS_HIDDEN_FROM_BACKEND_PAGE = new Set<string>(["yolo", "efficient_sam"])

/** 「后端模型管理」页：全局 SAM + DINOv2（SAM 2.1 与 MobileSAM 互斥，同时仅一个） */
export const RUNTIME_CATEGORY_ORDER_ON_BACKEND_PAGE = ["sam2", "mobile_sam", "dinov2"] as const

export type RuntimeCategoryIdOnBackendPage = (typeof RUNTIME_CATEGORY_ORDER_ON_BACKEND_PAGE)[number]

/** 全局 SAM 槽位（``sam2`` / ``mobile_sam``，任务页与各 AI 工具共用） */
export const GLOBAL_SAM_RUNTIME_CATEGORY_IDS = ["sam2", "mobile_sam"] as const

export type GlobalSamRuntimeCategoryId = (typeof GLOBAL_SAM_RUNTIME_CATEGORY_IDS)[number]

/** @deprecated 使用 GLOBAL_SAM_RUNTIME_CATEGORY_IDS */
export const RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE = GLOBAL_SAM_RUNTIME_CATEGORY_IDS

export type RuntimeCategoryIdOnSam2AnnotationPage = GlobalSamRuntimeCategoryId

/** 全局 DINOv2 单例 runtime（catalog 槽位 ``dinov2``）。 */

import { formatBackendModelDisplayName, type RuntimeCategoryRow } from "@/lib/model-runtime-api"

export const GLOBAL_DINOV2_RUNTIME_CATEGORY_ID = "dinov2" as const

export type ActiveGlobalDinov2Runtime = {
  modelId: string
  useGpu: boolean | null
}

export function resolveActiveGlobalDinov2FromCatalog(
  categories: RuntimeCategoryRow[],
): ActiveGlobalDinov2Runtime | null {
  const row = categories.find((c) => c.id === GLOBAL_DINOV2_RUNTIME_CATEGORY_ID)
  if (!row?.running || !row.active_model_id) return null
  return {
    modelId: row.active_model_id,
    useGpu: row.active_use_gpu ?? null,
  }
}

export function formatActiveGlobalDinov2Label(
  active: ActiveGlobalDinov2Runtime,
  categories: RuntimeCategoryRow[],
): string {
  const row = categories.find((c) => c.id === GLOBAL_DINOV2_RUNTIME_CATEGORY_ID)
  const variant = row?.variants.find((v) => v.model_id === active.modelId)
  const modelLabel = variant?.label?.trim()
    ? variant.label
    : formatBackendModelDisplayName(active.modelId)
  return `DINOv2 · ${modelLabel}`
}

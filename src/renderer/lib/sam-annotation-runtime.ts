/** SAM 标注工具：三族互斥 runtime（同时仅启动一个）与任务页解析。 */

import { formatBackendModelDisplayName, stopModelRuntime, type RuntimeCategoryRow } from "@/lib/model-runtime-api"
import { RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE } from "@/lib/model-runtime-ui-visibility"
import { SAM_ANNOTATION_FAMILY_LABELS } from "@/lib/sam-annotation-prefs"
import {
  defaultModelIdForFamily,
  getSamAnnotationModelId,
  modelIdToSamFamily,
  pickSamModelIdForFamily,
  setSamAnnotationFamily,
  setSamAnnotationModelId,
} from "@/lib/sam-annotation-prefs"

export const SAM_ANNOTATION_CATEGORY_IDS = RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE

export type SamAnnotationCategoryId = (typeof SAM_ANNOTATION_CATEGORY_IDS)[number]

export function isSamAnnotationCategoryId(id: string): id is SamAnnotationCategoryId {
  return (SAM_ANNOTATION_CATEGORY_IDS as readonly string[]).includes(id)
}

export type ActiveSamAnnotation = {
  family: SamAnnotationCategoryId
  modelId: string
  useGpu: boolean | null
}

/** 从 catalog 中找出当前唯一在跑的 SAM 标注族（至多一个）。 */
export function resolveActiveSamFromCatalog(categories: RuntimeCategoryRow[]): ActiveSamAnnotation | null {
  let hit: ActiveSamAnnotation | null = null
  for (const family of SAM_ANNOTATION_CATEGORY_IDS) {
    const row = categories.find((c) => c.id === family)
    if (!row?.running || !row.active_model_id) continue
    if (hit) {
      // 后端不应同时跑多族；以先匹配到的为准
      continue
    }
    hit = {
      family,
      modelId: row.active_model_id,
      useGpu: row.active_use_gpu ?? null,
    }
  }
  return hit
}

/** 启动某族前停止其余 SAM 标注 runtime。 */
export async function stopOtherSamAnnotationRuntimes(exceptFamily: SamAnnotationCategoryId): Promise<void> {
  for (const family of SAM_ANNOTATION_CATEGORY_IDS) {
    if (family === exceptFamily) continue
    try {
      await stopModelRuntime(family)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/stop\s+(404|400)\b/i.test(msg)) throw e
    }
  }
}

/** 关闭任务栏时停止全部 SAM 标注 runtime。 */
export async function stopAllSamAnnotationRuntimes(): Promise<void> {
  for (const family of SAM_ANNOTATION_CATEGORY_IDS) {
    try {
      await stopModelRuntime(family)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/stop\s+(404|400)\b/i.test(msg)) throw e
    }
  }
}

export function reconcileSamFamilyAndModelId(
  family: SamAnnotationCategoryId,
  row: RuntimeCategoryRow | undefined,
): string {
  const validIds = new Set((row?.variants ?? []).map((v) => v.model_id))
  return pickSamModelIdForFamily(family, validIds, row?.active_model_id)
}

export function persistSamAnnotationSelection(family: SamAnnotationCategoryId, modelId: string): void {
  setSamAnnotationFamily(family)
  setSamAnnotationModelId(family, modelId)
}

export function formatActiveSamAnnotationLabel(
  active: ActiveSamAnnotation,
  categories: RuntimeCategoryRow[],
): string {
  const row = categories.find((c) => c.id === active.family)
  const variant = row?.variants.find((v) => v.model_id === active.modelId)
  const modelLabel = variant?.label?.trim()
    ? variant.label
    : formatBackendModelDisplayName(active.modelId)
  return `${SAM_ANNOTATION_FAMILY_LABELS[active.family]} · ${modelLabel}`
}

export function inferSamFamilyFromModelId(modelId: string): SamAnnotationCategoryId | null {
  return modelIdToSamFamily(modelId) as SamAnnotationCategoryId | null
}

export function fallbackModelIdForFamily(family: SamAnnotationCategoryId): string {
  const saved = getSamAnnotationModelId(family)
  if (saved) return saved
  return defaultModelIdForFamily(family)
}

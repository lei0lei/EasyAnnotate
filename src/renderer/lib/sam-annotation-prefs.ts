/** 任务页 SAM 标注：模型族 + 各族权重（与配置页、encode-image 的 model_id 一致）。 */

export type SamAnnotationFamily = "sam2" | "mobile_sam" | "efficient_sam"

const LEGACY_SAM2_MODEL_KEY = "ea-sam2-annotation-backend-model-id"
const FAMILY_KEY = "ea-sam-annotation-family"
const MODEL_BY_FAMILY_KEY = "ea-sam-annotation-model-by-family"

export const SAM_ANNOTATION_FAMILY_LABELS: Record<SamAnnotationFamily, string> = {
  sam2: "SAM 2.1",
  mobile_sam: "MobileSAM",
  efficient_sam: "EfficientSAM",
}

export function modelIdToSamFamily(modelId: string): SamAnnotationFamily | null {
  const id = modelId.trim()
  if (id.startsWith("sam2/")) return "sam2"
  if (id.startsWith("mobile_sam/")) return "mobile_sam"
  if (id.startsWith("efficient_sam/")) return "efficient_sam"
  return null
}

function readModelByFamily(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MODEL_BY_FAMILY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

function writeModelByFamily(map: Record<string, string>): void {
  try {
    localStorage.setItem(MODEL_BY_FAMILY_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function getSamAnnotationFamily(): SamAnnotationFamily {
  try {
    const v = localStorage.getItem(FAMILY_KEY)?.trim()
    if (v === "sam2" || v === "mobile_sam" || v === "efficient_sam") return v
  } catch {
    // ignore
  }
  const legacy = getSamAnnotationModelId("sam2")
  const fromLegacy = legacy ? modelIdToSamFamily(legacy) : null
  if (fromLegacy) return fromLegacy
  return "sam2"
}

export function setSamAnnotationFamily(family: SamAnnotationFamily): void {
  try {
    localStorage.setItem(FAMILY_KEY, family)
  } catch {
    // ignore
  }
}

export function getSamAnnotationModelId(family: SamAnnotationFamily): string | null {
  const map = readModelByFamily()
  const hit = map[family]?.trim()
  if (hit) return hit
  if (family === "sam2") {
    try {
      const legacy = localStorage.getItem(LEGACY_SAM2_MODEL_KEY)?.trim()
      return legacy || null
    } catch {
      return null
    }
  }
  return null
}

export function setSamAnnotationModelId(family: SamAnnotationFamily, modelId: string): void {
  const mid = modelId.trim()
  if (!mid) return
  const map = readModelByFamily()
  map[family] = mid
  writeModelByFamily(map)
  if (family === "sam2") {
    try {
      localStorage.setItem(LEGACY_SAM2_MODEL_KEY, mid)
    } catch {
      // ignore
    }
  }
}

/** @deprecated 使用 getSamAnnotationModelId("sam2") */
export function getSam2AnnotationBackendModelId(): string | null {
  return getSamAnnotationModelId("sam2")
}

/** @deprecated 使用 setSamAnnotationModelId("sam2", modelId) */
export function setSam2AnnotationBackendModelId(modelId: string): void {
  setSamAnnotationModelId("sam2", modelId)
}

export function defaultModelIdForFamily(family: SamAnnotationFamily): string {
  if (family === "mobile_sam") return "mobile_sam/vit_t"
  if (family === "efficient_sam") return "efficient_sam/vitt"
  return "sam2/sam2.1_hiera_tiny"
}

export function pickSamModelIdForFamily(
  family: SamAnnotationFamily,
  validIds: Set<string>,
  activeModelId?: string | null,
): string {
  const saved = getSamAnnotationModelId(family)
  if (saved && validIds.has(saved)) return saved
  if (activeModelId && validIds.has(activeModelId)) return activeModelId
  const first = [...validIds][0]
  return first ?? defaultModelIdForFamily(family)
}

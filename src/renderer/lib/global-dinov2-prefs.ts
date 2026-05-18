/** 全局 DINOv2 runtime：后端模型管理页所选权重（localStorage）。 */

const GLOBAL_DINOV2_MODEL_KEY = "ea-global-dinov2-model-id"

export const DEFAULT_GLOBAL_DINOV2_MODEL_ID = "dinov2/dinov2_vits14_pretrain"

export function getGlobalDinov2ModelId(): string {
  try {
    const v = localStorage.getItem(GLOBAL_DINOV2_MODEL_KEY)?.trim()
    return v || DEFAULT_GLOBAL_DINOV2_MODEL_ID
  } catch {
    return DEFAULT_GLOBAL_DINOV2_MODEL_ID
  }
}

export function setGlobalDinov2ModelId(modelId: string): void {
  const mid = modelId.trim()
  if (!mid) return
  try {
    localStorage.setItem(GLOBAL_DINOV2_MODEL_KEY, mid)
  } catch {
    // ignore
  }
}

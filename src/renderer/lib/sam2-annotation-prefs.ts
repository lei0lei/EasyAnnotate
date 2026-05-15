const STORAGE_KEY = "ea-sam2-annotation-backend-model-id"

export function getSam2AnnotationBackendModelId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)?.trim()
    return v || null
  } catch {
    return null
  }
}

export function setSam2AnnotationBackendModelId(modelId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, modelId.trim())
  } catch {
    // ignore
  }
}

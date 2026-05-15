const STORAGE_KEY = "ea-sam2-ai-toolbar-enabled"
const CHANGE_EVENT = "ea-sam2-ai-toolbar-enabled-change"

function parseEnabled(raw: string | null): boolean {
  if (raw === null) return true
  const t = raw.trim().toLowerCase()
  return t === "1" || t === "true" || t === "yes"
}

/** 是否在任务页左侧 AI 工具栏显示 SAM2；未写入时默认开启 */
export function getSam2AiToolbarEnabled(): boolean {
  try {
    return parseEnabled(localStorage.getItem(STORAGE_KEY))
  } catch {
    return true
  }
}

export function setSam2AiToolbarEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0")
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // ignore
  }
}

export function getSam2AiToolbarEnabledSnapshot(): boolean {
  return getSam2AiToolbarEnabled()
}

export function subscribeSam2AiToolbarEnabled(onStoreChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onStoreChange()
  }
  const onLocal = () => onStoreChange()
  window.addEventListener("storage", onStorage)
  window.addEventListener(CHANGE_EVENT, onLocal)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener(CHANGE_EVENT, onLocal)
  }
}

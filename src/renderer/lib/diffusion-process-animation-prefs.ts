/**
 * 扩散式标注：任务页对话框「显示中间过程」开关（localStorage）。
 */

const STORAGE_KEY = "ea-diffusion-process-animation-enabled"
const CHANGE_EVENT = "ea-diffusion-process-animation-change"

function parseEnabled(raw: string | null): boolean {
  if (raw === null) return false
  const t = raw.trim().toLowerCase()
  return t === "1" || t === "true" || t === "yes"
}

export const diffusionProcessAnimationPrefs = {
  getEnabled(): boolean {
    try {
      return parseEnabled(localStorage.getItem(STORAGE_KEY))
    } catch {
      return false
    }
  },
  setEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0")
      window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch {
      // ignore
    }
  },
  subscribe(onChange: () => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) onChange()
    }
    const onLocal = () => onChange()
    window.addEventListener("storage", onStorage)
    window.addEventListener(CHANGE_EVENT, onLocal)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(CHANGE_EVENT, onLocal)
    }
  },
}

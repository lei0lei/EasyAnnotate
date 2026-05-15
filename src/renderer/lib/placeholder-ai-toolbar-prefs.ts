/**
 * 与 SAM2 类似：仅在「自动标注工具」中开启后，任务页左侧 AI 工具栏才显示对应占位入口。
 * 默认关闭，避免空工具占栏位。
 */

export type PlaceholderAiToolbarTool = "diffusion" | "tracking"

const LEGACY_DIFFUSION_STORAGE_KEY = "ea-ai-toolbar-generative-enabled"
const LEGACY_TRACKING_STORAGE_KEY = "ea-ai-toolbar-edge-cpu-enabled"

const CONFIG: Record<
  PlaceholderAiToolbarTool,
  { storageKey: string; changeEvent: string }
> = {
  diffusion: {
    storageKey: "ea-ai-toolbar-diffusion-enabled",
    changeEvent: "ea-ai-toolbar-diffusion-enabled-change",
  },
  tracking: {
    storageKey: "ea-ai-toolbar-tracking-enabled",
    changeEvent: "ea-ai-toolbar-tracking-enabled-change",
  },
}

function parseEnabled(raw: string | null): boolean {
  if (raw === null) return false
  const t = raw.trim().toLowerCase()
  return t === "1" || t === "true" || t === "yes"
}

type PrefsOptions = {
  /** 读取时若新 key 无值则迁移旧 key 的值 */
  legacyStorageKey?: string
}

function makePrefs(tool: PlaceholderAiToolbarTool, options?: PrefsOptions) {
  const { storageKey, changeEvent } = CONFIG[tool]
  const legacyStorageKey = options?.legacyStorageKey

  return {
    getEnabled(): boolean {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw !== null) return parseEnabled(raw)
        if (legacyStorageKey) {
          const leg = localStorage.getItem(legacyStorageKey)
          if (leg !== null) {
            localStorage.setItem(storageKey, leg)
            try {
              localStorage.removeItem(legacyStorageKey)
            } catch {
              // ignore
            }
            return parseEnabled(leg)
          }
        }
        return false
      } catch {
        return false
      }
    },
    setEnabled(enabled: boolean): void {
      try {
        localStorage.setItem(storageKey, enabled ? "1" : "0")
        window.dispatchEvent(new Event(changeEvent))
      } catch {
        // ignore
      }
    },
    subscribe(onChange: () => void): () => void {
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey || e.key === legacyStorageKey || e.key === null) onChange()
      }
      const onLocal = () => onChange()
      window.addEventListener("storage", onStorage)
      window.addEventListener(changeEvent, onLocal)
      return () => {
        window.removeEventListener("storage", onStorage)
        window.removeEventListener(changeEvent, onLocal)
      }
    },
  }
}

export const diffusionAiToolbarPrefs = makePrefs("diffusion", {
  legacyStorageKey: LEGACY_DIFFUSION_STORAGE_KEY,
})
export const trackingAiToolbarPrefs = makePrefs("tracking", {
  legacyStorageKey: LEGACY_TRACKING_STORAGE_KEY,
})

export type PlaceholderAiToolbarsSnapshot = {
  diffusion: boolean
  tracking: boolean
}

export function getPlaceholderAiToolbarsSnapshot(): PlaceholderAiToolbarsSnapshot {
  return {
    diffusion: diffusionAiToolbarPrefs.getEnabled(),
    tracking: trackingAiToolbarPrefs.getEnabled(),
  }
}

export function subscribeAllPlaceholderAiToolbars(onChange: () => void): () => void {
  const unsubs = [diffusionAiToolbarPrefs.subscribe(onChange), trackingAiToolbarPrefs.subscribe(onChange)]
  return () => {
    for (const u of unsubs) u()
  }
}

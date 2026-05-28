const STORAGE_KEY = "ea-annotation-appearance-v1"
const CHANGE_EVENT = "ea-annotation-appearance-change"

export type AnnotationAppearancePrefs = {
  lineWidthScale: number
  pointSizeScale: number
}

const DEFAULT_PREFS: AnnotationAppearancePrefs = {
  lineWidthScale: 1,
  pointSizeScale: 1,
}

let cachedPrefs: AnnotationAppearancePrefs = DEFAULT_PREFS

function clampScale(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(2.5, Math.max(0.5, n))
}

function normalizePrefs(raw: unknown): AnnotationAppearancePrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS
  const obj = raw as Record<string, unknown>
  return {
    lineWidthScale: clampScale(obj.lineWidthScale),
    pointSizeScale: clampScale(obj.pointSizeScale),
  }
}

function samePrefs(a: AnnotationAppearancePrefs, b: AnnotationAppearancePrefs): boolean {
  return a.lineWidthScale === b.lineWidthScale && a.pointSizeScale === b.pointSizeScale
}

function getCachedPrefs(): AnnotationAppearancePrefs {
  const next = readPrefs()
  if (!samePrefs(next, cachedPrefs)) cachedPrefs = next
  return cachedPrefs
}

function readPrefs(): AnnotationAppearancePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    return normalizePrefs(JSON.parse(raw))
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefs(next: AnnotationAppearancePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // ignore
  }
}

export const annotationAppearancePrefs = {
  defaults(): AnnotationAppearancePrefs {
    return DEFAULT_PREFS
  },
  get(): AnnotationAppearancePrefs {
    return getCachedPrefs()
  },
  set(patch: Partial<AnnotationAppearancePrefs>): void {
    const current = getCachedPrefs()
    const next: AnnotationAppearancePrefs = {
      lineWidthScale: clampScale(patch.lineWidthScale ?? current.lineWidthScale),
      pointSizeScale: clampScale(patch.pointSizeScale ?? current.pointSizeScale),
    }
    cachedPrefs = next
    writePrefs(next)
  },
  reset(): void {
    cachedPrefs = DEFAULT_PREFS
    writePrefs(DEFAULT_PREFS)
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


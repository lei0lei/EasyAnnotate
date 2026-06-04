export const AFTER_IMPORT_BOOTSTRAP_DELAY_MS = 300
export const DEFAULT_PROJECT_BOOTSTRAP_DELAY_MS = 100

export type ProjectDetailNavState = {
  afterImport?: boolean
  bootstrapDelayMs?: number
}

function sessionKey(projectId: string): string {
  return `ea-project-bootstrap:${projectId}`
}

/** 标注 ZIP 导入进行中/刚完成时标记，供手动返回项目页识别 */
export function markProjectBootstrapAfterImport(projectId: string): void {
  const trimmed = projectId.trim()
  if (!trimmed) return
  try {
    sessionStorage.setItem(sessionKey(trimmed), String(Date.now()))
  } catch {
    /* ignore */
  }
}

export function clearProjectBootstrapAfterImport(projectId: string): void {
  const trimmed = projectId.trim()
  if (!trimmed) return
  try {
    sessionStorage.removeItem(sessionKey(trimmed))
  } catch {
    /* ignore */
  }
}

export function resolveProjectBootstrapDelayMs(
  projectId: string,
  locationState: ProjectDetailNavState | null | undefined,
): number {
  if (typeof locationState?.bootstrapDelayMs === "number") {
    return Math.max(0, Math.floor(locationState.bootstrapDelayMs))
  }
  if (locationState?.afterImport) {
    return AFTER_IMPORT_BOOTSTRAP_DELAY_MS
  }
  const trimmed = projectId.trim()
  if (!trimmed) return DEFAULT_PROJECT_BOOTSTRAP_DELAY_MS
  try {
    const raw = sessionStorage.getItem(sessionKey(trimmed))
    if (raw) {
      sessionStorage.removeItem(sessionKey(trimmed))
      const at = Number(raw)
      if (Number.isFinite(at) && Date.now() - at < 5 * 60 * 1000) {
        return AFTER_IMPORT_BOOTSTRAP_DELAY_MS
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PROJECT_BOOTSTRAP_DELAY_MS
}

export function projectDetailNavStateAfterImport(): ProjectDetailNavState {
  return { afterImport: true, bootstrapDelayMs: AFTER_IMPORT_BOOTSTRAP_DELAY_MS }
}

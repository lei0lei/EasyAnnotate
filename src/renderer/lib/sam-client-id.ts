const SAM_CLIENT_ID_KEY = "ea-sam-client-id"

/** Stable per-install client id; backend allows one active SAM session per id. */
export function getSamClientId(): string {
  try {
    const existing = localStorage.getItem(SAM_CLIENT_ID_KEY)?.trim()
    if (existing) return existing
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sam-${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(SAM_CLIENT_ID_KEY, id)
    return id
  } catch {
    return `sam-fallback-${Date.now()}`
  }
}

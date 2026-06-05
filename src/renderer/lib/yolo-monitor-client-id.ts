const YOLO_MONITOR_CLIENT_ID_KEY = "ea-yolo-monitor-client-id"

/** Stable per-install client id for YOLO training monitor WebSocket. */
export function getYoloMonitorClientId(): string {
  try {
    const existing = localStorage.getItem(YOLO_MONITOR_CLIENT_ID_KEY)?.trim()
    if (existing) return existing
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `yolo-monitor-${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(YOLO_MONITOR_CLIENT_ID_KEY, id)
    return id
  } catch {
    return `yolo-monitor-fallback-${Date.now()}`
  }
}

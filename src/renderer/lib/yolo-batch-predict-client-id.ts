const YOLO_BATCH_PREDICT_CLIENT_ID_KEY = "ea-yolo-batch-predict-client-id"

/** Stable per-install client id for YOLO batch predict WebSocket. */
export function getYoloBatchPredictClientId(): string {
  try {
    const existing = localStorage.getItem(YOLO_BATCH_PREDICT_CLIENT_ID_KEY)?.trim()
    if (existing) return existing
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `yolo-batch-predict-${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(YOLO_BATCH_PREDICT_CLIENT_ID_KEY, id)
    return id
  } catch {
    return `yolo-batch-predict-fallback-${Date.now()}`
  }
}

/**
 * 基于 `localStorage` 的轻量 JSON 封装；日后可替换为同签名的 `ipc`/`fs` 实现，而不改各业务模块的调用方式。
 */
export function readLocalJson<T>(key: string, guard: (data: unknown) => data is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const data = JSON.parse(raw) as unknown
    if (!guard(data)) return fallback
    return data
  } catch {
    return fallback
  }
}

export function writeLocalJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / 隐私模式等 */
  }
}

import { STORAGE_KEYS } from "@/lib/storage/keys"

export type MonitorItem = {
  id: string
  name: string
  /** 关联工作流 id，空字符串表示不关联 */
  linkedWorkflowId: string
  updatedAt: string
}

function safeParse(raw: string | null): MonitorItem[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (item): item is MonitorItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as MonitorItem).id === "string" &&
        typeof (item as MonitorItem).name === "string" &&
        typeof (item as MonitorItem).linkedWorkflowId === "string" &&
        typeof (item as MonitorItem).updatedAt === "string",
    )
  } catch {
    return []
  }
}

export function loadMonitors(): MonitorItem[] {
  try {
    return safeParse(localStorage.getItem(STORAGE_KEYS.monitors))
  } catch {
    return []
  }
}

function persist(monitors: MonitorItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.monitors, JSON.stringify(monitors))
  } catch {
    /* ignore */
  }
}

export function getMonitor(id: string): MonitorItem | undefined {
  return loadMonitors().find((m) => m.id === id)
}

function nextDefaultName(): string {
  const monitors = loadMonitors()
  const prefix = "未命名监视"
  const used = monitors
    .map((m) => m.name)
    .filter((n) => n.startsWith(prefix))
    .map((n) => {
      const m = n.slice(prefix.length).trim()
      const num = parseInt(m, 10)
      return Number.isFinite(num) ? num : 0
    })
  const next = (used.length ? Math.max(0, ...used) : 0) + 1
  return `${prefix} ${next}`
}

export function createMonitorItem(): MonitorItem {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `mon-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return {
    id,
    name: nextDefaultName(),
    linkedWorkflowId: "",
    updatedAt: new Date().toISOString(),
  }
}

export function addMonitor(monitor: MonitorItem): void {
  persist([monitor, ...loadMonitors()])
}

export function removeMonitor(id: string): void {
  persist(loadMonitors().filter((m) => m.id !== id))
}

export function updateMonitor(
  id: string,
  patch: Partial<Pick<MonitorItem, "name" | "linkedWorkflowId">>,
): void {
  const list = loadMonitors()
  const i = list.findIndex((m) => m.id === id)
  if (i === -1) return
  const next = [...list]
  const cur = next[i]
  next[i] = {
    ...cur,
    ...patch,
    name: patch.name !== undefined ? patch.name : cur.name,
    linkedWorkflowId:
      patch.linkedWorkflowId !== undefined ? patch.linkedWorkflowId : cur.linkedWorkflowId,
    updatedAt: new Date().toISOString(),
  }
  persist(next)
}

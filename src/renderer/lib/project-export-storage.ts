import { getProjectExportVersionsFromDisk, saveProjectExportVersionsToDisk } from "@/lib/projects-api"
import { STORAGE_KEYS } from "@/lib/storage/keys"

export type ExportFormat = "coco" | "yolo-detect" | "yolo-obb" | "yolo-segment" | "yolo-pose" | "voc"

export type ExportPipelineStep = {
  id: string
  type: string
  config: string
}

export type ExportVersionScope =
  | { kind: "project" }
  | {
      kind: "task"
      taskId: string
    }

export type ExportVersionItem = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  status: "draft" | "ready"
  scope: ExportVersionScope
  trainBoundary: number
  valBoundary: number
  preprocessSteps: ExportPipelineStep[]
  augmentSteps: ExportPipelineStep[]
  exportFormat: ExportFormat
  keepProjectStructureEnabled: boolean
}

type ExportVersionDoc = {
  version: 1
  items: ExportVersionItem[]
}

const DEFAULT_EXPORT_DOC: ExportVersionDoc = {
  version: 1,
  items: [],
}

function legacyExportVersionsKey(projectId: string): string {
  return `${STORAGE_KEYS.exportVersionPrefix}:${projectId}`
}

/** 删除旧版 localStorage 中的导出版本键（迁移后或删除项目后） */
export function removeLegacyExportVersionsStorageKey(projectId: string): void {
  try {
    localStorage.removeItem(legacyExportVersionsKey(projectId))
  } catch {
    // ignore
  }
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null
}

function isExportFormat(data: unknown): data is ExportFormat {
  return (
    data === "coco" ||
    data === "yolo-detect" ||
    data === "yolo-obb" ||
    data === "yolo-segment" ||
    data === "yolo-pose" ||
    data === "voc"
  )
}

function isPipelineStep(data: unknown): data is ExportPipelineStep {
  if (!isRecord(data)) return false
  return typeof data.id === "string" && typeof data.type === "string" && typeof data.config === "string"
}

function isVersionScope(data: unknown): data is ExportVersionScope {
  if (!isRecord(data)) return false
  if (data.kind === "project") return true
  return data.kind === "task" && typeof data.taskId === "string"
}

function isExportVersionItem(data: unknown): data is ExportVersionItem {
  if (!isRecord(data)) return false
  if (typeof data.id !== "string") return false
  if (typeof data.name !== "string") return false
  if (typeof data.createdAt !== "string") return false
  if (typeof data.updatedAt !== "string") return false
  if (data.status !== "draft" && data.status !== "ready") return false
  if (!isVersionScope(data.scope)) return false
  if (typeof data.trainBoundary !== "number" || !Number.isFinite(data.trainBoundary)) return false
  if (typeof data.valBoundary !== "number" || !Number.isFinite(data.valBoundary)) return false
  if (!Array.isArray(data.preprocessSteps) || !data.preprocessSteps.every(isPipelineStep)) return false
  if (!Array.isArray(data.augmentSteps) || !data.augmentSteps.every(isPipelineStep)) return false
  if (!isExportFormat(data.exportFormat)) return false
  if (typeof data.keepProjectStructureEnabled !== "boolean") return false
  return true
}

function isExportVersionDoc(data: unknown): data is ExportVersionDoc {
  if (!isRecord(data)) return false
  if (data.version !== 1) return false
  if (!Array.isArray(data.items)) return false
  return data.items.every(isExportVersionItem)
}

function normalizeBoundary(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeItem(item: ExportVersionItem): ExportVersionItem {
  const trainBoundary = normalizeBoundary(item.trainBoundary)
  const valBoundary = normalizeBoundary(item.valBoundary)
  const minGap = 5
  const normalizedTrain = Math.min(trainBoundary, Math.max(0, valBoundary - minGap))
  const normalizedVal = Math.max(valBoundary, Math.min(100, normalizedTrain + minGap))
  return {
    ...item,
    name: item.name.trim() || "Untitled Version",
    trainBoundary: normalizedTrain,
    valBoundary: normalizedVal,
    preprocessSteps: item.preprocessSteps.map((step) => ({
      id: step.id,
      type: step.type.trim(),
      config: step.config.trim(),
    })),
    augmentSteps: item.augmentSteps.map((step) => ({
      id: step.id,
      type: step.type.trim(),
      config: step.config.trim(),
    })),
  }
}

async function tryMigrateLegacyExportVersionsFromLocalStorage(projectId: string): Promise<string | null> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(legacyExportVersionsKey(projectId))
  } catch {
    return null
  }
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isExportVersionDoc(parsed)) return null
    const text = JSON.stringify(parsed)
    const { errorMessage } = await saveProjectExportVersionsToDisk(projectId, text)
    if (errorMessage) return null
    removeLegacyExportVersionsStorageKey(projectId)
    return text
  } catch {
    return null
  }
}

export async function loadProjectExportVersions(projectId: string): Promise<ExportVersionItem[]> {
  const fromDisk = await getProjectExportVersionsFromDisk(projectId)
  if (fromDisk.errorMessage) {
    return DEFAULT_EXPORT_DOC.items.map(normalizeItem)
  }
  let text = (fromDisk.jsonText || "").trim()
  if (!text) {
    const migrated = await tryMigrateLegacyExportVersionsFromLocalStorage(projectId)
    if (migrated) {
      text = migrated.trim()
    }
  }
  if (!text) {
    return DEFAULT_EXPORT_DOC.items.map(normalizeItem)
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isExportVersionDoc(parsed)) {
      return DEFAULT_EXPORT_DOC.items.map(normalizeItem)
    }
    return parsed.items.map(normalizeItem)
  } catch {
    return DEFAULT_EXPORT_DOC.items.map(normalizeItem)
  }
}

export async function saveProjectExportVersions(
  projectId: string,
  items: ExportVersionItem[],
): Promise<{ errorMessage: string }> {
  const next: ExportVersionDoc = {
    version: 1,
    items: items.map(normalizeItem),
  }
  return saveProjectExportVersionsToDisk(projectId, JSON.stringify(next))
}

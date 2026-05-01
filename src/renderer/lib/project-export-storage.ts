import { STORAGE_KEYS } from "@/lib/storage/keys"
import { readLocalJson, writeLocalJson } from "@/lib/storage/json-local"

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

function projectExportKey(projectId: string): string {
  return `${STORAGE_KEYS.exportVersionPrefix}:${projectId}`
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

export function loadProjectExportVersions(projectId: string): ExportVersionItem[] {
  const doc = readLocalJson<ExportVersionDoc>(projectExportKey(projectId), isExportVersionDoc, DEFAULT_EXPORT_DOC)
  return doc.items.map(normalizeItem)
}

export function saveProjectExportVersions(projectId: string, items: ExportVersionItem[]): void {
  const next: ExportVersionDoc = {
    version: 1,
    items: items.map(normalizeItem),
  }
  writeLocalJson(projectExportKey(projectId), next)
}


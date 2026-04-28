import { ipc } from "@/gen/ipc"

export type AnnotationProject = {
  id: string
  name: string
  rootDir: string
  createdAt: string
  updatedAt: string
}

export type AnnotationRecord = {
  id: string
  projectId: string
  imagePath: string
  label: string
  bbox?: {
    x: number
    y: number
    w: number
    h: number
  }
  meta?: Record<string, string | number | boolean | null>
  updatedAt: string
}

function getStorageScope(): string {
  return ""
}

function parseJsonObject(json: string): Record<string, string | number | boolean | null> | undefined {
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return parsed as Record<string, string | number | boolean | null>
  } catch {
    return undefined
  }
}

function parseBbox(json: string): AnnotationRecord["bbox"] {
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as unknown
    if (typeof parsed !== "object" || parsed === null) return undefined
    const bbox = parsed as { x?: number; y?: number; w?: number; h?: number }
    if (
      typeof bbox.x !== "number" ||
      typeof bbox.y !== "number" ||
      typeof bbox.w !== "number" ||
      typeof bbox.h !== "number"
    ) {
      return undefined
    }
    return { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }
  } catch {
    return undefined
  }
}

export async function listAnnotationProjects(): Promise<AnnotationProject[]> {
  const response = await ipc.app.ListAnnotationProjects({ databaseDir: getStorageScope() })
  return response.projects.map((item) => ({
    id: item.id,
    name: item.name,
    rootDir: item.rootDir,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))
}

export async function upsertAnnotationProject(
  project: Pick<AnnotationProject, "id" | "name" | "rootDir">,
): Promise<AnnotationProject> {
  const now = new Date().toISOString()
  const payload: AnnotationProject = {
    ...project,
    createdAt: now,
    updatedAt: now,
  }
  await ipc.app.UpsertAnnotationProject({
    databaseDir: getStorageScope(),
    project: payload,
  })
  return payload
}

export async function deleteAnnotationProject(id: string): Promise<void> {
  await ipc.app.DeleteAnnotationProject({
    databaseDir: getStorageScope(),
    id,
  })
}

export async function listAnnotationsByProject(projectId: string): Promise<AnnotationRecord[]> {
  const response = await ipc.app.ListAnnotationsByProject({
    databaseDir: getStorageScope(),
    projectId,
  })
  return response.annotations.map((item) => ({
    id: item.id,
    projectId: item.projectId,
    imagePath: item.imagePath,
    label: item.label,
    bbox: parseBbox(item.bboxJson),
    meta: parseJsonObject(item.metaJson),
    updatedAt: item.updatedAt,
  }))
}

export async function upsertAnnotation(record: AnnotationRecord): Promise<void> {
  const payload = {
    ...record,
    updatedAt: new Date().toISOString(),
    bboxJson: record.bbox ? JSON.stringify(record.bbox) : "",
    metaJson: record.meta ? JSON.stringify(record.meta) : "",
  }
  await ipc.app.UpsertAnnotation({
    databaseDir: getStorageScope(),
    annotation: payload,
  })
}

export async function deleteAnnotation(id: string): Promise<void> {
  await ipc.app.DeleteAnnotation({
    databaseDir: getStorageScope(),
    id,
  })
}

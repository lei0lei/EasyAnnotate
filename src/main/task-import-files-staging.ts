import { randomUUID } from "node:crypto"
import fs from "node:fs"
import type { AnnotatedFilesImportRequest } from "./annotated-task-import-core.js"
import {
  startAnnotatedTaskFilesImportJob,
  type AnnotatedImportJobRecord,
} from "./task-import.js"

const TASK_FILES_IMPORT_LIMIT = 500
const STAGING_TTL_MS = 30 * 60 * 1000

type FilesImportStaging = {
  globalConfigDir: string
  projectId: string
  taskId: string
  subset: string
  importFormat: string
  imagePaths: string[]
  labelPathSet: Set<string>
  yoloClassPathSet: Set<string>
  createdAt: number
}

const filesImportStaging = new Map<string, FilesImportStaging>()

function pruneExpiredStaging(): void {
  const now = Date.now()
  for (const [id, staging] of filesImportStaging) {
    if (now - staging.createdAt > STAGING_TTL_MS) {
      filesImportStaging.delete(id)
    }
  }
}

export function beginAnnotatedTaskFilesImportStaging(args: {
  globalConfigDir: string
  projectId: string
  taskId: string
  subset: string
  importFormat: string
}): { stagingId: string; errorMessage: string } {
  pruneExpiredStaging()
  const projectId = args.projectId.trim()
  const taskId = args.taskId.trim()
  if (!projectId || !taskId) {
    return { stagingId: "", errorMessage: "缺少 projectId 或 taskId。" }
  }
  const stagingId = randomUUID()
  filesImportStaging.set(stagingId, {
    globalConfigDir: args.globalConfigDir,
    projectId,
    taskId,
    subset: args.subset,
    importFormat: args.importFormat,
    imagePaths: [],
    labelPathSet: new Set<string>(),
    yoloClassPathSet: new Set<string>(),
    createdAt: Date.now(),
  })
  return { stagingId, errorMessage: "" }
}

export function stageAnnotatedTaskFilesImportPaths(args: {
  stagingId: string
  imagePaths: string[]
  labelPaths: string[]
  yoloClassPaths: string[]
}): { errorMessage: string } {
  pruneExpiredStaging()
  const stagingId = args.stagingId.trim()
  const staging = filesImportStaging.get(stagingId)
  if (!staging) {
    return { errorMessage: "导入暂存已过期或不存在，请重新提交。" }
  }

  for (const raw of args.imagePaths ?? []) {
    const trimmed = raw.trim()
    if (trimmed) staging.imagePaths.push(trimmed)
  }
  for (const raw of args.labelPaths ?? []) {
    const trimmed = raw.trim()
    if (trimmed) staging.labelPathSet.add(trimmed)
  }
  for (const raw of args.yoloClassPaths ?? []) {
    const trimmed = raw.trim()
    if (trimmed) staging.yoloClassPathSet.add(trimmed)
  }

  if (staging.imagePaths.length > TASK_FILES_IMPORT_LIMIT) {
    filesImportStaging.delete(stagingId)
    return {
      errorMessage: `单次最多上传 ${TASK_FILES_IMPORT_LIMIT} 张图片（当前 ${staging.imagePaths.length} 张）。`,
    }
  }

  return { errorMessage: "" }
}

export function commitAnnotatedTaskFilesImportStaging(stagingId: string): {
  jobId: string
  errorMessage: string
  job: AnnotatedImportJobRecord | null
} {
  pruneExpiredStaging()
  const trimmed = stagingId.trim()
  const staging = filesImportStaging.get(trimmed)
  if (!staging) {
    return { jobId: "", errorMessage: "导入暂存已过期或不存在，请重新提交。", job: null }
  }
  filesImportStaging.delete(trimmed)

  if (staging.imagePaths.length <= 0) {
    return { jobId: "", errorMessage: "未选择有效图片文件。", job: null }
  }

  const filesReq: AnnotatedFilesImportRequest = {
    globalConfigDir: staging.globalConfigDir,
    projectId: staging.projectId,
    taskId: staging.taskId,
    subset: staging.subset,
    importFormat: staging.importFormat,
    imagePaths: [...staging.imagePaths],
    labelPaths: [...staging.labelPathSet],
    yoloClassPaths: [...staging.yoloClassPathSet],
  }

  return startAnnotatedTaskFilesImportJob(filesReq)
}

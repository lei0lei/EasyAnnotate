/**
 * 主进程：删除项目标注 JSON 中属于已移除标签的 shapes。
 * 清理与项目保存在主进程后台按批执行，renderer 仅轮询进度。
 */
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { getDefaultGlobalConfigDir } from "./app-config-disk"
import { protoProjectTagsToRecords } from "./project-tag-ipc"
import { updateProject, type ProjectTagRecord } from "./project-storage"
import { resolveTaskRootDir } from "./task-image-paths"
import type { ProjectTag } from "./gen/app"

export const TAG_ANNOTATION_CLEANUP_BATCH_SIZE = 10
const MAX_ANNOTATION_JSON_BYTES = 24 * 1024 * 1024
const MAX_IMAGE_DATA_CHARS = 256 * 1024

type TagAnnotationCleanupSession = {
  jsonPaths: string[]
  deleted: Set<string>
  offset: number
  total: number
  cancelled: boolean
  running: boolean
  finished: boolean
  failed: boolean
  updatedFileCount: number
  message: string
  errorMessage: string
  projectSaved: boolean
  projectSave?: {
    globalConfigDir: string
    projectId: string
    name: string
    projectInfo: string
    tags: ProjectTagRecord[]
  }
}

const tagAnnotationCleanupSessions = new Map<string, TagAnnotationCleanupSession>()

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function collectTaskAnnotationJsonPaths(taskRootDir: string): string[] {
  const root = taskRootDir.trim()
  if (!root || !fs.existsSync(root)) return []

  const jsonPaths: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(absPath)
        continue
      }
      if (path.extname(entry.name).toLowerCase() === ".json") {
        jsonPaths.push(absPath)
      }
    }
  }
  return jsonPaths
}

function collectProjectAnnotationJsonPaths(args: {
  globalConfigDir: string
  projectId: string
  taskIds: string[]
}): { errorMessage: string; jsonPaths: string[] } {
  const projectId = args.projectId.trim()
  if (!projectId) {
    return { errorMessage: "项目 ID 为空。", jsonPaths: [] }
  }

  const globalConfigDir = args.globalConfigDir.trim() || getDefaultGlobalConfigDir()
  const taskIds = [...new Set(args.taskIds.map((id) => id.trim()).filter(Boolean))]
  const jsonPaths: string[] = []

  for (const taskId of taskIds) {
    const resolved = resolveTaskRootDir(globalConfigDir, projectId, taskId)
    if (resolved.errorMessage) {
      return { errorMessage: resolved.errorMessage, jsonPaths: [] }
    }
    jsonPaths.push(...collectTaskAnnotationJsonPaths(resolved.taskRootDir))
  }

  return { errorMessage: "", jsonPaths }
}

/** 从标注 JSON 文本中移除指定 label 的 shapes，保留其余字段不变。 */
export function stripDeletedLabelsFromJsonText(
  rawJsonText: string,
  deleted: Set<string>,
): { changed: boolean; nextJsonText: string } {
  if (!rawJsonText.trim() || deleted.size === 0) {
    return { changed: false, nextJsonText: rawJsonText }
  }
  try {
    const parsed = JSON.parse(rawJsonText) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { changed: false, nextJsonText: rawJsonText }
    }
    const record = parsed as Record<string, unknown>
    const shapes = record.shapes
    if (!Array.isArray(shapes)) {
      return { changed: false, nextJsonText: rawJsonText }
    }
    const nextShapes = shapes.filter((shape) => {
      if (!shape || typeof shape !== "object" || Array.isArray(shape)) return true
      const label = (shape as { label?: unknown }).label
      return typeof label !== "string" || !deleted.has(label)
    })
    if (nextShapes.length === shapes.length) {
      return { changed: false, nextJsonText: rawJsonText }
    }
    if (typeof record.imageData === "string" && record.imageData.length > MAX_IMAGE_DATA_CHARS) {
      record.imageData = null
    }
    record.shapes = nextShapes
    return {
      changed: true,
      nextJsonText: JSON.stringify(record, null, 2),
    }
  } catch {
    return { changed: false, nextJsonText: rawJsonText }
  }
}

function stripDeletedLabelsFromJsonFile(
  jsonPath: string,
  deleted: Set<string>,
): { changed: boolean; errorMessage: string } {
  try {
    const stat = fs.statSync(jsonPath)
    if (!stat.isFile()) {
      return { changed: false, errorMessage: "标注路径不是文件。" }
    }
    if (stat.size > MAX_ANNOTATION_JSON_BYTES) {
      return { changed: false, errorMessage: `标注文件过大：${jsonPath}` }
    }
    const rawJsonText = fs.readFileSync(jsonPath, "utf8")
    if (!rawJsonText.trim()) {
      return { changed: false, errorMessage: "" }
    }
    const stripped = stripDeletedLabelsFromJsonText(rawJsonText, deleted)
    if (!stripped.changed) {
      return { changed: false, errorMessage: "" }
    }
    fs.writeFileSync(jsonPath, stripped.nextJsonText, "utf8")
    return { changed: true, errorMessage: "" }
  } catch (error) {
    return {
      changed: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

export function countProjectAnnotationJsonFiles(args: {
  globalConfigDir: string
  projectId: string
  taskIds: string[]
}): { errorMessage: string; totalCount: number } {
  const collected = collectProjectAnnotationJsonPaths(args)
  return {
    errorMessage: collected.errorMessage,
    totalCount: collected.jsonPaths.length,
  }
}

function processOneBatch(session: TagAnnotationCleanupSession): { errorMessage: string } {
  for (let i = 0; i < TAG_ANNOTATION_CLEANUP_BATCH_SIZE && session.offset < session.total; i += 1) {
    const jsonPath = session.jsonPaths[session.offset]!
    session.offset += 1
    const result = stripDeletedLabelsFromJsonFile(jsonPath, session.deleted)
    if (result.errorMessage) {
      return { errorMessage: result.errorMessage }
    }
    if (result.changed) session.updatedFileCount += 1
  }
  return { errorMessage: "" }
}

async function runTagAnnotationCleanupSessionAsync(sessionId: string): Promise<void> {
  const session = tagAnnotationCleanupSessions.get(sessionId)
  if (!session || session.running) return

  session.running = true
  session.message = session.total > 0 ? `准备清理 ${session.total} 个标注文件…` : "未找到标注文件，正在保存项目…"

  try {
    while (session.offset < session.total) {
      if (session.cancelled) {
        session.finished = true
        session.message = "已取消"
        return
      }

      const batchNo = Math.ceil(session.offset / TAG_ANNOTATION_CLEANUP_BATCH_SIZE) + 1
      const batchTotal = Math.max(1, Math.ceil(session.total / TAG_ANNOTATION_CLEANUP_BATCH_SIZE))
      session.message = `正在处理第 ${batchNo}/${batchTotal} 批…`

      const batch = processOneBatch(session)
      if (batch.errorMessage) {
        session.failed = true
        session.errorMessage = batch.errorMessage
        session.message = batch.errorMessage
        return
      }

      session.message = `已处理 ${session.offset}/${session.total} 个标注文件`
      await yieldToEventLoop()
    }

    if (session.projectSave) {
      session.message = "正在保存项目…"
      await yieldToEventLoop()
      const saved = updateProject({
        globalConfigDir: session.projectSave.globalConfigDir,
        id: session.projectSave.projectId,
        name: session.projectSave.name,
        projectInfo: session.projectSave.projectInfo,
        tags: session.projectSave.tags,
      })
      if (!saved) {
        session.failed = true
        session.errorMessage = "保存项目失败：项目不存在。"
        session.message = session.errorMessage
        return
      }
      session.projectSaved = true
    }

    session.finished = true
    session.message = "完成"
  } catch (error) {
    session.failed = true
    session.errorMessage = error instanceof Error ? error.message : String(error)
    session.message = session.errorMessage
  } finally {
    session.running = false
  }
}

export function startTagAnnotationCleanupSession(args: {
  globalConfigDir: string
  projectId: string
  taskIds: string[]
  deletedLabels: string[]
  projectName: string
  projectInfo: string
  tags: ProjectTag[]
}): { errorMessage: string; sessionId: string; totalCount: number } {
  const deleted = new Set(args.deletedLabels.map((l) => l.trim()).filter(Boolean))
  if (deleted.size === 0) {
    return { errorMessage: "没有需要清理的标签。", sessionId: "", totalCount: 0 }
  }

  const projectId = args.projectId.trim()
  if (!projectId) {
    return { errorMessage: "项目 ID 为空。", sessionId: "", totalCount: 0 }
  }

  const collected = collectProjectAnnotationJsonPaths({
    globalConfigDir: args.globalConfigDir,
    projectId,
    taskIds: args.taskIds,
  })
  if (collected.errorMessage) {
    return { errorMessage: collected.errorMessage, sessionId: "", totalCount: 0 }
  }

  const globalConfigDir = args.globalConfigDir.trim() || getDefaultGlobalConfigDir()
  const shouldSaveProject =
    Boolean(args.projectName.trim() || args.projectInfo.trim() || args.tags.length > 0)
  const sessionId = randomUUID()
  tagAnnotationCleanupSessions.set(sessionId, {
    jsonPaths: collected.jsonPaths,
    deleted,
    offset: 0,
    total: collected.jsonPaths.length,
    cancelled: false,
    running: false,
    finished: false,
    failed: false,
    updatedFileCount: 0,
    message: "",
    errorMessage: "",
    projectSaved: false,
    projectSave: shouldSaveProject
      ? {
          globalConfigDir,
          projectId,
          name: args.projectName.trim(),
          projectInfo: args.projectInfo.trim(),
          tags: protoProjectTagsToRecords(args.tags),
        }
      : undefined,
  })

  void runTagAnnotationCleanupSessionAsync(sessionId)
  return { errorMessage: "", sessionId, totalCount: collected.jsonPaths.length }
}

export function getTagAnnotationCleanupSessionStatus(sessionId: string): {
  found: boolean
  finished: boolean
  failed: boolean
  cancelled: boolean
  done: number
  total: number
  progress: number
  message: string
  updatedFileCount: number
  errorMessage: string
  projectSaved: boolean
} {
  const session = tagAnnotationCleanupSessions.get(sessionId.trim())
  if (!session) {
    return {
      found: false,
      finished: true,
      failed: false,
      cancelled: false,
      done: 0,
      total: 0,
      progress: 0,
      message: "",
      updatedFileCount: 0,
      errorMessage: "",
      projectSaved: false,
    }
  }

  const done = session.offset
  const total = session.total
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : session.finished ? 100 : 0

  return {
    found: true,
    finished: session.finished,
    failed: session.failed,
    cancelled: session.cancelled,
    done,
    total,
    progress: session.finished && session.projectSaved ? 100 : progress,
    message: session.message,
    updatedFileCount: session.updatedFileCount,
    errorMessage: session.errorMessage,
    projectSaved: session.projectSaved,
  }
}

export function cancelTagAnnotationCleanupSession(sessionId: string): { errorMessage: string } {
  const id = sessionId.trim()
  const session = tagAnnotationCleanupSessions.get(id)
  if (!session) {
    return { errorMessage: "" }
  }
  session.cancelled = true
  return { errorMessage: "" }
}

export function disposeTagAnnotationCleanupSession(sessionId: string): { errorMessage: string } {
  tagAnnotationCleanupSessions.delete(sessionId.trim())
  return { errorMessage: "" }
}

/** @deprecated 使用 StartTagAnnotationCleanupSession + GetTagAnnotationCleanupSessionStatus */
export async function removeDeletedLabelsFromProjectAnnotations(args: {
  globalConfigDir: string
  projectId: string
  taskIds: string[]
  deletedLabels: string[]
}): Promise<{ errorMessage: string; updatedFileCount: number }> {
  const started = startTagAnnotationCleanupSession({
    ...args,
    projectName: "",
    projectInfo: "",
    tags: [],
  })
  if (started.errorMessage) {
    return { errorMessage: started.errorMessage, updatedFileCount: 0 }
  }
  if (!started.sessionId) {
    return { errorMessage: "", updatedFileCount: 0 }
  }

  const deadline = Date.now() + 60 * 60 * 1000
  while (Date.now() < deadline) {
    const status = getTagAnnotationCleanupSessionStatus(started.sessionId)
    if (!status.found) {
      disposeTagAnnotationCleanupSession(started.sessionId)
      return { errorMessage: "清理会话不存在。", updatedFileCount: 0 }
    }
    if (status.finished || status.failed || status.cancelled) {
      disposeTagAnnotationCleanupSession(started.sessionId)
      return {
        errorMessage: status.errorMessage,
        updatedFileCount: status.updatedFileCount,
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
  }

  return { errorMessage: "清理超时。", updatedFileCount: 0 }
}

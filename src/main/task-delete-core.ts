import fs from "node:fs"
import path from "node:path"
import { deleteTaskArtifacts } from "./annotation-sqlite"

export type TaskDeleteRequest = {
  globalConfigDir: string
  databaseDir: string
  projectId: string
  taskId: string
  taskRootDir: string
}

export type TaskDeleteProgressPatch = {
  progress: number
  statusMessage: string
  deletedFileCount: number
  totalFileCount: number
}

const DELETE_BATCH_SIZE = 50

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function walkFilesRecursiveAsync(rootDir: string): Promise<string[]> {
  if (!fs.existsSync(rootDir)) return []
  const out: string[] = []
  const stack = [rootDir]
  let scannedDirs = 0
  while (stack.length > 0) {
    const dir = stack.pop()!
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const ent of entries) {
      const absPath = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(absPath)
        continue
      }
      if (ent.isFile()) out.push(absPath)
    }
    scannedDirs += 1
    if (scannedDirs % 32 === 0) await yieldToEventLoop()
  }
  return out
}

export async function runTaskDelete(
  req: TaskDeleteRequest,
  onProgress?: (patch: TaskDeleteProgressPatch) => void,
): Promise<{ errorMessage: string; deletedFileCount: number }> {
  const taskRootDir = path.resolve(req.taskRootDir || "")
  if (!taskRootDir) {
    return { errorMessage: "任务目录无效。", deletedFileCount: 0 }
  }

  if (!fs.existsSync(taskRootDir)) {
    onProgress?.({
      progress: 98,
      statusMessage: "任务目录不存在，正在清理索引…",
      deletedFileCount: 0,
      totalFileCount: 0,
    })
    try {
      await deleteTaskArtifacts(req.databaseDir, req.projectId, req.taskId)
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : String(error),
        deletedFileCount: 0,
      }
    }
    onProgress?.({
      progress: 100,
      statusMessage: "删除完成",
      deletedFileCount: 0,
      totalFileCount: 0,
    })
    return { errorMessage: "", deletedFileCount: 0 }
  }

  onProgress?.({
    progress: 1,
    statusMessage: "正在扫描任务文件…",
    deletedFileCount: 0,
    totalFileCount: 0,
  })

  const files = await walkFilesRecursiveAsync(taskRootDir)
  const total = files.length

  onProgress?.({
    progress: 5,
    statusMessage: total > 0 ? `共 ${total} 个文件，开始分批删除…` : "正在清理目录…",
    deletedFileCount: 0,
    totalFileCount: total,
  })

  let deleted = 0
  for (let i = 0; i < files.length; i += DELETE_BATCH_SIZE) {
    const batch = files.slice(i, i + DELETE_BATCH_SIZE)
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          await fs.promises.rm(filePath, { force: true })
        } catch {
          /* ignore per-file failures */
        }
      }),
    )
    deleted += batch.length
    const progress = total > 0 ? Math.min(95, 5 + Math.floor((deleted / total) * 90)) : 90
    onProgress?.({
      progress,
      statusMessage: total > 0 ? `正在删除文件 ${deleted}/${total}…` : "正在清理目录…",
      deletedFileCount: deleted,
      totalFileCount: total,
    })
    await yieldToEventLoop()
  }

  onProgress?.({
    progress: 96,
    statusMessage: "正在清理目录…",
    deletedFileCount: deleted,
    totalFileCount: total,
  })

  try {
    await fs.promises.rm(taskRootDir, { recursive: true, force: true })
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
      deletedFileCount: deleted,
    }
  }

  onProgress?.({
    progress: 98,
    statusMessage: "正在清理索引…",
    deletedFileCount: deleted,
    totalFileCount: total,
  })

  try {
    await deleteTaskArtifacts(req.databaseDir, req.projectId, req.taskId)
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
      deletedFileCount: deleted,
    }
  }

  onProgress?.({
    progress: 100,
    statusMessage: total > 0 ? `已删除 ${deleted} 个文件` : "删除完成",
    deletedFileCount: deleted,
    totalFileCount: total,
  })

  return { errorMessage: "", deletedFileCount: deleted }
}

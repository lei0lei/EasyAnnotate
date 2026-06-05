/**
 * 任务目录内图片路径解析（主进程 / 自动标注子进程共用）。
 * 单次 walk，只收集图片扩展名，不做全项目搜索。
 */
import fs from "node:fs"
import path from "node:path"
import { getDefaultGlobalConfigDir } from "./app-config-disk"
import { getProject } from "./project-storage"

export const TASK_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
])

function sanitizeSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

export function isTaskImagePath(filePath: string): boolean {
  const ext = path.extname(filePath.trim()).toLowerCase()
  return TASK_IMAGE_EXTENSIONS.has(ext)
}

export function resolveTaskRootDir(
  globalConfigDir: string,
  projectId: string,
  taskId: string,
): { taskRootDir: string; errorMessage: string } {
  const configDir = globalConfigDir.trim() || getDefaultGlobalConfigDir()
  const project = getProject(configDir, projectId.trim())
  if (!project) {
    return { taskRootDir: "", errorMessage: "项目不存在。" }
  }
  const baseRoot =
    project.storageType === "local" && project.localPath
      ? project.localPath
      : path.dirname(project.configFilePath)
  return {
    taskRootDir: path.join(baseRoot, "data", "tasks", sanitizeSegment(taskId)),
    errorMessage: "",
  }
}

/** 遍历任务根目录，返回图片路径与非图片文件数量。 */
export function collectTaskImageListing(taskRootDir: string): {
  imagePaths: string[]
  nonImageFileCount: number
} {
  const root = taskRootDir.trim()
  if (!root || !fs.existsSync(root)) {
    return { imagePaths: [], nonImageFileCount: 0 }
  }

  const imagePaths: string[] = []
  let nonImageFileCount = 0
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
      if (isTaskImagePath(absPath)) {
        imagePaths.push(absPath)
      } else {
        nonImageFileCount += 1
      }
    }
  }
  return { imagePaths, nonImageFileCount }
}

/** @deprecated 使用 collectTaskImageListing */
export function collectTaskImagePaths(taskRootDir: string): string[] {
  return collectTaskImageListing(taskRootDir).imagePaths
}

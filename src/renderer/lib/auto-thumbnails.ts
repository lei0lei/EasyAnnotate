import { listTaskFiles, readImageFile } from "@/lib/projects-api"
import { loadTasks, type TaskItem } from "@/lib/project-tasks-storage"

export function guessImageMimeType(path: string): string {
  const normalized = path.trim().toLowerCase()
  if (normalized.endsWith(".png")) return "image/png"
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg"
  if (normalized.endsWith(".webp")) return "image/webp"
  if (normalized.endsWith(".bmp")) return "image/bmp"
  if (normalized.endsWith(".gif")) return "image/gif"
  if (normalized.endsWith(".tif") || normalized.endsWith(".tiff")) return "image/tiff"
  return "application/octet-stream"
}

/** 与项目页默认任务列表顺序一致（最近更新在前）。 */
export function pickFirstTaskForThumbnail(tasks: TaskItem[]): TaskItem | null {
  return tasks.find((task) => (task.fileCount ?? 0) > 0) ?? null
}

/** 只取任务目录中遇到的第一张图片（limit=1，找到即停，不扫全量）。 */
export async function resolveTaskFirstImagePath(
  projectId: string,
  task: Pick<TaskItem, "id" | "fileCount">,
): Promise<string> {
  if ((task.fileCount ?? 0) <= 0) return ""
  const page = await listTaskFiles({
    projectId,
    taskId: task.id,
    offset: 0,
    limit: 1,
  })
  if (page.errorMessage) return ""
  return page.files[0]?.filePath?.trim() ?? ""
}

/** 项目缩略图：第一个有图片的任务的第一张图。 */
export async function resolveProjectFirstImagePath(projectId: string, tasks?: TaskItem[]): Promise<string> {
  const list = tasks ?? (await loadTasks(projectId))
  const firstTask = pickFirstTaskForThumbnail(list)
  if (!firstTask) return ""
  return resolveTaskFirstImagePath(projectId, firstTask)
}

export async function loadImageObjectUrl(imagePath: string): Promise<string | null> {
  const trimmed = imagePath.trim()
  if (!trimmed) return null
  try {
    const imageResult = await readImageFile(trimmed)
    if (imageResult.errorMessage || !imageResult.content || imageResult.content.length === 0) return null
    const bytes = imageResult.content
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return URL.createObjectURL(new Blob([buffer], { type: guessImageMimeType(trimmed) }))
  } catch {
    return null
  }
}

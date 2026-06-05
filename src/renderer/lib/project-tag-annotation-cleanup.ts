import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import type { TaskItem } from "@/lib/project-tasks-storage"

/** 从上一版标签列表相对当前列表，得到被移除的标签名（trim 后、去重顺序保留）。 */
export function removedTagNamesSince(previous: { name: string }[], next: { name: string }[]): string[] {
  const nextNames = new Set(next.map((t) => t.name.trim()).filter(Boolean))
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of previous) {
    const n = t.name.trim()
    if (!n || nextNames.has(n) || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * 遍历项目下所有任务的图片标注 JSON，删除 label 属于 deletedLabels 的 shape。
 * 主进程在任务目录内 walk，不经 renderer 传路径列表。
 */
export async function removeShapesWithDeletedLabelsFromProject(options: {
  projectId: string
  tasks: TaskItem[]
  deletedLabels: Set<string>
}): Promise<{ errorMessage: string; updatedFileCount: number }> {
  if (options.deletedLabels.size === 0) {
    return { errorMessage: "", updatedFileCount: 0 }
  }

  const projectId = options.projectId.trim()
  if (!projectId) {
    return { errorMessage: "项目 ID 为空。", updatedFileCount: 0 }
  }

  const taskIds = options.tasks.map((t) => t.id.trim()).filter(Boolean)
  const response = await ipc.app.RemoveDeletedLabelsFromProjectAnnotations({
    globalConfigDir: loadAppConfig().storagePaths.globalConfigDir.trim(),
    projectId,
    taskIds,
    deletedLabels: [...options.deletedLabels],
  })

  return {
    errorMessage: response.errorMessage?.trim() || "",
    updatedFileCount: Math.max(0, Math.floor(Number(response.updatedFileCount) || 0)),
  }
}

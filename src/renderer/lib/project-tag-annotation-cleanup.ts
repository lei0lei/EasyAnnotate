import { listTaskFiles, readImageAnnotation, writeImageAnnotation } from "@/lib/projects-api"
import type { TaskItem } from "@/lib/project-tasks-storage"
import { normalizeXAnyLabelDoc, type XAnyLabelFile } from "@/lib/xanylabeling-format"
import { normalizeDocPointsToInt } from "@/pages/project-task-detail/utils"

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

function stripShapesWithLabels(doc: XAnyLabelFile, deleted: Set<string>): XAnyLabelFile {
  if (deleted.size === 0) return doc
  return {
    ...doc,
    shapes: doc.shapes.filter((shape) => !deleted.has(shape.label)),
  }
}

/**
 * 遍历项目下所有任务的图片标注 JSON，删除 label 属于 deletedLabels 的 shape。
 * 与项目详情「保存」联动：在持久化项目标签前调用，失败时应中止保存。
 */
export async function removeShapesWithDeletedLabelsFromProject(options: {
  projectId: string
  tasks: TaskItem[]
  deletedLabels: Set<string>
}): Promise<{ errorMessage: string; updatedFileCount: number }> {
  if (options.deletedLabels.size === 0) {
    return { errorMessage: "", updatedFileCount: 0 }
  }

  let updatedFileCount = 0

  for (const task of options.tasks) {
    const { files, errorMessage } = await listTaskFiles({
      projectId: options.projectId,
      taskId: task.id,
    })
    if (errorMessage) {
      return { errorMessage, updatedFileCount }
    }

    for (const file of files) {
      const imagePath = file.filePath?.trim()
      if (!imagePath) continue

      const read = await readImageAnnotation(imagePath)
      if (read.errorMessage) {
        return { errorMessage: read.errorMessage, updatedFileCount }
      }
      if (!read.exists) continue

      const doc = normalizeXAnyLabelDoc({
        imagePath,
        imageWidth: 1,
        imageHeight: 1,
        rawJsonText: read.jsonText,
      })
      const nextDoc = stripShapesWithLabels(doc, options.deletedLabels)
      if (nextDoc.shapes.length === doc.shapes.length) continue

      const normalized = normalizeDocPointsToInt(nextDoc)
      const write = await writeImageAnnotation({
        imagePath,
        jsonText: JSON.stringify(normalized, null, 2),
      })
      if (write.errorMessage) {
        return { errorMessage: write.errorMessage, updatedFileCount }
      }
      updatedFileCount += 1
    }
  }

  return { errorMessage: "", updatedFileCount }
}

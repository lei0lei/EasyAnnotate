/**
 * 主进程：删除项目标注 JSON 中属于已移除标签的 shapes。
 * 在任务目录内 walk 图片，不经 renderer 传路径列表。
 */
import fs from "node:fs"
import path from "node:path"
import { getDefaultGlobalConfigDir } from "./app-config-disk"
import { getLocalImageFileInfo, resolveAnnotationJsonPath } from "./image-file-info"
import { collectTaskImageListing, resolveTaskRootDir } from "./task-image-paths"
import { normalizeXAnyLabelDoc, type XAnyLabelFile } from "../renderer/lib/xanylabeling-format"

const MAX_ANNOTATION_JSON_BYTES = 24 * 1024 * 1024

function roundPointsToInt(points: number[][]): number[][] {
  return points.map((pt) => [Math.round(Number(pt[0] ?? 0)), Math.round(Number(pt[1] ?? 0))])
}

function normalizeDocPointsToInt(doc: XAnyLabelFile): XAnyLabelFile {
  return {
    ...doc,
    shapes: doc.shapes.map((shape) => ({
      ...shape,
      points: roundPointsToInt(shape.points),
    })),
  }
}

function stripShapesWithLabels(doc: XAnyLabelFile, deleted: Set<string>): XAnyLabelFile {
  if (deleted.size === 0) return doc
  return {
    ...doc,
    shapes: doc.shapes.filter((shape) => !deleted.has(shape.label)),
  }
}

function readAnnotationDoc(imagePath: string): { doc: XAnyLabelFile | null; errorMessage: string } {
  const jsonPath = resolveAnnotationJsonPath(imagePath)
  if (!fs.existsSync(jsonPath)) {
    return { doc: null, errorMessage: "" }
  }
  try {
    const stat = fs.statSync(jsonPath)
    if (!stat.isFile()) {
      return { doc: null, errorMessage: "标注路径不是文件。" }
    }
    if (stat.size > MAX_ANNOTATION_JSON_BYTES) {
      return {
        doc: null,
        errorMessage: `标注文件过大：${jsonPath}`,
      }
    }
    const rawJsonText = fs.readFileSync(jsonPath, "utf8")
    if (!rawJsonText.trim()) {
      return { doc: null, errorMessage: "" }
    }
    const info = getLocalImageFileInfo(imagePath)
    const doc = normalizeXAnyLabelDoc({
      imagePath,
      imageWidth: info.width > 0 ? info.width : 1,
      imageHeight: info.height > 0 ? info.height : 1,
      rawJsonText,
    })
    return { doc, errorMessage: "" }
  } catch (error) {
    return {
      doc: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

function writeAnnotationDoc(imagePath: string, doc: XAnyLabelFile): { errorMessage: string } {
  const jsonPath = resolveAnnotationJsonPath(imagePath)
  try {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2), "utf8")
    return { errorMessage: "" }
  } catch (error) {
    return { errorMessage: error instanceof Error ? error.message : String(error) }
  }
}

export function removeDeletedLabelsFromProjectAnnotations(args: {
  globalConfigDir: string
  projectId: string
  taskIds: string[]
  deletedLabels: string[]
}): { errorMessage: string; updatedFileCount: number } {
  const deleted = new Set(args.deletedLabels.map((l) => l.trim()).filter(Boolean))
  if (deleted.size === 0) {
    return { errorMessage: "", updatedFileCount: 0 }
  }

  const projectId = args.projectId.trim()
  if (!projectId) {
    return { errorMessage: "项目 ID 为空。", updatedFileCount: 0 }
  }

  const globalConfigDir = args.globalConfigDir.trim() || getDefaultGlobalConfigDir()
  const taskIds = [...new Set(args.taskIds.map((id) => id.trim()).filter(Boolean))]
  if (taskIds.length === 0) {
    return { errorMessage: "", updatedFileCount: 0 }
  }

  let updatedFileCount = 0

  for (const taskId of taskIds) {
    const resolved = resolveTaskRootDir(globalConfigDir, projectId, taskId)
    if (resolved.errorMessage) {
      return { errorMessage: resolved.errorMessage, updatedFileCount }
    }

    const { imagePaths } = collectTaskImageListing(resolved.taskRootDir)
    for (const imagePath of imagePaths) {
      const read = readAnnotationDoc(imagePath)
      if (read.errorMessage) {
        return { errorMessage: read.errorMessage, updatedFileCount }
      }
      if (!read.doc) continue

      const nextDoc = stripShapesWithLabels(read.doc, deleted)
      if (nextDoc.shapes.length === read.doc.shapes.length) continue

      const normalized = normalizeDocPointsToInt(nextDoc)
      const write = writeAnnotationDoc(imagePath, normalized)
      if (write.errorMessage) {
        return { errorMessage: write.errorMessage, updatedFileCount }
      }
      updatedFileCount += 1
    }
  }

  return { errorMessage: "", updatedFileCount }
}

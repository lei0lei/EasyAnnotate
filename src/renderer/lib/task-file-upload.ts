import { ipc } from "@/gen/ipc"
import { saveTaskFiles } from "@/lib/projects-api"

export type TaskUploadCandidate = {
  id: string
  name: string
  /** 主进程可访问的绝对路径；有则不走 IPC 传字节 */
  sourcePath: string
  file?: File
}

function maybeDecodePathValue(value: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(value)) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function normalizeDialogPath(rawPath: string): string {
  const input = rawPath.trim()
  if (!input) return ""
  if (!/^file:\/\//i.test(input)) {
    return maybeDecodePathValue(input)
  }
  try {
    const url = new URL(input)
    let pathname = maybeDecodePathValue(url.pathname || "")
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1)
    }
    pathname = pathname.replace(/\//g, "\\")
    if (url.host) {
      return `\\\\${url.host}${pathname.startsWith("\\") ? "" : "\\"}${pathname}`
    }
    return pathname
  } catch {
    return maybeDecodePathValue(input)
  }
}

export function fileNameFromPath(filePath: string): string {
  const p = filePath.trim().replace(/\\/g, "/")
  const idx = p.lastIndexOf("/")
  return idx >= 0 ? p.slice(idx + 1) : p
}

export function candidatesFromDialogPaths(paths: string[]): TaskUploadCandidate[] {
  return paths
    .map((p) => normalizeDialogPath(p))
    .filter(Boolean)
    .map((sourcePath) => ({
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name: fileNameFromPath(sourcePath),
      sourcePath,
    }))
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"])

export function splitTaskUploadPaths(paths: string[]): {
  imageCandidates: TaskUploadCandidate[]
  zipPaths: string[]
  unsupportedPaths: string[]
} {
  const imageCandidates: TaskUploadCandidate[] = []
  const zipPaths: string[] = []
  const unsupportedPaths: string[] = []
  for (const raw of paths) {
    const sourcePath = normalizeDialogPath(raw)
    if (!sourcePath) continue
    const normalized = sourcePath.replace(/\\/g, "/")
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1)
    const dot = fileName.lastIndexOf(".")
    const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ""
    if (IMAGE_EXTS.has(ext)) {
      imageCandidates.push({
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        name: fileNameFromPath(sourcePath),
        sourcePath,
      })
      continue
    }
    if (ext === ".zip") {
      zipPaths.push(sourcePath)
      continue
    }
    unsupportedPaths.push(sourcePath)
  }
  return { imageCandidates, zipPaths, unsupportedPaths }
}

/** 通过系统对话框选文件（推荐）：只传路径，由主进程 copyFileSync。 */
export async function pickTaskUploadFilesViaDialog(title: string): Promise<TaskUploadCandidate[]> {
  const picked = await ipc.app.SelectFiles({
    title,
    defaultPath: "",
  })
  if (picked.canceled || !picked.paths?.length) return []
  return candidatesFromDialogPaths(picked.paths)
}

export async function pickAnnotatedZipViaDialog(title: string): Promise<string> {
  const picked = await ipc.app.SelectFiles({
    title,
    defaultPath: "",
  })
  if (picked.canceled || !picked.paths?.length) return ""
  const zipPath = picked.paths.find((item) => normalizeDialogPath(item).toLowerCase().endsWith(".zip")) ?? ""
  return normalizeDialogPath(zipPath)
}

export function candidatesFromBrowserFiles(input: FileList | File[]): {
  accepted: TaskUploadCandidate[]
  skippedWithoutPath: string[]
} {
  const accepted: TaskUploadCandidate[] = []
  const skippedWithoutPath: string[] = []
  for (const file of Array.from(input)) {
    accepted.push({
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name: file.name,
      // 浏览器 File 可能提供错误编码路径（中文会乱码）；此处强制走 content 上传。
      sourcePath: "",
      file,
    })
  }
  return { accepted, skippedWithoutPath }
}

/** 每批 IPC 上传的图片数；过大 protobuf 会导致 MōBrowser 进程闪退。 */
export const TASK_UPLOAD_BATCH_SIZE = 10

/** 创建/补充页文件列表最多渲染条数，避免数百张图拖垮 DOM。 */
export const TASK_UPLOAD_PREVIEW_LIMIT = 10

export type TaskUploadProgress = { done: number; total: number }

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return []
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

/**
 * 保存任务图片：有 sourcePath 的分批走主进程复制；无路径的逐张读入并单独 IPC，避免超大 protobuf 导致进程闪退。
 */
export async function saveTaskUploadCandidates(payload: {
  projectId: string
  taskId: string
  subset: string
  files: TaskUploadCandidate[]
  onProgress?: (progress: TaskUploadProgress) => void
}): Promise<{ errorMessage: string; savedCount: number }> {
  const withPath = payload.files.filter((f) => f.sourcePath.trim())
  const withoutPath = payload.files.filter((f) => !f.sourcePath.trim() && f.file)
  const total = withPath.length + withoutPath.length
  let savedCount = 0

  const report = () => payload.onProgress?.({ done: savedCount, total })

  for (const batch of chunkArray(withPath, TASK_UPLOAD_BATCH_SIZE)) {
    const result = await saveTaskFiles({
      projectId: payload.projectId,
      taskId: payload.taskId,
      subset: payload.subset,
      files: batch.map((item) => ({
        sourcePath: item.sourcePath.trim(),
        fileName: item.name || fileNameFromPath(item.sourcePath),
      })),
    })
    if (result.errorMessage) {
      return { errorMessage: result.errorMessage, savedCount }
    }
    savedCount += (result.savedPaths ?? []).length
    report()
  }

  for (const item of withoutPath) {
    if (!item.file) continue
    let content: Uint8Array
    try {
      content = new Uint8Array(await item.file.arrayBuffer())
    } catch (e) {
      return {
        errorMessage: `读取「${item.name}」失败：${e instanceof Error ? e.message : String(e)}`,
        savedCount,
      }
    }
    const result = await saveTaskFiles({
      projectId: payload.projectId,
      taskId: payload.taskId,
      subset: payload.subset,
      files: [{ sourcePath: "", fileName: item.name, content }],
    })
    if (result.errorMessage) {
      return { errorMessage: result.errorMessage, savedCount }
    }
    savedCount += (result.savedPaths ?? []).length
    report()
  }

  if (payload.files.length > 0 && savedCount === 0) {
    return { errorMessage: "没有可保存的有效文件。", savedCount: 0 }
  }

  return { errorMessage: "", savedCount }
}

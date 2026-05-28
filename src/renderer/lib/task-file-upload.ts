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

/**
 * 保存任务图片：有 sourcePath 的批量走主进程复制；无路径的逐张读入并单独 IPC，避免 Promise.all + 超大 protobuf 导致进程闪退。
 */
export async function saveTaskUploadCandidates(payload: {
  projectId: string
  taskId: string
  subset: string
  files: TaskUploadCandidate[]
}): Promise<{ errorMessage: string; savedPaths: string[] }> {
  const withPath = payload.files.filter((f) => f.sourcePath.trim())
  const withoutPath = payload.files.filter((f) => !f.sourcePath.trim() && f.file)

  const savedPaths: string[] = []

  if (withPath.length > 0) {
    const result = await saveTaskFiles({
      projectId: payload.projectId,
      taskId: payload.taskId,
      subset: payload.subset,
      files: withPath.map((item) => ({
        sourcePath: item.sourcePath.trim(),
        fileName: item.name || fileNameFromPath(item.sourcePath),
      })),
    })
    if (result.errorMessage) {
      return { errorMessage: result.errorMessage, savedPaths }
    }
    savedPaths.push(...(result.savedPaths ?? []))
  }

  for (const item of withoutPath) {
    if (!item.file) continue
    let content: Uint8Array
    try {
      content = new Uint8Array(await item.file.arrayBuffer())
    } catch (e) {
      return {
        errorMessage: `读取「${item.name}」失败：${e instanceof Error ? e.message : String(e)}`,
        savedPaths,
      }
    }
    const result = await saveTaskFiles({
      projectId: payload.projectId,
      taskId: payload.taskId,
      subset: payload.subset,
      files: [{ sourcePath: "", fileName: item.name, content }],
    })
    if (result.errorMessage) {
      return { errorMessage: result.errorMessage, savedPaths }
    }
    savedPaths.push(...(result.savedPaths ?? []))
  }

  if (payload.files.length > 0 && savedPaths.length === 0) {
    return { errorMessage: "没有可保存的有效文件。", savedPaths: [] }
  }

  return { errorMessage: "", savedPaths }
}

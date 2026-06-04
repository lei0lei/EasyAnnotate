import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { appendTaskFileCount, createTask, deleteTask, updateTaskAnnotatedFileCount } from "@/lib/project-tasks-storage"
import { deleteTaskData, getProject, countTaskImageZip, startAnnotatedTaskZipImport, getAnnotatedTaskImportJob, importTaskImageZip, type ProjectItem } from "@/lib/projects-api"
import {
  markProjectBootstrapAfterImport,
  projectDetailNavStateAfterImport,
} from "@/lib/project-page-bootstrap"
import {
  candidatesFromBrowserFiles,
  pickAnnotatedZipViaDialog,
  pickTaskUploadFilesViaDialog,
  saveTaskUploadCandidates,
  splitTaskUploadPaths,
  TASK_CREATE_IMAGE_UPLOAD_LIMIT,
  TASK_UPLOAD_PREVIEW_LIMIT,
  type TaskUploadCandidate,
} from "@/lib/task-file-upload"
import { ArrowLeft, Upload } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

const ANNOTATED_IMPORT_FORMATS = [
  { value: "xanylabeling", label: "xanylabeling" },
  { value: "yolo-detect", label: "yolo detect" },
  { value: "yolo-obb", label: "yolo obb" },
  { value: "yolo-segment", label: "yolo segment" },
  { value: "yolo-pose", label: "yolo pose" },
] as const

export default function ProjectTaskCreatePage() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [project, setProject] = useState<ProjectItem | undefined>(undefined)
  const [loadingProject, setLoadingProject] = useState(false)
  const [name, setName] = useState("")
  const [subset, setSubset] = useState("")
  const [imageFiles, setImageFiles] = useState<TaskUploadCandidate[]>([])
  const [imageZipPaths, setImageZipPaths] = useState<string[]>([])
  const [zipImageCounts, setZipImageCounts] = useState<Record<string, number>>({})
  const [zipCountLoading, setZipCountLoading] = useState(false)
  const [annotatedZipPath, setAnnotatedZipPath] = useState("")
  const [annotatedImportFormat, setAnnotatedImportFormat] = useState<(typeof ANNOTATED_IMPORT_FORMATS)[number]["value"]>(
    "xanylabeling",
  )
  const [importSummary, setImportSummary] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [activeImportJobId, setActiveImportJobId] = useState("")
  const [importProgress, setImportProgress] = useState(0)
  const [importMessage, setImportMessage] = useState("")
  type PendingAfterImport = {
    taskId: string
    name: string
    subset: string
    totalImageCount: number
    summaryParts: string[]
    importedAnyImage: boolean
    taskCreated: boolean
  }
  const pendingCreateRef = useRef<PendingAfterImport | null>(null)
  const importCompletionHandledRef = useRef("")
  const pageAliveRef = useRef(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [copyErrorLabel, setCopyErrorLabel] = useState("复制错误详情")

  useEffect(() => {
    let alive = true
    if (!projectId) return
    setLoadingProject(true)
    void getProject(projectId)
      .then((item) => {
        if (!alive) return
        setProject(item)
      })
      .finally(() => {
        if (!alive) return
        setLoadingProject(false)
      })
    return () => {
      alive = false
    }
  }, [projectId])

  useEffect(() => {
    let alive = true
    if (imageZipPaths.length === 0) {
      setZipImageCounts({})
      setZipCountLoading(false)
      return () => {
        alive = false
      }
    }
    setZipCountLoading(true)
    void (async () => {
      const next: Record<string, number> = {}
      for (const zipPath of imageZipPaths) {
        const result = await countTaskImageZip(zipPath)
        if (!alive) return
        next[zipPath] = result.errorMessage ? 0 : result.imageCount
      }
      if (!alive) return
      setZipImageCounts(next)
      setZipCountLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [imageZipPaths])

  useEffect(() => {
    pageAliveRef.current = true
    return () => {
      pageAliveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!activeImportJobId) return
    let alive = true
    const jobId = activeImportJobId

    const finishImportPolling = () => {
      setSubmitting(false)
      setActiveImportJobId("")
      pendingCreateRef.current = null
      setImportProgress(0)
      setImportMessage("")
    }

    const tick = () => {
      void getAnnotatedTaskImportJob(jobId)
        .then((current) => {
          if (!alive) return
          if (!current) {
            window.setTimeout(tick, 500)
            return
          }
          setImportProgress(Math.max(0, Math.min(100, current.progress)))
          setImportMessage(current.message || `导入进度 ${current.progress}%`)
          if (current.status === "success") {
            if (importCompletionHandledRef.current === jobId) return
            importCompletionHandledRef.current = jobId
            const pendingSnapshot = pendingCreateRef.current
            finishImportPolling()
            void (async () => {
              const pending = pendingSnapshot
              const taskId = (pending?.taskId || current.taskId || "").trim()
              if (!projectId || !taskId) {
                if (pageAliveRef.current) {
                  setErrorMessage("导入已完成，但无法关联任务记录，请返回项目页刷新后查看。")
                }
                return
              }
              const summaryParts = [
                ...(pending?.summaryParts ?? []),
                `标注 ZIP 导入 ${current.importedImageCount} 张图片 / ${current.importedAnnotationCount} 份标注（${current.detectedFormat || "unknown"}）`,
              ]
              if (pageAliveRef.current) {
                setImportSummary(summaryParts.join("；"))
              }
              try {
                if (pending?.taskCreated) {
                  if (current.importedImageCount > 0) {
                    await appendTaskFileCount(projectId, taskId, current.importedImageCount)
                  }
                  if (current.importedAnnotationCount > 0) {
                    await updateTaskAnnotatedFileCount(projectId, taskId, current.importedAnnotationCount)
                  }
                } else {
                  await createTask(projectId, {
                    id: taskId,
                    name: pending?.name ?? name.trim(),
                    subset: pending?.subset ?? subset.trim(),
                    fileCount: (pending?.totalImageCount ?? 0) + current.importedImageCount,
                  })
                }
                if (pageAliveRef.current) {
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 300)
                  })
                  markProjectBootstrapAfterImport(projectId)
                  navigate(`/projects/${projectId}`, {
                    replace: true,
                    state: projectDetailNavStateAfterImport(),
                  })
                }
              } catch (error) {
                if (!pageAliveRef.current) return
                const hadFiles = Boolean(pending?.importedAnyImage || current.importedImageCount > 0)
                if (hadFiles) {
                  await deleteTask(projectId, taskId).catch(() => undefined)
                  const rollback = await deleteTaskData({ projectId, taskId })
                  if (rollback.errorMessage) {
                    setErrorMessage(`提交失败且回滚失败：${rollback.errorMessage}`)
                  } else {
                    const message = error instanceof Error ? error.message : String(error)
                    setErrorMessage(`提交失败：${message}`)
                  }
                } else {
                  const message = error instanceof Error ? error.message : String(error)
                  setErrorMessage(`提交失败：${message}`)
                }
              }
            })()
            return
          }
          if (current.status === "failed") {
            if (importCompletionHandledRef.current === jobId) return
            importCompletionHandledRef.current = jobId
            const pendingSnapshot = pendingCreateRef.current
            finishImportPolling()
            void (async () => {
              const pending = pendingSnapshot
              const taskId = (pending?.taskId || current.taskId || "").trim()
              if (projectId && taskId) {
                if (pending?.taskCreated) {
                  await deleteTask(projectId, taskId).catch(() => undefined)
                }
                const rollback = await deleteTaskData({ projectId, taskId })
                if (pageAliveRef.current) {
                  if (rollback.errorMessage) {
                    setErrorMessage(`导入已标注数据失败且回滚失败：${rollback.errorMessage}`)
                  } else {
                    setErrorMessage(`导入已标注数据失败：${current.message || "未知错误"}`)
                  }
                }
              } else if (pageAliveRef.current) {
                setErrorMessage(`导入已标注数据失败：${current.message || "未知错误"}`)
              }
            })()
            return
          }
          window.setTimeout(tick, 500)
        })
        .catch((error) => {
          if (!alive) return
          const message = error instanceof Error ? error.message : String(error)
          setErrorMessage(`查询导入进度失败：${message || "IPC 通信异常，请重启应用后重试"}`)
          finishImportPolling()
        })
    }
    tick()
    return () => {
      alive = false
    }
  }, [activeImportJobId, name, navigate, projectId, subset])

  const hasImageUploadSelection = imageFiles.length > 0 || imageZipPaths.length > 0
  const zipImageTotal = useMemo(
    () => imageZipPaths.reduce((sum, zipPath) => sum + Math.max(0, zipImageCounts[zipPath] ?? 0), 0),
    [imageZipPaths, zipImageCounts],
  )
  const totalSelectedImages = imageFiles.length + zipImageTotal
  const imageLimitExceeded =
    hasImageUploadSelection && !zipCountLoading && totalSelectedImages > TASK_CREATE_IMAGE_UPLOAD_LIMIT
  const imageUploadLimitBlocked =
    hasImageUploadSelection && (zipCountLoading || totalSelectedImages > TASK_CREATE_IMAGE_UPLOAD_LIMIT)

  const canCreate = useMemo(
    () =>
      name.trim().length > 0 &&
      !!projectId &&
      !!project &&
      !imageUploadLimitBlocked &&
      (imageFiles.length > 0 || imageZipPaths.length > 0 || annotatedZipPath.trim().length > 0),
    [name, imageFiles.length, imageZipPaths.length, annotatedZipPath, project, projectId, imageUploadLimitBlocked],
  )
  const hasAnnotatedZipSelection = annotatedZipPath.trim().length > 0
  const imageUploadDisabled = hasAnnotatedZipSelection || submitting
  const annotatedZipDisabled = hasImageUploadSelection || submitting

  function mergeImageCandidates(incoming: TaskUploadCandidate[]) {
    if (incoming.length <= 0) return
    setImageFiles((prev) => {
      const keyOf = (item: TaskUploadCandidate) => {
        const sourcePath = item.sourcePath.trim()
        if (sourcePath) return `p:${sourcePath.toLowerCase()}`
        return `f:${item.name.toLowerCase()}:${item.file?.size ?? -1}:${item.file?.lastModified ?? -1}`
      }
      const used = new Set(prev.map((item) => keyOf(item)))
      const next = [...prev]
      for (const item of incoming) {
        const key = keyOf(item)
        if (used.has(key)) continue
        used.add(key)
        next.push(item)
      }
      return next
    })
  }

  function mergeZipPaths(incoming: string[]) {
    if (incoming.length <= 0) return
    setImageZipPaths((prev) => {
      const used = new Set(prev.map((item) => item.toLowerCase()))
      const next = [...prev]
      for (const item of incoming) {
        const key = item.toLowerCase()
        if (used.has(key)) continue
        used.add(key)
        next.push(item)
      }
      return next
    })
  }

  async function handlePickImageFilesOrZip() {
    if (hasAnnotatedZipSelection) {
      setErrorMessage("已选择“上传文件及标注”，请先清空后再切换为“上传图片”。")
      return
    }
    const picked = await pickTaskUploadFilesViaDialog("选择图片文件或 ZIP")
    if (picked.length <= 0) return
    const split = splitTaskUploadPaths(picked.map((item) => item.sourcePath))
    mergeImageCandidates(split.imageCandidates)
    mergeZipPaths(split.zipPaths)
    if (split.unsupportedPaths.length > 0) {
      setErrorMessage(`已忽略 ${split.unsupportedPaths.length} 个非图片/zip 文件。`)
    } else {
      setErrorMessage(null)
    }
    setImportSummary("")
  }

  function handlePickImageFilesViaBrowser() {
    if (hasAnnotatedZipSelection) {
      setErrorMessage("已选择“上传文件及标注”，请先清空后再切换为“上传图片”。")
      return
    }
    imageInputRef.current?.click()
  }

  async function handlePickAnnotatedZip() {
    if (hasImageUploadSelection) {
      setErrorMessage("已选择“上传图片”，请先清空后再切换为“上传文件及标注”。")
      return
    }
    const picked = await pickAnnotatedZipViaDialog("选择已标注数据 ZIP")
    if (!picked.trim()) {
      setErrorMessage("请选择 .zip 文件。")
      return
    }
    setAnnotatedZipPath(picked)
    setImportSummary("")
    setErrorMessage(null)
  }

  async function handleCreate() {
    if (!projectId || !project || !canCreate || submitting) return
    if (hasImageUploadSelection && totalSelectedImages > TASK_CREATE_IMAGE_UPLOAD_LIMIT) {
      setErrorMessage(
        `已选择 ${totalSelectedImages} 张图片，超过单次上限 ${TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张，请减少后重试。`,
      )
      return
    }
    setSubmitting(true)
    setErrorMessage(null)
    setImportSummary("")
    setUploadProgress(null)
    let pendingTaskId = ""
    let importedAnyImage = false
    let importJobStarted = false
    try {
      if (hasImageUploadSelection && hasAnnotatedZipSelection) {
        setErrorMessage("一次仅允许一种上传方式，请先清空其中一类后再提交。")
        return
      }
      const taskId = generateId()
      pendingTaskId = taskId
      let totalImageCount = 0
      const summaryParts: string[] = []

      if (imageFiles.length > 0) {
        setUploadProgress({ done: 0, total: imageFiles.length })
        const saveResult = await saveTaskUploadCandidates({
          projectId,
          taskId,
          subset: subset.trim(),
          files: imageFiles,
          onProgress: setUploadProgress,
        })
        if (saveResult.errorMessage) {
          setErrorMessage(`上传图片失败：${saveResult.errorMessage}`)
          return
        }
        totalImageCount += saveResult.savedCount
        importedAnyImage = importedAnyImage || saveResult.savedCount > 0
        summaryParts.push(`上传图片 ${saveResult.savedCount} 张`)
      }

      for (const zipPath of imageZipPaths) {
        const zipResult = await importTaskImageZip({
          projectId,
          taskId,
          subset: subset.trim(),
          zipPath,
        })
        if (zipResult.errorMessage) {
          setErrorMessage(`导入图片 ZIP 失败：${zipResult.errorMessage}`)
          return
        }
        totalImageCount += zipResult.importedImageCount
        importedAnyImage = importedAnyImage || zipResult.importedImageCount > 0
        summaryParts.push(`图片 ZIP 导入 ${zipResult.importedImageCount} 张`)
      }

      if (annotatedZipPath.trim()) {
        setImportProgress(0)
        setImportMessage("正在启动导入…")
        importCompletionHandledRef.current = ""
        await createTask(projectId, {
          id: taskId,
          name: name.trim(),
          subset: subset.trim(),
          fileCount: totalImageCount,
        })
        importedAnyImage = importedAnyImage || totalImageCount > 0
        const started = await startAnnotatedTaskZipImport({
          projectId,
          taskId,
          subset: subset.trim(),
          zipPath: annotatedZipPath.trim(),
          importFormat: annotatedImportFormat,
        })
        if (started.errorMessage) {
          await deleteTask(projectId, taskId).catch(() => undefined)
          setErrorMessage(`导入已标注数据失败：${started.errorMessage}`)
          return
        }
        markProjectBootstrapAfterImport(projectId)
        importJobStarted = true
        pendingCreateRef.current = {
          taskId,
          name: name.trim(),
          subset: subset.trim(),
          totalImageCount,
          summaryParts,
          importedAnyImage,
          taskCreated: true,
        }
        setActiveImportJobId(started.jobId)
        return
      }

      if (summaryParts.length > 0) {
        setImportSummary(summaryParts.join("；"))
      }

      await createTask(projectId, {
        id: taskId,
        name: name.trim(),
        subset: subset.trim(),
        fileCount: totalImageCount,
      })
      navigate(`/projects/${projectId}`, { replace: true })
    } catch (error) {
      if (projectId && pendingTaskId && importedAnyImage) {
        const rollback = await deleteTaskData({ projectId, taskId: pendingTaskId })
        if (rollback.errorMessage) {
          setErrorMessage(`提交失败且回滚失败：${rollback.errorMessage}`)
          return
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(`提交失败：${message}`)
    } finally {
      if (!importJobStarted) {
        setSubmitting(false)
        setUploadProgress(null)
      }
    }
  }

  async function handleCopyErrorMessage() {
    if (!errorMessage) return
    try {
      await navigator.clipboard.writeText(errorMessage)
      setCopyErrorLabel("已复制")
      window.setTimeout(() => setCopyErrorLabel("复制错误详情"), 1200)
    } catch {
      setCopyErrorLabel("复制失败")
      window.setTimeout(() => setCopyErrorLabel("复制错误详情"), 1200)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="返回项目">
          <Link to={`/projects/${projectId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">创建任务</h1>
          <p className="mt-1 text-sm text-muted-foreground">填写任务信息、子集与文件，提交后创建任务。</p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium">任务信息</CardTitle>
          <CardDescription>类似 CVAT 的任务创建流程。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="task-create-name" className="text-sm font-medium text-foreground">
              任务名称
            </label>
            <Input
              id="task-create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：batch-001"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void handleCreate()
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="task-create-project-name" className="text-sm font-medium text-foreground">
              项目
            </label>
            <Input
              id="task-create-project-name"
              value={loadingProject ? "读取中..." : project?.name ?? ""}
              readOnly
              disabled
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="task-create-subset" className="text-sm font-medium text-foreground">
              子集
            </label>
            <Input
              id="task-create-subset"
              value={subset}
              onChange={(e) => setSubset(e.target.value)}
              placeholder="例如：train / val / test"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">用于对任务分组，后续导出可按子集归档。</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">上传文件（仅图片）</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handlePickImageFilesOrZip()}
                disabled={imageUploadDisabled}
              >
                选择图片 / ZIP
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handlePickImageFilesViaBrowser()}
                disabled={imageUploadDisabled}
              >
                浏览器选图（兼容中文名）
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasImageUploadSelection || submitting}
                onClick={() => {
                  setImageFiles([])
                  setImageZipPaths([])
                  setZipImageCounts({})
                  setImportSummary("")
                  setErrorMessage(null)
                }}
              >
                清空
              </Button>
            </div>
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center transition-colors">
              <Upload className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm text-foreground">支持直接上传图片文件，或导入仅包含图片的 ZIP</p>
              <p className="mt-1 text-xs text-muted-foreground">
                单次最多 {TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张；大批量请优先用「选择图片 / ZIP」。
              </p>
            </div>
            {zipCountLoading ? <p className="text-xs text-muted-foreground">正在统计 ZIP 内图片数量…</p> : null}
            {imageLimitExceeded ? (
              <p className="text-sm font-medium text-destructive">
                已选择 {totalSelectedImages} 张图片，超过单次上限 {TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张，请减少后重试。
              </p>
            ) : null}
            {!imageLimitExceeded && hasImageUploadSelection && !zipCountLoading ? (
              <p className="text-xs text-muted-foreground">
                已选 {totalSelectedImages} / {TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张
              </p>
            ) : null}
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (!e.target.files || e.target.files.length <= 0) return
                const { accepted } = candidatesFromBrowserFiles(e.target.files)
                mergeImageCandidates(accepted)
                setErrorMessage(null)
                setImportSummary("")
                e.target.value = ""
              }}
            />
            <Input
              value={
                zipCountLoading
                  ? `${imageFiles.length} 张图片，${imageZipPaths.length} 个图片 ZIP（统计中…）`
                  : `${imageFiles.length} 张图片，${imageZipPaths.length} 个图片 ZIP${
                      zipImageTotal > 0 ? `（ZIP 内 ${zipImageTotal} 张）` : ""
                    }`
              }
              readOnly
              placeholder="未选择文件"
            />
            {imageFiles.length > 0 ? (
              <ul className="max-h-28 space-y-1 overflow-auto rounded-md border border-border/70 bg-muted/10 p-2 text-xs">
                {imageFiles.slice(0, TASK_UPLOAD_PREVIEW_LIMIT).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground" title={item.sourcePath || item.name}>
                      {item.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setImageFiles((prev) => prev.filter((f) => f.id !== item.id))}
                    >
                      移除
                    </Button>
                  </li>
                ))}
                {imageFiles.length > TASK_UPLOAD_PREVIEW_LIMIT ? (
                  <li className="pt-1 text-muted-foreground">
                    … 另有 {imageFiles.length - TASK_UPLOAD_PREVIEW_LIMIT} 张未列出（共 {imageFiles.length} 张）
                  </li>
                ) : null}
              </ul>
            ) : null}
            {imageZipPaths.length > 0 ? (
              <ul className="max-h-24 space-y-1 overflow-auto rounded-md border border-border/70 bg-muted/10 p-2 text-xs">
                {imageZipPaths.map((zip) => (
                  <li key={zip} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground" title={zip}>
                      {zip}
                      {zipCountLoading ? "" : `（${zipImageCounts[zip] ?? 0} 张）`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setImageZipPaths((prev) => prev.filter((p) => p !== zip))}
                    >
                      移除
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {hasAnnotatedZipSelection ? (
              <p className="text-xs text-muted-foreground">已选择“上传文件及标注”，当前入口已禁用。</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">上传文件及标注（已标注 ZIP）</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handlePickAnnotatedZip()}
                disabled={annotatedZipDisabled}
              >
                选择已标注 ZIP
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasAnnotatedZipSelection || submitting}
                onClick={() => {
                  setAnnotatedZipPath("")
                  setImportSummary("")
                  setErrorMessage(null)
                }}
              >
                清空
              </Button>
            </div>
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center transition-colors">
              <Upload className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm text-foreground">选择导入格式后导入对应标注 ZIP</p>
              <p className="mt-1 text-xs text-muted-foreground">
                支持 xanylabeling、yolo detect / obb / segment；大批量 ZIP 将走子进程导入并显示进度条。
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="task-create-import-format" className="text-xs font-medium text-foreground">
                标注导入格式
              </label>
              <select
                id="task-create-import-format"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={annotatedImportFormat}
                onChange={(e) => setAnnotatedImportFormat(e.target.value as (typeof ANNOTATED_IMPORT_FORMATS)[number]["value"])}
                disabled={submitting || hasImageUploadSelection}
              >
                {ANNOTATED_IMPORT_FORMATS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <Input value={annotatedZipPath} readOnly placeholder="未选择已标注 ZIP 文件" />
            {importSummary ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{importSummary}</p> : null}
            {hasImageUploadSelection ? (
              <p className="text-xs text-muted-foreground">已选择“上传图片”，当前入口已禁用。</p>
            ) : null}
          </div>

          {errorMessage ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-destructive">提交错误</p>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => void handleCopyErrorMessage()}>
                  {copyErrorLabel}
                </Button>
              </div>
              <textarea
                readOnly
                value={errorMessage}
                className="min-h-20 w-full resize-y rounded-md border border-destructive/30 bg-background px-2 py-1 text-xs text-destructive selection:bg-destructive/20"
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void handleCreate()} disabled={!canCreate || submitting}>
              {submitting && uploadProgress
                ? `上传中 ${uploadProgress.done}/${uploadProgress.total}…`
                : submitting && activeImportJobId
                  ? "导入中..."
                  : submitting
                    ? "提交中..."
                    : "提交"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to={`/projects/${projectId}`}>取消</Link>
            </Button>
          </div>

          {submitting && (activeImportJobId || importMessage) ? (
            <div className="w-full space-y-1.5">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/90">
                <div
                  className="h-full rounded-full bg-primary/90 transition-[width] duration-300"
                  style={{ width: `${importProgress}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(importProgress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="标注 ZIP 导入进度"
                />
              </div>
              {importMessage ? <p className="text-xs text-muted-foreground">{importMessage}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

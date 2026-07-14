import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { appendTaskFileCount, loadTasks, type TaskItem } from "@/lib/project-tasks-storage"
import { getProject, type ProjectItem } from "@/lib/projects-api"
import {
  candidatesFromBrowserFiles,
  pickTaskUploadFilesViaDialog,
  saveTaskUploadCandidates,
  TASK_CREATE_IMAGE_UPLOAD_LIMIT,
  TASK_UPLOAD_BATCH_SIZE,
  TASK_UPLOAD_PREVIEW_LIMIT,
  type TaskUploadCandidate,
} from "@/lib/task-file-upload"
import { ArrowLeft, Upload } from "lucide-react"
import { DragEvent, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"


function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

export default function ProjectTaskAppendImagesPage() {
  const navigate = useNavigate()
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [project, setProject] = useState<ProjectItem | undefined>(undefined)
  const [loadingProject, setLoadingProject] = useState(false)
  const [files, setFiles] = useState<TaskUploadCandidate[]>([])
  const [pathHint, setPathHint] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [task, setTask] = useState<TaskItem | undefined>(undefined)

  useEffect(() => {
    if (!projectId || !taskId) {
      setTask(undefined)
      return
    }
    let alive = true
    void loadTasks(projectId).then((tasks) => {
      if (!alive) return
      setTask(tasks.find((item) => item.id === taskId))
    })
    return () => {
      alive = false
    }
  }, [projectId, taskId])

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

  const uploadLimitExceeded = files.length > TASK_CREATE_IMAGE_UPLOAD_LIMIT

  const canSubmit = useMemo(
    () => !!projectId && !!taskId && !!task && files.length > 0 && !uploadLimitExceeded,
    [files.length, projectId, task, taskId, uploadLimitExceeded],
  )

  function mergeCandidates(incoming: TaskUploadCandidate[]) {
    if (incoming.length === 0) return
    setFiles((prev) => {
      const existedKeys = new Set(prev.map((item) => `${item.name}-${item.sourcePath}`))
      const next = [...prev]
      for (const item of incoming) {
        const key = `${item.name}-${item.sourcePath || item.id}`
        if (existedKeys.has(key)) continue
        existedKeys.add(key)
        next.push(item)
      }
      return next
    })
  }

  async function handlePickFiles() {
    setPathHint(null)
    mergeCandidates(await pickTaskUploadFilesViaDialog("选择要补充的图片"))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files?.length) {
      const { accepted, skippedWithoutPath } = candidatesFromBrowserFiles(e.dataTransfer.files)
      mergeCandidates(accepted)
      if (skippedWithoutPath.length > 0) {
        setPathHint(`有 ${skippedWithoutPath.length} 个文件无本地路径未加入，请用「选择文件」。`)
      } else {
        setPathHint(null)
      }
    }
  }

  async function handleSubmit() {
    if (!projectId || !taskId || !task || !canSubmit || submitting) return
    if (files.length > TASK_CREATE_IMAGE_UPLOAD_LIMIT) {
      setErrorMessage(
        `已选择 ${files.length} 张图片，超过单次上传上限 ${TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张，请减少后重试。`,
      )
      return
    }
    setSubmitting(true)
    setErrorMessage(null)
    setUploadProgress({ done: 0, total: files.length })
    try {
      const result = await saveTaskUploadCandidates({
        projectId,
        taskId,
        subset: task.subset,
        files,
        onProgress: setUploadProgress,
      })
      if (result.errorMessage) {
        setErrorMessage(`上传文件失败：${result.errorMessage}`)
        return
      }
      await appendTaskFileCount(projectId, taskId, result.savedCount)
      navigate(`/projects/${projectId}/tasks/${taskId}`, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(`提交失败：${message}`)
    } finally {
      setSubmitting(false)
      setUploadProgress(null)
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">补充图片</h1>
          <p className="mt-1 text-sm text-muted-foreground">为当前任务追加图片文件。</p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium">任务信息</CardTitle>
          <CardDescription>
            项目：{loadingProject ? "读取中..." : project?.name || "—"} · 任务：{task?.name || taskId || "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!task ? <p className="text-xs text-destructive">未找到该任务，请返回任务看板重试。</p> : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">文件上传</p>
            <p className="text-xs text-muted-foreground">
              单次最多 {TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张（每批 {TASK_UPLOAD_BATCH_SIZE} 张上传）。
            </p>
            {uploadLimitExceeded ? (
              <p className="text-xs text-destructive">
                已选择 {files.length} 张图片，超过单次上限 {TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张，请减少后重试。
              </p>
            ) : files.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                已选 {files.length} / {TASK_CREATE_IMAGE_UPLOAD_LIMIT} 张
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="default" size="sm" onClick={() => void handlePickFiles()}>
                选择文件
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                浏览器选图（兼容中文名）
              </Button>
            </div>
            <div
              className={`rounded-lg border border-dashed p-6 text-center transition-colors ${
                dragActive ? "border-primary bg-primary/5" : "border-border bg-muted/20"
              }`}
              onDragEnter={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setDragActive(false)
              }}
              onDrop={handleDrop}
            >
              <Upload className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm text-foreground">可拖拽文件到此处，或使用上方按钮选择</p>
              <p className="mt-1 text-xs text-muted-foreground">中文文件名异常时，优先使用“浏览器选图（兼容中文名）”。</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (!e.target.files) return
                const { accepted, skippedWithoutPath } = candidatesFromBrowserFiles(e.target.files)
                mergeCandidates(accepted)
                if (skippedWithoutPath.length > 0) setPathHint(`已忽略 ${skippedWithoutPath.length} 个无效文件。`)
                e.target.value = ""
              }}
            />
            {pathHint ? <p className="text-xs text-amber-600 dark:text-amber-400">{pathHint}</p> : null}
            {files.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-auto rounded-md border border-border/70 bg-muted/10 p-2 text-xs">
                {files.slice(0, TASK_UPLOAD_PREVIEW_LIMIT).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground">{item.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setFiles((prev) => prev.filter((f) => f.id !== item.id))}
                    >
                      移除
                    </Button>
                  </li>
                ))}
                {files.length > TASK_UPLOAD_PREVIEW_LIMIT ? (
                  <li className="pt-1 text-muted-foreground">
                    … 另有 {files.length - TASK_UPLOAD_PREVIEW_LIMIT} 张未列出（共 {files.length} 张）
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

          {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting || !task}>
              {submitting && uploadProgress
                ? `上传中 ${uploadProgress.done}/${uploadProgress.total}…`
                : submitting
                  ? "提交中..."
                  : "提交"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to={`/projects/${projectId}`}>取消</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

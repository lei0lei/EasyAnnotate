import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { createTask } from "@/lib/project-tasks-storage"
import { getProject, saveTaskFiles, type ProjectItem } from "@/lib/projects-api"
import { ArrowLeft, Upload } from "lucide-react"
import { DragEvent, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

type UploadCandidate = {
  id: string
  name: string
  sourcePath: string
  file?: File
}

function generateId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

export default function ProjectTaskCreatePage() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [project, setProject] = useState<ProjectItem | undefined>(undefined)
  const [loadingProject, setLoadingProject] = useState(false)
  const [name, setName] = useState("")
  const [subset, setSubset] = useState("")
  const [files, setFiles] = useState<UploadCandidate[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  const canCreate = useMemo(
    () => name.trim().length > 0 && !!projectId && !!project,
    [name, project, projectId],
  )

  function appendFiles(input: FileList | File[]) {
    const incoming = Array.from(input)
    if (incoming.length === 0) return
    const existedKeys = new Set(files.map((item) => `${item.name}-${item.sourcePath}`))
    const next = [...files]
    for (const file of incoming) {
      const sourcePath = ((file as File & { path?: string }).path ?? "").trim()
      const key = `${file.name}-${sourcePath || `${file.size}-${file.lastModified}`}`
      if (existedKeys.has(key)) continue
      existedKeys.add(key)
      next.push({
        id: generateId(),
        name: file.name,
        sourcePath,
        file,
      })
    }
    setFiles(next)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files?.length) {
      appendFiles(e.dataTransfer.files)
    }
  }

  async function handleCreate() {
    if (!projectId || !project || !canCreate || submitting) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const taskId = generateId()
      if (files.length > 0) {
        const payloadFiles = await Promise.all(
          files.map(async (item) => {
            if (item.file) {
              return {
                sourcePath: item.sourcePath,
                fileName: item.name,
                content: new Uint8Array(await item.file.arrayBuffer()),
              }
            }
            return {
              sourcePath: item.sourcePath,
              fileName: item.name,
            }
          }),
        )
        const result = await saveTaskFiles({
          projectId,
          taskId,
          subset: subset.trim(),
          files: payloadFiles,
        })
        if (result.errorMessage) {
          setErrorMessage(`上传文件失败：${result.errorMessage}`)
          return
        }
      }
      const task = createTask(projectId, {
        id: taskId,
        name: name.trim(),
        subset: subset.trim(),
        fileCount: files.length,
      })
      navigate(`/projects/${projectId}/tasks/${task.id}`, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(`提交失败：${message}`)
    } finally {
      setSubmitting(false)
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
                  handleCreate()
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
            <p className="text-sm font-medium text-foreground">文件上传</p>
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
              onClick={() => {
                fileInputRef.current?.click()
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
            >
              <Upload className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm text-foreground">拖拽文件到这里，或点击选择文件</p>
              <p className="mt-1 text-xs text-muted-foreground">可多选，提交时会复制到项目数据目录</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  appendFiles(e.target.files)
                  e.target.value = ""
                }
              }}
            />
            {files.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-auto rounded-md border border-border/70 bg-muted/10 p-2 text-xs">
                {files.map((item) => (
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
              </ul>
            ) : null}
          </div>

          {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleCreate} disabled={!canCreate || submitting}>
              {submitting ? "提交中..." : "提交"}
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

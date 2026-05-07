import { Button } from "@/components/ui/button"
import { ProjectTagsEditor } from "@/components/project-tags-editor"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { listAnnotationsByProject } from "@/lib/annotation-db-storage"
import {
  removeShapesWithDeletedLabelsFromProject,
  removedTagNamesSince,
} from "@/lib/project-tag-annotation-cleanup"
import { normalizeSkeletonTemplateSpec, skeletonTemplateSpecEqual } from "@/lib/skeleton-template"
import { removeLegacyExportVersionsStorageKey } from "@/lib/project-export-storage"
import { deleteTask, formatTaskTime, loadTasks, persistTasks, removeLegacyTasksStorageKey, type TaskItem } from "@/lib/project-tasks-storage"
import { deleteProject, deleteTaskData, getProject, listTaskFiles, readImageFile, type ProjectItem, type ProjectTag, updateProject } from "@/lib/projects-api"
import { cn } from "@/lib/utils"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { ArrowLeft, ArrowRight, ArrowUpDown, Check, Clock3, Download, FolderOpen, MoreHorizontal, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

function normalizeColor(raw: string): string {
  const value = raw.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(value) ? value : "#22c55e"
}

function tagKind(t: ProjectTag): "plain" | "skeleton" {
  return t.kind === "skeleton" ? "skeleton" : "plain"
}

function normalizeTags(input: ProjectTag[]): ProjectTag[] {
  const seen = new Set<string>()
  const result: ProjectTag[] = []
  for (const item of input) {
    const name = item.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const color = normalizeColor(item.color)
    if (tagKind(item) === "skeleton") {
      result.push({
        name,
        color,
        kind: "skeleton",
        skeletonTemplate: normalizeSkeletonTemplateSpec(item.skeletonTemplate),
      })
    } else {
      result.push({ name, color, kind: "plain" })
    }
  }
  return result
}

function isSameTags(a: ProjectTag[], b: ProjectTag[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const u = a[i]
    const v = b[i]
    if (u.name !== v.name || u.color !== v.color) return false
    const ku = tagKind(u)
    const kv = tagKind(v)
    if (ku !== kv) return false
    if (ku === "skeleton" && kv === "skeleton") {
      if (
        !skeletonTemplateSpecEqual(
          normalizeSkeletonTemplateSpec(u.skeletonTemplate),
          normalizeSkeletonTemplateSpec(v.skeletonTemplate),
        )
      ) {
        return false
      }
    }
  }
  return true
}

const TASK_PAGE_SIZE = 10
type TaskSortMode = "time" | "subset"

function extractTaskIdFromImagePath(imagePath: string): string | undefined {
  const normalized = imagePath.replace(/\\/g, "/")
  const marker = "/data/tasks/"
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex < 0) return undefined
  const rest = normalized.slice(markerIndex + marker.length)
  const [taskId] = rest.split("/")
  const cleaned = taskId?.trim()
  return cleaned ? cleaned : undefined
}

export default function ProjectDetailPage() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectItem | undefined>(undefined)
  const [loadingProject, setLoadingProject] = useState(false)
  const [name, setName] = useState("")
  const [projectInfo, setProjectInfo] = useState("")
  const [tags, setTags] = useState<ProjectTag[]>([])
  const [editingName, setEditingName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFlashStatus, setSaveFlashStatus] = useState<"idle" | "success" | "error">("idle")
  const [deleting, setDeleting] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [taskPage, setTaskPage] = useState(0)
  const [taskSortMode, setTaskSortMode] = useState<TaskSortMode>("time")
  const [taskDeleteTarget, setTaskDeleteTarget] = useState<TaskItem | null>(null)
  const [annotatedCountByTaskId, setAnnotatedCountByTaskId] = useState<Record<string, number>>({})
  const [editingTaskNameId, setEditingTaskNameId] = useState<string | null>(null)
  const [editingTaskNameValue, setEditingTaskNameValue] = useState("")
  const [editingTaskSubsetId, setEditingTaskSubsetId] = useState<string | null>(null)
  const [editingTaskSubsetValue, setEditingTaskSubsetValue] = useState("")
  const [taskCoverById, setTaskCoverById] = useState<Record<string, string>>({})
  const saveFlashTimerRef = useRef<number | undefined>(undefined)
  const taskCoverByIdRef = useRef<Record<string, string>>({})

  function flashSaveStatus(status: "success" | "error") {
    if (saveFlashTimerRef.current) {
      window.clearTimeout(saveFlashTimerRef.current)
    }
    setSaveFlashStatus(status)
    saveFlashTimerRef.current = window.setTimeout(() => {
      setSaveFlashStatus("idle")
      saveFlashTimerRef.current = undefined
    }, 1000)
  }

  useEffect(() => {
    let alive = true
    if (!projectId) return
    setLoadingProject(true)
    void getProject(projectId)
      .then((item) => {
        if (!alive) return
        setProject(item)
        setName(item?.name ?? "")
        setProjectInfo(item?.projectInfo ?? "")
        setTags(normalizeTags(item?.tags ?? []))
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
    if (!projectId) {
      setTasks([])
      return
    }
    let alive = true
    void loadTasks(projectId)
      .then((localTasks) => {
        if (!alive) return
        setTasks(localTasks)
        void Promise.all(
          localTasks.map(async (task) => {
            const result = await listTaskFiles({ projectId, taskId: task.id })
            if (result.errorMessage) return task
            return {
              ...task,
              fileCount: result.files.length,
            }
          }),
        )
          .then((recountedTasks) => {
            if (!alive) return
            const changed =
              recountedTasks.length !== localTasks.length ||
              recountedTasks.some((task, index) => task.fileCount !== localTasks[index]?.fileCount)
            if (!changed) return
            setTasks(recountedTasks)
            void persistTasks(projectId, recountedTasks).catch(() => {
              // Ignore recount persist failures and keep UI counts.
            })
          })
          .catch(() => {
            // Ignore recount failures.
          })
      })
      .catch(() => {
        if (!alive) return
        setTasks([])
      })

    return () => {
      alive = false
    }
  }, [projectId])

  useEffect(() => {
    let alive = true
    if (!projectId) {
      setAnnotatedCountByTaskId({})
      return
    }
    void listAnnotationsByProject(projectId)
      .then((records) => {
        if (!alive) return
        const grouped = new Map<string, Set<string>>()
        for (const record of records) {
          const taskId = extractTaskIdFromImagePath(record.imagePath)
          if (!taskId) continue
          const existing = grouped.get(taskId) ?? new Set<string>()
          existing.add(record.imagePath)
          grouped.set(taskId, existing)
        }
        const next: Record<string, number> = {}
        grouped.forEach((paths, taskId) => {
          next[taskId] = paths.size
        })
        setAnnotatedCountByTaskId(next)
      })
      .catch(() => {
        if (!alive) return
        setAnnotatedCountByTaskId({})
      })
    return () => {
      alive = false
    }
  }, [projectId])

  useEffect(() => {
    taskCoverByIdRef.current = taskCoverById
  }, [taskCoverById])

  useEffect(() => {
    let alive = true
    if (!projectId || tasks.length === 0) {
      setTaskCoverById((prev) => {
        for (const url of Object.values(prev)) URL.revokeObjectURL(url)
        return {}
      })
      return () => {
        alive = false
      }
    }
    const targetTasks = tasks
    void Promise.all(
      targetTasks.map(async (task) => {
        const fileResult = await listTaskFiles({ projectId, taskId: task.id })
        const firstFilePath = fileResult.files[0]?.filePath?.trim()
        if (fileResult.errorMessage || !firstFilePath) return { taskId: task.id, coverUrl: "" }
        const imageResult = await readImageFile(firstFilePath)
        if (imageResult.errorMessage || !imageResult.content?.length) return { taskId: task.id, coverUrl: "" }
        const bytes = new Uint8Array(imageResult.content)
        const objectUrl = URL.createObjectURL(new Blob([bytes]))
        return { taskId: task.id, coverUrl: objectUrl }
      }),
    ).then((items) => {
      if (!alive) {
        for (const item of items) {
          if (item.coverUrl) URL.revokeObjectURL(item.coverUrl)
        }
        return
      }
      const next: Record<string, string> = {}
      for (const item of items) {
        if (item.coverUrl) {
          next[item.taskId] = item.coverUrl
        }
      }
      setTaskCoverById((prev) => {
        for (const [taskId, prevUrl] of Object.entries(prev)) {
          const nextUrl = next[taskId]
          if (!nextUrl || nextUrl !== prevUrl) {
            URL.revokeObjectURL(prevUrl)
          }
        }
        return next
      })
    })
    return () => {
      alive = false
    }
  }, [projectId, tasks])

  useEffect(() => {
    return () => {
      if (saveFlashTimerRef.current) {
        window.clearTimeout(saveFlashTimerRef.current)
      }
      const current = taskCoverByIdRef.current
      for (const url of Object.values(current)) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  const currentTags = useMemo(() => normalizeTags(tags), [tags])
  const initialTags = useMemo(() => normalizeTags(project?.tags ?? []), [project?.tags])
  const totalTaskPages = useMemo(() => Math.max(1, Math.ceil(tasks.length / TASK_PAGE_SIZE)), [tasks.length])
  const currentTaskPage = useMemo(() => Math.min(taskPage, totalTaskPages - 1), [taskPage, totalTaskPages])
  const sortedTasks = useMemo(() => {
    const next = [...tasks]
    if (taskSortMode === "subset") {
      next.sort((a, b) => {
        const bySubset = a.subset.localeCompare(b.subset, "zh-CN")
        if (bySubset !== 0) return bySubset
        return b.updatedAt.localeCompare(a.updatedAt)
      })
      return next
    }
    next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return next
  }, [taskSortMode, tasks])
  const pagedTasks = useMemo(
    () => sortedTasks.slice(currentTaskPage * TASK_PAGE_SIZE, currentTaskPage * TASK_PAGE_SIZE + TASK_PAGE_SIZE),
    [currentTaskPage, sortedTasks],
  )
  const hasUnsavedChanges = useMemo(() => {
    if (!project) {
      return name.trim().length > 0 || projectInfo.trim().length > 0 || currentTags.length > 0
    }
    return (
      name.trim() !== project.name.trim() ||
      projectInfo.trim() !== project.projectInfo.trim() ||
      !isSameTags(currentTags, initialTags)
    )
  }, [currentTags, initialTags, name, project, projectInfo])

  async function handleSaveProject() {
    if (!projectId) return
    setSaving(true)
    try {
      const removedNames = removedTagNamesSince(initialTags, currentTags)
      if (removedNames.length > 0) {
        const cleanup = await removeShapesWithDeletedLabelsFromProject({
          projectId,
          tasks,
          deletedLabels: new Set(removedNames),
        })
        if (cleanup.errorMessage) {
          flashSaveStatus("error")
          return
        }
      }

      const result = await updateProject({
        id: projectId,
        name: name.trim(),
        projectInfo: projectInfo.trim(),
        tags: currentTags,
      })
      if (result.errorMessage) {
        flashSaveStatus("error")
        return
      }
      if (!result.found || !result.project) {
        flashSaveStatus("error")
        return
      }
      setProject(result.project)
      setName(result.project.name)
      setProjectInfo(result.project.projectInfo)
      setTags(normalizeTags(result.project.tags))
      flashSaveStatus("success")
    } catch (error) {
      flashSaveStatus("error")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteProject() {
    if (!projectId || deleting) return

    setDeleting(true)
    setConfirmDeleteOpen(false)
    try {
      const result = await deleteProject(projectId)
      if (result.errorMessage) {
        flashSaveStatus("error")
        return
      }
      if (!result.found) {
        flashSaveStatus("error")
        return
      }
      removeLegacyTasksStorageKey(projectId)
      removeLegacyExportVersionsStorageKey(projectId)
      navigate("/projects/mine", { replace: true })
    } catch {
      flashSaveStatus("error")
    } finally {
      setDeleting(false)
    }
  }

  function updateTasks(next: TaskItem[]) {
    setTasks(next)
    if (projectId) {
      void persistTasks(projectId, next).catch(() => {
        flashSaveStatus("error")
      })
    }
  }

  async function handleDeleteTask() {
    if (!taskDeleteTarget || !projectId) return
    const backendResult = await deleteTaskData({ projectId, taskId: taskDeleteTarget.id })
    if (backendResult.errorMessage) {
      flashSaveStatus("error")
      return
    }
    await deleteTask(projectId, taskDeleteTarget.id)
    setTasks(await loadTasks(projectId))
    setTaskDeleteTarget(null)
  }

  function updateTaskFields(taskId: string, patch: Partial<Pick<TaskItem, "name" | "subset">>) {
    const now = new Date().toISOString()
    let changed = false
    const next = tasks.map((task) => {
      if (task.id !== taskId) return task
      const nextName = patch.name ?? task.name
      const nextSubset = patch.subset ?? task.subset
      if (nextName === task.name && nextSubset === task.subset) return task
      changed = true
      return {
        ...task,
        name: nextName,
        subset: nextSubset,
        updatedAt: now,
      }
    })
    if (changed) {
      updateTasks(next)
    }
  }

  function startEditTaskName(task: TaskItem) {
    setEditingTaskSubsetId(null)
    setEditingTaskNameId(task.id)
    setEditingTaskNameValue(task.name)
  }

  function cancelEditTaskName() {
    setEditingTaskNameId(null)
    setEditingTaskNameValue("")
  }

  function commitEditTaskName(task: TaskItem) {
    const nextName = editingTaskNameValue.trim()
    if (!nextName) {
      cancelEditTaskName()
      return
    }
    updateTaskFields(task.id, { name: nextName })
    cancelEditTaskName()
  }

  function startEditTaskSubset(task: TaskItem) {
    setEditingTaskNameId(null)
    setEditingTaskSubsetId(task.id)
    setEditingTaskSubsetValue(task.subset)
  }

  function cancelEditTaskSubset() {
    setEditingTaskSubsetId(null)
    setEditingTaskSubsetValue("")
  }

  function commitEditTaskSubset(task: TaskItem) {
    const nextSubset = editingTaskSubsetValue.trim()
    updateTaskFields(task.id, { subset: nextSubset })
    cancelEditTaskSubset()
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回我的项目">
          <Link to="/projects/mine">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">项目</h1>
        </div>
      </div>

      <Card className="sticky top-0 z-10 border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {editingName ? (
                  <Input
                    id="project-name-edit"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                    }}
                    onBlur={() => setEditingName(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        setEditingName(false)
                      }
                    }}
                    className="h-9 max-w-md"
                    placeholder="输入项目名"
                    autoFocus
                    spellCheck={false}
                  />
                ) : (
                  <h2 className="truncate text-lg font-semibold text-foreground">{name || "未命名项目"}</h2>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="编辑项目名"
                  onClick={() => setEditingName(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <span className="ml-auto min-w-0 truncate text-right text-xs text-muted-foreground">
                  {project ? (project.storageType === "remote" ? `remote://${project.remoteIp}:${project.remotePort}` : project.localPath) : "未知路径"}
                </span>
              </div>
            </div>
            <DropdownMenu.Root>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveProject()}
                  disabled={loadingProject || saving || deleting || !hasUnsavedChanges || !projectId}
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors",
                    "hover:bg-accent hover:text-foreground",
                    "disabled:pointer-events-none disabled:opacity-50",
                    saveFlashStatus === "success" && "bg-emerald-600 text-white hover:bg-emerald-600 hover:text-white",
                    saveFlashStatus === "error" && "bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground",
                  )}
                  aria-label="保存项目"
                  title={saving ? "保存中..." : "保存"}
                >
                  {saving ? (
                    <Save className="h-4 w-4 animate-pulse" aria-hidden />
                  ) : saveFlashStatus === "success" ? (
                    <Check className="h-4 w-4" aria-label="保存成功" />
                  ) : saveFlashStatus === "error" ? (
                    <X className="h-4 w-4" aria-label="保存失败" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden />
                  )}
                </button>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    disabled={deleting}
                    aria-label="项目操作"
                    title="项目操作"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
              </div>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-[10rem] overflow-hidden rounded-md border-2 border-border bg-card p-1 text-sm text-card-foreground shadow-none"
                  sideOffset={6}
                  align="end"
                >
                  <DropdownMenu.Item
                    className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                    onSelect={() => {
                      if (!projectId) return
                      navigate(`/projects/${projectId}/export`)
                    }}
                  >
                    导出项目
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                    onSelect={() => {}}
                  >
                    导出标注
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item
                    className="cursor-default select-none rounded-sm px-2 py-1.5 text-destructive outline-hidden data-highlighted:bg-destructive/10"
                    onSelect={() => {
                      setConfirmDeleteOpen(true)
                    }}
                  >
                    删除项目
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          <textarea
            id="project-info-edit"
            value={projectInfo}
            onChange={(e) => {
              setProjectInfo(e.target.value)
            }}
            placeholder="输入项目信息"
            className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />

          <ProjectTagsEditor
            tags={tags}
            onChange={(nextTags) => {
              setTags(nextTags)
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium text-foreground">Task Board</CardTitle>
            </div>
            <div className="flex items-center gap-1">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="任务排序"
                    title="任务排序"
                  >
                    <ArrowUpDown className="h-4 w-4" aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="z-50 min-w-[11rem] overflow-hidden rounded-md border-2 border-border bg-card p-1 text-sm text-card-foreground shadow-none"
                    sideOffset={6}
                    align="end"
                  >
                    <DropdownMenu.Item
                      className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                      onSelect={() => setTaskSortMode("time")}
                    >
                      按时间排序
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                      onSelect={() => setTaskSortMode("subset")}
                    >
                      按子集排序
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <Link
                to={`/projects/${projectId}/tasks/new`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="创建任务"
                title="创建任务"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {tasks.length === 0 ? (
            <p className="rounded-lg border-2 border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              还没有任务，点击右上角“创建任务”开始。
            </p>
          ) : (
            <ul className="space-y-3">
              {pagedTasks.map((task) => (
                <li key={task.id}>
                  <div className="flex flex-col gap-3 rounded-xl border-2 border-border bg-card p-3 sm:flex-row sm:items-center">
                    {taskCoverById[task.id] ? (
                      <div className="w-full shrink-0 sm:w-32">
                        <div className="rounded-md border-2 border-border bg-muted/20">
                          <div className="h-20 w-full overflow-hidden rounded-md">
                            <img
                              src={taskCoverById[task.id]}
                              alt={`任务 ${task.name} 预览图`}
                              className="h-full w-full object-cover"
                              draggable={false}
                              loading="lazy"
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1">
                          {editingTaskNameId === task.id ? (
                            <Input
                              value={editingTaskNameValue}
                              onChange={(e) => setEditingTaskNameValue(e.target.value)}
                              onBlur={() => commitEditTaskName(task)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  commitEditTaskName(task)
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault()
                                  cancelEditTaskName()
                                }
                              }}
                              className="h-7 max-w-sm text-sm"
                              autoFocus
                              spellCheck={false}
                              aria-label={`编辑任务 ${task.name} 名称`}
                            />
                          ) : (
                            <p className="truncate text-sm font-medium text-foreground">{task.name}</p>
                          )}
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={`编辑任务 ${task.name} 名称`}
                            onClick={() => startEditTaskName(task)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {(() => {
                          const totalImages = Math.max(0, task.fileCount)
                          const annotatedImages = Math.max(0, annotatedCountByTaskId[task.id] ?? 0)
                          const safeAnnotated = Math.min(annotatedImages, totalImages || annotatedImages)
                          return <span className="shrink-0 text-xs text-muted-foreground">{safeAnnotated}/{totalImages}</span>
                        })()}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        创建：{formatTaskTime(task.createdAt)}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        更新：{formatTaskTime(task.updatedAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="flex max-w-44 items-center gap-1 text-xs text-muted-foreground">
                        <span className="shrink-0">子集：</span>
                        {editingTaskSubsetId === task.id ? (
                          <Input
                            value={editingTaskSubsetValue}
                            onChange={(e) => setEditingTaskSubsetValue(e.target.value)}
                            onBlur={() => commitEditTaskSubset(task)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault()
                                commitEditTaskSubset(task)
                              }
                              if (e.key === "Escape") {
                                e.preventDefault()
                                cancelEditTaskSubset()
                              }
                            }}
                            className="h-7 w-28 text-xs"
                            autoFocus
                            spellCheck={false}
                            aria-label={`编辑任务 ${task.name} 子集`}
                          />
                        ) : (
                          <span className="truncate">{task.subset || "未设置"}</span>
                        )}
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={`编辑任务 ${task.name} 子集`}
                          onClick={() => startEditTaskSubset(task)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/projects/${projectId}/tasks/${task.id}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={`打开任务 ${task.name}`}
                          title="打开任务"
                        >
                          <FolderOpen className="h-4 w-4" aria-hidden />
                        </Link>
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              aria-label={`任务 ${task.name} 操作`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              className="z-50 min-w-[12rem] overflow-hidden rounded-md border-2 border-border bg-card p-1 text-sm text-card-foreground shadow-none"
                              sideOffset={6}
                              align="end"
                            >
                              <DropdownMenu.Item
                                className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                                onSelect={() => {
                                  navigate(`/projects/${projectId}/tasks/${task.id}/append-images`)
                                }}
                              >
                                <Upload className="h-3.5 w-3.5" aria-hidden />
                                补充图片
                              </DropdownMenu.Item>
                              <DropdownMenu.Item className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent">
                                <Upload className="h-3.5 w-3.5" aria-hidden />
                                上传标注
                              </DropdownMenu.Item>
                              <DropdownMenu.Item className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent">
                                <Download className="h-3.5 w-3.5" aria-hidden />
                                导出标注
                              </DropdownMenu.Item>
                              <DropdownMenu.Item className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent">
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                删除标注
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator className="my-1 h-px bg-border" />
                              <DropdownMenu.Item
                                className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                                onSelect={() => {
                                  navigate(`/projects/${projectId}/tasks/${task.id}/export`)
                                }}
                              >
                                <Download className="h-3.5 w-3.5" aria-hidden />
                                导出任务
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-destructive outline-hidden data-highlighted:bg-destructive/10"
                                onSelect={() => setTaskDeleteTarget(task)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                删除任务
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {tasks.length > 0 ? (
            <div className="flex flex-col items-stretch justify-between gap-3 rounded-lg border-2 border-border/60 bg-muted/20 px-3 py-2 sm:flex-row sm:items-center">
              <p className="text-center text-xs text-muted-foreground sm:text-left">
                共 {tasks.length} 个任务 · 每页 {TASK_PAGE_SIZE} 个
              </p>
              <div className="flex items-center justify-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentTaskPage <= 0}
                  onClick={() => setTaskPage((v) => Math.max(0, v - 1))}
                  aria-label="任务上一页"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[5.5rem] px-2 text-center text-sm tabular-nums text-muted-foreground">
                  第 {currentTaskPage + 1} / {totalTaskPages} 页
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentTaskPage >= totalTaskPages - 1}
                  onClick={() => setTaskPage((v) => Math.min(totalTaskPages - 1, v + 1))}
                  aria-label="任务下一页"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <Card className="w-full max-w-md border-border">
            <CardHeader>
              <CardTitle className="text-base">删除项目</CardTitle>
              <CardDescription>确认删除当前项目？该操作不可撤销。</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
              >
                取消
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteProject()} disabled={deleting}>
                {deleting ? "删除中..." : "确认删除"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {taskDeleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <Card className="w-full max-w-md border-border">
            <CardHeader>
              <CardTitle className="text-base">删除任务</CardTitle>
              <CardDescription>
                确认删除任务 “{taskDeleteTarget.name}”？该操作不可撤销。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTaskDeleteTarget(null)}>
                取消
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteTask()}>
                确认删除
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

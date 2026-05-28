import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { listProjects, readImageFile, type ProjectItem } from "@/lib/projects-api"
import { cn } from "@/lib/utils"
import { ArrowLeft, ArrowRight, Clock, FolderKanban } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

const PAGE_SIZE = 8
const THUMBNAIL_PATHS_KEY = "easyannotate:project-thumbnail-paths"

function guessImageMimeType(path: string): string {
  const normalized = path.trim().toLowerCase()
  if (normalized.endsWith(".png")) return "image/png"
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg"
  if (normalized.endsWith(".webp")) return "image/webp"
  if (normalized.endsWith(".bmp")) return "image/bmp"
  if (normalized.endsWith(".gif")) return "image/gif"
  if (normalized.endsWith(".tif") || normalized.endsWith(".tiff")) return "image/tiff"
  return "application/octet-stream"
}

function loadSavedThumbnailPaths(): Record<string, string> {
  try {
    const raw = localStorage.getItem(THUMBNAIL_PATHS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    const next: Record<string, string> = {}
    for (const [projectId, path] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof path !== "string") continue
      const trimmed = path.trim()
      if (!trimmed) continue
      next[projectId] = trimmed
    }
    return next
  } catch {
    return {}
  }
}

function formatUpdated(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export default function ProjectsMinePage() {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [projectCoverById, setProjectCoverById] = useState<Record<string, string>>({})
  const [manualThumbnailPathByProjectId, setManualThumbnailPathByProjectId] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const coverByIdRef = useRef<Record<string, string>>({})
  const [editingThumbnailProjectId, setEditingThumbnailProjectId] = useState<string | null>(null)
  const [editingThumbnailPath, setEditingThumbnailPath] = useState("")
  const [thumbnailDialogError, setThumbnailDialogError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void listProjects()
      .then((items) => {
        if (!alive) return
        setProjects(items)
      })
      .catch((e) => {
        if (!alive) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
      })
    return () => {
      alive = false
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const pagedProjects = useMemo(
    () => projects.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [currentPage, projects],
  )

  useEffect(() => {
    coverByIdRef.current = projectCoverById
  }, [projectCoverById])

  useEffect(() => {
    setManualThumbnailPathByProjectId(loadSavedThumbnailPaths())
  }, [])

  useEffect(() => {
    let alive = true
    let pendingUrls: string[] = []

    const targetPaths: Record<string, string> = {}
    for (const project of pagedProjects) {
      const p = (manualThumbnailPathByProjectId[project.id] || "").trim()
      if (p) targetPaths[project.id] = p
    }

    if (Object.keys(targetPaths).length === 0) {
      setProjectCoverById((prev) => {
        for (const url of Object.values(prev)) URL.revokeObjectURL(url)
        return {}
      })
      return () => {
        alive = false
      }
    }

    const loadProjectCovers = async () => {
      const next: Record<string, string> = {}
      // 串行加载当前页手动路径缩略图，避免并发读取导致压力骤增。
      for (const [projectId, imagePath] of Object.entries(targetPaths)) {
        if (!alive) break
        try {
          const imageResult = await readImageFile(imagePath)
          if (imageResult.errorMessage || !imageResult.content || imageResult.content.length === 0) continue

          const bytes = imageResult.content
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
          const objectUrl = URL.createObjectURL(new Blob([buffer], { type: guessImageMimeType(imagePath) }))
          next[projectId] = objectUrl
          pendingUrls.push(objectUrl)
        } catch {
          // ignore invalid manual path
        }
      }

      if (!alive) {
        for (const url of pendingUrls) URL.revokeObjectURL(url)
        pendingUrls = []
        return
      }
      setProjectCoverById((prev) => {
        for (const url of Object.values(prev)) URL.revokeObjectURL(url)
        return next
      })
      pendingUrls = []
    }
    void loadProjectCovers()

    return () => {
      alive = false
      for (const url of pendingUrls) URL.revokeObjectURL(url)
      pendingUrls = []
    }
  }, [pagedProjects, manualThumbnailPathByProjectId])

  useEffect(() => {
    return () => {
      const current = coverByIdRef.current
      for (const url of Object.values(current)) URL.revokeObjectURL(url)
    }
  }, [])

  function openThumbnailPathDialog(projectId: string) {
    setEditingThumbnailProjectId(projectId)
    setEditingThumbnailPath(manualThumbnailPathByProjectId[projectId] || "")
    setThumbnailDialogError(null)
  }

  function closeThumbnailPathDialog() {
    setEditingThumbnailProjectId(null)
    setEditingThumbnailPath("")
    setThumbnailDialogError(null)
  }

  function saveThumbnailPath() {
    const projectId = editingThumbnailProjectId
    if (!projectId) return
    const nextPath = editingThumbnailPath.trim()
    const nextMap = { ...manualThumbnailPathByProjectId }
    if (nextPath) {
      nextMap[projectId] = nextPath
    } else {
      delete nextMap[projectId]
    }
    setManualThumbnailPathByProjectId(nextMap)
    try {
      localStorage.setItem(THUMBNAIL_PATHS_KEY, JSON.stringify(nextMap))
    } catch {
      setThumbnailDialogError("保存失败：无法写入本地配置。")
      return
    }
    closeThumbnailPathDialog()
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-0">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Projects">
          <Link to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">我的项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">已创建项目列表，点击进入项目页</p>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          读取项目列表失败：{error}
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          还没有项目，先去创建一个吧。
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 pb-14">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {pagedProjects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/projects/${p.id}`}
                  className={cn(
                    "group block aspect-square rounded-lg border-2 border-border bg-card p-3 transition-colors",
                    "hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <div className="flex h-full flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex min-h-0 flex-1 flex-col">
                      <button
                        type="button"
                        className="flex min-h-0 flex-1 flex-col rounded-md border-2 border-border bg-muted/20 text-left transition-colors hover:bg-accent/20"
                        title="点击设置缩略图路径"
                        onClick={(e) => {
                          e.preventDefault()
                          openThumbnailPathDialog(p.id)
                        }}
                      >
                        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md">
                          {projectCoverById[p.id] ? (
                            <img
                              src={projectCoverById[p.id]}
                              alt={`${p.name} 缩略图`}
                              className="h-full w-full object-cover"
                              draggable={false}
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                      </button>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      <p className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden />
                        {formatUpdated(p.updatedAt)}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="absolute right-0 bottom-0 left-0 translate-y-1/2 rounded-lg border-2 border-border/60 bg-background/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
              <p className="text-center text-xs text-muted-foreground sm:text-left">
                共 {projects.length} 个项目 · 每页 {PAGE_SIZE} 个
              </p>
              <div className="flex items-center justify-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage <= 0}
                  onClick={() => setPage((v) => Math.max(0, v - 1))}
                  aria-label="上一页"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[5rem] px-2 text-center text-sm tabular-nums text-muted-foreground">
                  第 {currentPage + 1} / {totalPages} 页
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage((v) => Math.min(totalPages - 1, v + 1))}
                  aria-label="下一页"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editingThumbnailProjectId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-lg border-2 border-border bg-card p-4">
            <h2 className="text-base font-medium text-foreground">设置项目缩略图路径</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              输入本地图片完整路径（例如：D:\images\cover.jpg）。留空后保存可清除缩略图。
            </p>
            <div className="mt-3">
              <Input
                value={editingThumbnailPath}
                onChange={(e) => setEditingThumbnailPath(e.target.value)}
                placeholder="输入图片路径"
                spellCheck={false}
                autoFocus
              />
            </div>
            {thumbnailDialogError ? <p className="mt-2 text-xs text-destructive">{thumbnailDialogError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeThumbnailPathDialog}>
                取消
              </Button>
              <Button type="button" onClick={saveThumbnailPath}>
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

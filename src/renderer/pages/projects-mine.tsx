import { Button } from "@/components/ui/button"
import { loadImageObjectUrl, resolveProjectFirstImagePath } from "@/lib/auto-thumbnails"
import { listProjects, type ProjectItem } from "@/lib/projects-api"
import { loadTasks } from "@/lib/project-tasks-storage"
import { cn } from "@/lib/utils"
import { ArrowLeft, ArrowRight, Clock, FolderKanban } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

const PAGE_SIZE = 8

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
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const coverByIdRef = useRef<Record<string, string>>({})

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
    let alive = true
    let pendingUrls: string[] = []

    if (pagedProjects.length === 0) {
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
      for (const project of pagedProjects) {
        if (!alive) break
        const tasks = await loadTasks(project.id)
        const imagePath = await resolveProjectFirstImagePath(project.id, tasks)
        if (!imagePath) continue
        const objectUrl = await loadImageObjectUrl(imagePath)
        if (!objectUrl) continue
        next[project.id] = objectUrl
        pendingUrls.push(objectUrl)
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
  }, [pagedProjects])

  useEffect(() => {
    return () => {
      const current = coverByIdRef.current
      for (const url of Object.values(current)) URL.revokeObjectURL(url)
    }
  }, [])

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
          <p className="mt-1 text-sm text-muted-foreground">已创建项目列表，点击进入项目。</p>
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
        <div className="relative min-h-0 flex-1 pb-16">
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
                      <div className="flex min-h-0 flex-1 flex-col rounded-md border-2 border-border bg-muted/20">
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
                      </div>
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
    </div>
  )
}

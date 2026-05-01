import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { readTasks } from "@/lib/project-tasks-storage"
import { listExportJobs, listProjects, type ExportJobItem, type ProjectItem } from "@/lib/projects-api"
import { cn } from "@/lib/utils"
import {
  Activity,
  ArrowRight,
  Clock,
  FolderKanban,
  Layers,
  Loader2,
  PlayCircle,
  Plus,
  Upload,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

function formatDateTime(iso: string): string {
  if (!iso.trim()) return "—"
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

function projectSubtitle(p: ProjectItem): string {
  const info = p.projectInfo?.trim()
  if (info) {
    const first = info.split(/\r?\n/)[0]?.trim() ?? ""
    if (first) return first.length > 80 ? `${first.slice(0, 80)}…` : first
  }
  if (p.storageType === "local" && p.localPath.trim()) return p.localPath.trim()
  if (p.configFilePath.trim()) return p.configFilePath.trim()
  return "本地项目"
}

function aggregateTaskStats(projects: ProjectItem[]): { total: number; withImages: number } {
  let total = 0
  let withImages = 0
  for (const p of projects) {
    for (const t of readTasks(p.id)) {
      total += 1
      if (t.fileCount > 0) withImages += 1
    }
  }
  return { total, withImages }
}

function exportJobActivityLines(jobs: ExportJobItem[]): { icon: typeof Upload; text: string; time: string }[] {
  const sorted = [...jobs].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
  return sorted.slice(0, 6).map((job) => {
    const scope = job.taskId ? "任务导出" : "项目导出"
    const status = job.status || "unknown"
    const text = `${scope}「${job.versionName || "未命名版本"}」· ${(job.exportFormat || "format").toUpperCase()} — ${status}`
    return {
      icon: Upload,
      text,
      time: formatDateTime(job.updatedAt || job.createdAt),
    }
  })
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [exportJobs, setExportJobs] = useState<ExportJobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void Promise.all([listProjects(), listExportJobs()])
      .then(([projList, jobs]) => {
        if (!alive) return
        setProjects(projList)
        setExportJobs(jobs)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const recentProjects = useMemo(() => {
    return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
  }, [projects])

  const { projectCount, taskTotal, taskWithImages, imageTaskPercent } = useMemo(() => {
    const { total, withImages } = aggregateTaskStats(projects)
    const pct = total > 0 ? Math.round((withImages / total) * 100) : 0
    return {
      projectCount: projects.length,
      taskTotal: total,
      taskWithImages: withImages,
      imageTaskPercent: pct,
    }
  }, [projects])

  const resumeHref = useMemo(() => {
    for (const p of recentProjects) {
      const tasks = readTasks(p.id)
      if (tasks[0]) return `/projects/${p.id}/tasks/${tasks[0].id}`
    }
    for (const p of recentProjects) {
      return `/projects/${p.id}`
    }
    return "/projects/mine"
  }, [recentProjects])

  const activityLines = useMemo(() => exportJobActivityLines(exportJobs), [exportJobs])

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-6xl space-y-8 px-6 py-8 pb-12">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">工作台：本地项目、任务与最近导出。</p>
        </header>

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            加载失败：{error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className={cn("border-border", "lg:col-span-2")}>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg font-semibold">工作台</CardTitle>
                  <CardDescription className="mt-1.5">最近更新的项目与快捷入口</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="gap-1.5" asChild disabled={loading}>
                    <Link to={resumeHref}>
                      <PlayCircle className="h-4 w-4" aria-hidden />
                      继续标注
                    </Link>
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="gap-1.5" asChild>
                    <Link to="/projects/new">
                      <Plus className="h-4 w-4" aria-hidden />
                      新建项目
                    </Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">最近更新</p>
                <Link
                  to="/projects/mine"
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  我的项目
                </Link>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  正在加载项目…
                </div>
              ) : recentProjects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  还没有项目。
                  <Link to="/projects/new" className="ml-1 font-medium text-primary underline-offset-4 hover:underline">
                    创建一个
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-muted/20">
                  {recentProjects.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/projects/${p.id}`}
                        className={cn(
                          "flex items-center justify-between gap-3 px-4 py-3 transition-colors",
                          "first:rounded-t-lg last:rounded-b-lg",
                          "hover:bg-accent/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate font-medium text-foreground">{p.name}</span>
                          </div>
                          <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">{projectSubtitle(p)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" aria-hidden />
                          {formatDateTime(p.updatedAt)}
                          <ArrowRight className="h-3.5 w-3.5 opacity-40" aria-hidden />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6 lg:col-span-1">
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold">概览</CardTitle>
                <CardDescription>当前工作区快照</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Layers className="h-4 w-4" aria-hidden />
                      <span className="text-xs font-medium">项目数</span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                      {loading ? "—" : projectCount}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Activity className="h-4 w-4" aria-hidden />
                      <span className="text-xs font-medium">任务数</span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                      {loading ? "—" : taskTotal}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">任务已含图片</span>
                    <span className="tabular-nums text-foreground">
                      {loading ? "—" : `${imageTaskPercent}%`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-none"
                      style={{ width: loading ? "0%" : `${imageTaskPercent}%` }}
                      role="presentation"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {loading ? "…" : `含图片的任务 ${taskWithImages} / 共 ${taskTotal} 个`}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">最近导出</CardTitle>
                <CardDescription>
                  来自导出任务
                  <Link to="/events" className="ml-1 text-primary underline-offset-4 hover:underline">
                    Events
                  </Link>
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {loading ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    加载中…
                  </div>
                ) : activityLines.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">暂无导出记录。在项目导出页发起导出后会显示在这里。</p>
                ) : (
                  <ul className="space-y-0">
                    {activityLines.map((item, i) => (
                      <li key={`${item.text}-${item.time}-${i}`}>
                        {i > 0 ? <Separator className="my-3 bg-border/60" /> : null}
                        <div className="flex gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <item.icon className="h-4 w-4" aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-snug text-foreground">{item.text}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{item.time}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

import { Button } from "@/components/ui/button"
import { listExportJobs } from "@/lib/projects-api"
import { cn } from "@/lib/utils"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Activity, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

const PAGE_SIZE = 5

type EventTask = {
  id: string
  name: string
  /** 开始或最近更新时间，界面展示用 */
  timeLabel: string
  /** 0–100 */
  progress: number
  kind: "训练" | "导出" | "推理" | "工作流" | "同步"
}

function TaskRow({ task }: { task: EventTask }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/80 bg-card/80 p-3 shadow-sm",
        "transition-shadow hover:shadow-md",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground"
              title="任务类型（占位）"
            >
              {task.kind}
            </span>
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={task.name}>
              {task.name}
            </h2>
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            时间 <span className="text-foreground/80">{task.timeLabel}</span> · 进度 {Math.round(task.progress)}%
          </p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              aria-label="更多操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-card p-1 text-sm text-card-foreground shadow-md"
              sideOffset={4}
              align="end"
            >
              <DropdownMenu.Item
                className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                onSelect={() => {
                  /* 仅占位 */
                }}
              >
                查看详情
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                onSelect={() => {}}
              >
                取消任务
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-default select-none rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
                onSelect={() => {}}
              >
                重试
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="mt-2.5">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/90">
          <div
            className="h-full rounded-full bg-primary/90 transition-all"
            style={{ width: `${task.progress}%` }}
            role="progressbar"
            aria-valuenow={Math.round(task.progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${task.name} 进度`}
          />
        </div>
      </div>
    </div>
  )
}

export default function EventsPage() {
  const [page, setPage] = useState(0)
  const [tasks, setTasks] = useState<EventTask[]>([])

  useEffect(() => {
    let alive = true
    const tick = () => {
      void listExportJobs().then((jobs) => {
        if (!alive) return
        const next = jobs.map((job) => ({
          id: job.id,
          name: `${job.versionName || "Untitled Version"} · ${job.exportFormat}`,
          timeLabel: job.updatedAt || job.createdAt || "",
          progress: Number(job.progress || 0),
          kind: "导出" as const,
        }))
        setTasks(next)
        window.setTimeout(tick, 800)
      })
    }
    tick()
    return () => {
      alive = false
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE))
  const p = Math.min(page, totalPages - 1)
  const slice = useMemo(() => tasks.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE), [p, tasks])

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
        <header>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Activity className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Events</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                任务与运行事件条（时间、进度、更多操作）。当前显示导出任务实时进度。
              </p>
            </div>
          </div>
        </header>

        {slice.length > 0 ? (
          <ul className="space-y-3" aria-label="任务列表">
            {slice.map((task) => (
              <li key={task.id}>
                <TaskRow task={task} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            暂无导出事件。
          </p>
        )}

        <div className="flex flex-col items-stretch justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            共 {tasks.length} 条 · 每页 {PAGE_SIZE} 条
          </p>
          <div className="flex items-center justify-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={p <= 0}
              onClick={() => setPage((n) => Math.max(0, n - 1))}
              aria-label="上一页"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[4.5rem] px-2 text-center text-sm tabular-nums text-muted-foreground">
              第 {p + 1} / {totalPages} 页
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={p >= totalPages - 1}
              onClick={() => setPage((n) => Math.min(totalPages - 1, n + 1))}
              aria-label="下一页"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

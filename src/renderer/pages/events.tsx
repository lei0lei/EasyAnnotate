import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { Activity, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import { useState } from "react"

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

const MOCK_TASKS: EventTask[] = [
  { id: "1", name: "COCO 子集训练 — yolo11n", timeLabel: "2026-04-24 14:32:01", progress: 72, kind: "训练" },
  { id: "2", name: "导出 Pascal VOC 标注包", timeLabel: "2026-04-24 14:28:44", progress: 100, kind: "导出" },
  { id: "3", name: "产线 A 工作流批处理", timeLabel: "2026-04-24 14:15:09", progress: 35, kind: "工作流" },
  { id: "4", name: "自动标注 — 全量图像", timeLabel: "2026-04-24 14:10:00", progress: 8, kind: "推理" },
  { id: "5", name: "与云端项目同步", timeLabel: "2026-04-24 14:02:18", progress: 0, kind: "同步" },
  { id: "6", name: "半监督训练阶段二", timeLabel: "2026-04-24 13:55:40", progress: 45, kind: "训练" },
  { id: "7", name: "ONNX 导出", timeLabel: "2026-04-24 13:50:12", progress: 100, kind: "导出" },
  { id: "8", name: "夜间数据增强管线", timeLabel: "2026-04-24 13:40:00", progress: 88, kind: "工作流" },
  { id: "9", name: "测试集预标注", timeLabel: "2026-04-24 12:20:30", progress: 52, kind: "推理" },
  { id: "10", name: "S3 备份拉取", timeLabel: "2026-04-24 12:00:00", progress: 100, kind: "同步" },
  { id: "11", name: "小样本微调 yolo8s", timeLabel: "2026-04-24 11:45:00", progress: 19, kind: "训练" },
  { id: "12", name: "生成混淆矩阵报表", timeLabel: "2026-04-24 11:30:22", progress: 66, kind: "工作流" },
  { id: "13", name: "冷启动服务预热", timeLabel: "2026-04-24 10:00:00", progress: 100, kind: "同步" },
]

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
  const totalPages = Math.max(1, Math.ceil(MOCK_TASKS.length / PAGE_SIZE))
  const p = Math.min(page, totalPages - 1)
  const slice = MOCK_TASKS.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE)

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
                任务与运行事件条（时间、进度、更多操作）。数据为本地示例，分页为界面示意，不连接后端。
              </p>
            </div>
          </div>
        </header>

        <ul className="space-y-3" aria-label="任务列表">
          {slice.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} />
            </li>
          ))}
        </ul>

        <div className="flex flex-col items-stretch justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            共 {MOCK_TASKS.length} 条 · 每页 {PAGE_SIZE} 条
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

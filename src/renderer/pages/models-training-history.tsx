import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  fetchYoloTrainingHistory,
  probeBackendHealth,
  type YoloHistoryItem,
} from "@/lib/training-yolo-api"
import { cn } from "@/lib/utils"
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"

const HISTORY_PAGE_SIZE = 10

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "正在训练"
    case "success":
      return "已完成"
    case "failed":
      return "训练失败"
    case "prepared":
      return "已创建"
    case "idle":
      return "未开始"
    default:
      return status || "未知"
  }
}

function statusTagClass(status: string): string {
  switch (status) {
    case "running":
      return "border-primary/45 bg-primary/10 text-primary"
    case "success":
      return "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    case "failed":
      return "border-destructive/45 bg-destructive/10 text-destructive"
    default:
      return "border-border/70 bg-muted/40 text-muted-foreground"
  }
}

function HistoryTag({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs leading-none",
        className,
      )}
    >
      {children}
    </span>
  )
}

function displayProgress(item: YoloHistoryItem): number {
  if (item.status === "success") return 100
  if (item.status === "failed") {
    const p = item.progress ?? 0
    return p > 0 ? Math.max(0, Math.min(100, p)) : 0
  }
  return Math.max(0, Math.min(100, item.progress ?? 0))
}

function progressBarClass(status: string): string {
  if (status === "success") return "bg-emerald-500/90"
  if (status === "failed") return "bg-destructive/80"
  if (status === "running") return "bg-primary/90"
  return "bg-muted-foreground/40"
}

function HistoryProgressBar({ item }: { item: YoloHistoryItem }) {
  const progress = displayProgress(item)
  const epoch = item.epoch ?? 0
  const epochs = item.epochs ?? 0
  const epochText =
    epochs > 0 ? `第 ${epoch}/${epochs} 轮` : item.status === "running" ? "准备中…" : null

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{epochText ?? (item.status === "success" ? "训练完成" : "训练进度")}</span>
        <span className="tabular-nums">{progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/90">
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", progressBarClass(item.status))}
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  )
}

function HistoryListItem({ item }: { item: YoloHistoryItem }) {
  const modelName = item.model_label?.trim() || "未设置模型"
  const imgsz = item.imgsz && item.imgsz > 0 ? item.imgsz : null

  return (
    <Link
      to={`/models/training/history/${encodeURIComponent(item.job_slug)}`}
      className={cn(
        "block px-4 py-3.5 transition-colors hover:bg-muted/25",
        item.status === "running" && "bg-primary/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            <p className="max-w-[11rem] shrink-0 truncate text-base font-medium text-foreground sm:max-w-[14rem]">
              {item.display_name}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {imgsz ? (
                <HistoryTag className="border-border/70 bg-muted/40 text-foreground">{imgsz}</HistoryTag>
              ) : null}
              <HistoryTag
                className="max-w-[min(100%,12rem)] border-border/70 bg-muted/40 text-foreground"
                title={modelName}
              >
                <span className="truncate">{modelName}</span>
              </HistoryTag>
              <HistoryTag className={statusTagClass(item.status)}>{statusLabel(item.status)}</HistoryTag>
            </div>
          </div>

          <HistoryProgressBar item={item} />
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  )
}

export default function ModelsTrainingHistoryPage() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<YoloHistoryItem[]>([])
  const [page, setPage] = useState(1)

  const hasRunning = useMemo(() => items.some((i) => i.status === "running"), [items])
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / HISTORY_PAGE_SIZE)),
    [items.length],
  )
  const pageItems = useMemo(() => {
    const start = (page - 1) * HISTORY_PAGE_SIZE
    return items.slice(start, start + HISTORY_PAGE_SIZE)
  }, [items, page])

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  const loadHistory = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!backendOk) {
        setItems([])
        return
      }
      if (!opts?.silent) setInitialLoading(true)
      setError(null)
      void fetchYoloTrainingHistory()
        .then(setItems)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          if (!opts?.silent) setInitialLoading(false)
        })
    },
    [backendOk],
  )

  useEffect(() => {
    refreshBackend()
    const t = window.setInterval(refreshBackend, 2500)
    return () => window.clearInterval(t)
  }, [refreshBackend])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (!backendOk || !hasRunning) return
    const t = window.setInterval(() => loadHistory({ silent: true }), 1500)
    return () => window.clearInterval(t)
  }, [backendOk, hasRunning, loadHistory])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回模型训练">
          <Link to="/models/training">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">训练历史</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            扫描 <code className="text-xs">external/temp</code> 下的历次训练目录
            {hasRunning ? " · 进行中任务将自动刷新进度" : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!backendOk || initialLoading}
          onClick={() => loadHistory()}
        >
          刷新
        </Button>
      </div>

      {backendOk === false ? (
        <p className="text-sm text-destructive">后端未连接，无法读取训练历史。请先在设置中启动本地或连接远程后端。</p>
      ) : null}

      <Card className="border-border/80 shadow-sm">
        <CardContent className="p-0">
          {initialLoading && items.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在解析训练目录…
            </div>
          ) : error ? (
            <p className="px-4 py-8 text-sm text-destructive">{error}</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">暂无训练记录</p>
          ) : (
            <>
              <ul className="divide-y divide-border/60">
                {pageItems.map((item) => (
                  <li key={item.job_slug}>
                    <HistoryListItem item={item} />
                  </li>
                ))}
              </ul>
              {totalPages > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    共 {items.length} 条 · 第 {page} / {totalPages} 页
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              ) : items.length > 0 ? (
                <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
                  共 {items.length} 条
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

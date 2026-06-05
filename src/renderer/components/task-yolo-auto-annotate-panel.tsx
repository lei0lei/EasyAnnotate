import { Button } from "@/components/ui/button"
import { fetchYoloBatchModels, type YoloBatchModel } from "@/lib/yolo-batch-api"
import type { YoloAutoAnnotateProgress } from "@/lib/yolo-batch-auto-annotate"
import { cn } from "@/lib/utils"
import { Loader2, Play, Square, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

export type TaskYoloAutoAnnotatePanelProps = {
  open: boolean
  taskName: string
  progress: YoloAutoAnnotateProgress | null
  selectedModelSlug: string
  onSelectedModelSlugChange: (slug: string) => void
  skipAnnotated: boolean
  onSkipAnnotatedChange: (value: boolean) => void
  overwriteExisting: boolean
  onOverwriteExistingChange: (value: boolean) => void
  onClose: () => void
  onStart: () => void
  onStop: () => void
  /** 另有任务正在自动标注（全局仅允许一个） */
  otherTaskRunning?: boolean
  otherTaskName?: string
}

export function TaskYoloAutoAnnotatePanel({
  open,
  taskName,
  progress,
  selectedModelSlug,
  onSelectedModelSlugChange,
  skipAnnotated,
  onSkipAnnotatedChange,
  overwriteExisting,
  onOverwriteExistingChange,
  onClose,
  onStart,
  onStop,
  otherTaskRunning = false,
  otherTaskName = "",
}: TaskYoloAutoAnnotatePanelProps) {
  const [models, setModels] = useState<YoloBatchModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  const loadModels = useCallback(() => {
    setModelsLoading(true)
    void fetchYoloBatchModels()
      .then((items) => setModels(items.filter((m) => m.ready && m.running)))
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false))
  }, [])

  useEffect(() => {
    if (!open) return
    loadModels()
    const t = window.setInterval(loadModels, 3000)
    return () => window.clearInterval(t)
  }, [open, loadModels])

  useEffect(() => {
    if (models.length === 1 && !selectedModelSlug) {
      onSelectedModelSlugChange(models[0]!.model_slug)
    }
  }, [models, selectedModelSlug, onSelectedModelSlugChange])

  const running = progress?.phase === "running"
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0

  const progressLabel = useMemo(() => {
    if (!progress) return "尚未开始"
    if (progress.phase === "running") {
      if (progress.total <= 0 && progress.statusMessage) return progress.statusMessage
      return `${progress.done} / ${progress.total}`
    }
    if (progress.phase === "done") return progress.summaryMessage || `已完成 ${progress.done} / ${progress.total}`
    if (progress.phase === "cancelled") {
      return progress.summaryMessage || `已取消（${progress.done} / ${progress.total}）`
    }
    if (progress.phase === "error") return progress.errorMessage ?? "出错"
    return "尚未开始"
  }, [progress])

  if (!open) return null

  return (
    <div
      className="pointer-events-auto fixed bottom-6 right-6 z-[80] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card shadow-lg"
      role="dialog"
      aria-label={`${taskName} 自动标注`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/80 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">自动标注</p>
          <p className="truncate text-xs text-muted-foreground">{taskName}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="关闭面板（后台继续运行）"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center gap-2">
          <select
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            value={selectedModelSlug}
            onChange={(e) => onSelectedModelSlugChange(e.target.value)}
            disabled={running || modelsLoading}
            aria-label="选择 YOLO 模型"
          >
            <option value="">{modelsLoading ? "加载模型…" : "选择已启动的模型"}</option>
            {models.map((m) => (
              <option key={m.model_slug} value={m.model_slug}>
                {m.display_name} ({m.task})
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="icon"
            variant={running ? "outline" : "default"}
            className="shrink-0"
            disabled={!running && !selectedModelSlug}
            aria-label={running ? "停止自动标注" : "开始自动标注"}
            onClick={() => (running ? onStop() : onStart())}
          >
            {running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>

        {models.length === 0 && !modelsLoading ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            请先在「Models → YOLO 批量标注工具」中启动一个模型（绿点）。
          </p>
        ) : null}

        {otherTaskRunning && otherTaskName ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            当前「{otherTaskName}」正在自动标注。在此开始将中止该任务（全局同时仅允许一个自动标注）。
          </p>
        ) : null}

        <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-input"
              checked={skipAnnotated}
              disabled={running || overwriteExisting}
              onChange={(e) => onSkipAnnotatedChange(e.target.checked)}
            />
            跳过已有标注的图片
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-input"
              checked={overwriteExisting}
              disabled={running}
              onChange={(e) => onOverwriteExistingChange(e.target.checked)}
            />
            覆盖已有标注（用新结果替换）
          </label>
        </div>

        <p className="text-xs text-muted-foreground">
          推理在独立子进程中执行，每批 10 张图片，全程保持同一 WebSocket 连接。
        </p>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>进度</span>
            <span className="tabular-nums">{progressLabel}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                progress?.phase === "error" ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {progress?.summaryMessage && (progress.phase === "done" || progress.phase === "cancelled") ? (
          <p className="text-xs text-muted-foreground">{progress.summaryMessage}</p>
        ) : null}

        {progress?.phase === "running" && progress.currentFile ? (
          <p className="truncate text-[10px] text-muted-foreground" title={progress.currentFile}>
            {progress.currentFile.split(/[/\\]/).pop()}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** 任务行上紧凑进度（位于打开任务按钮左侧） */
export function TaskYoloAutoAnnotateBadge({ progress }: { progress: YoloAutoAnnotateProgress | null }) {
  if (!progress || progress.phase === "idle") return null
  const active = progress.phase === "running"
  const label =
    progress.total > 0 ? `${progress.done}/${progress.total}` : progress.phase === "error" ? "!" : "…"
  return (
    <span
      className={cn(
        "inline-flex min-w-[2.75rem] items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : progress.phase === "error"
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-border/70 bg-muted/50 text-muted-foreground",
      )}
      title={
        progress.phase === "error"
          ? progress.errorMessage ?? "自动标注失败"
          : `自动标注 ${progress.done} / ${progress.total}`
      }
    >
      {active ? <Loader2 className="mr-0.5 h-3 w-3 animate-spin" aria-hidden /> : null}
      {label}
    </span>
  )
}

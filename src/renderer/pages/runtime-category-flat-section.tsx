import { Button } from "@/components/ui/button"
import { formatBackendModelDisplayName, type RuntimeCategoryRow, type RuntimeVariantRow } from "@/lib/model-runtime-api"
import { GpuSwitch } from "@/pages/models-backend"
import { cn } from "@/lib/utils"
import { Check, Loader2, X } from "lucide-react"

export type RuntimeCategoryTaskToolbar = {
  enabled: boolean
  busy: boolean
  onChange: (v: boolean) => void
  /** A11y id for the toolbar enable switch */
  switchId?: string
}

export type RuntimeCategoryFlatSectionProps = {
  categoryId: string
  row: RuntimeCategoryRow
  selectedModelId: string
  onModelIdChange: (mid: string) => void
  useGpu: boolean
  onUseGpuChange: (v: boolean) => void
  busy: boolean
  testing: boolean
  testOutcome: "success" | "failure" | null
  onStart: () => void
  onStop: () => void
  onTest: () => void
  /** When set, an extra “启用/禁用” switch is shown and GPU/model/actions are locked while disabled */
  taskToolbar?: RuntimeCategoryTaskToolbar
  /** When true, always draw the top stack rule (use when this block is the only child but should follow other page content) */
  forceTopStackRule?: boolean
}

export function RuntimeCategoryFlatSection({
  categoryId,
  row,
  selectedModelId,
  onModelIdChange,
  useGpu,
  onUseGpuChange,
  busy,
  testing,
  testOutcome,
  onStart,
  onStop,
  onTest,
  taskToolbar,
  forceTopStackRule = false,
}: RuntimeCategoryFlatSectionProps) {
  const variantRow = row.variants.find((v) => v.model_id === selectedModelId)
  const assetsOk = variantRow?.assets_installed ?? false
  const locked = Boolean(taskToolbar && !taskToolbar.enabled)

  return (
    <section
      className={cn(
        "space-y-6 border-t border-border/80 pt-8",
        !forceTopStackRule && "first:border-t-0 first:pt-0",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 pb-4">
        <h2 className="text-lg font-semibold text-foreground">{row.label_zh}</h2>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium",
              row.running
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                : "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            {row.running ? "运行中" : "已停止"}
          </span>
          {row.running && row.active_use_gpu != null ? (
            <span className="text-xs text-muted-foreground">实例：{row.active_use_gpu ? "GPU" : "CPU"}</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-8 border-b border-border/80 pb-4">
        {taskToolbar ? (
          <GpuSwitch
            id={taskToolbar.switchId ?? `ea-runtime-task-toolbar-${categoryId}`}
            label={taskToolbar.enabled ? "启用" : "禁用"}
            checked={taskToolbar.enabled}
            disabled={taskToolbar.busy}
            onCheckedChange={(v) => void taskToolbar.onChange(v)}
          />
        ) : null}
        <GpuSwitch
          id={`ea-runtime-gpu-flat-${categoryId}`}
          label="GPU"
          checked={useGpu}
          disabled={busy || testing || row.running || locked}
          onCheckedChange={onUseGpuChange}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor={`ea-model-select-flat-${categoryId}`} className="text-sm font-medium text-foreground">
          模型
        </label>
        <select
          id={`ea-model-select-flat-${categoryId}`}
          aria-label={`${row.label_zh} 选择权重`}
          disabled={locked}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            locked && "cursor-not-allowed opacity-60",
          )}
          value={selectedModelId}
          onChange={(e) => onModelIdChange(e.target.value)}
        >
          {row.variants.map((v: RuntimeVariantRow) => (
            <option key={v.model_id} value={v.model_id}>
              {v.label.trim() ? v.label : formatBackendModelDisplayName(v.model_id)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy || testing || !assetsOk || locked} onClick={() => void onStart()}>
          启动
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || testing || !row.running} onClick={() => void onStop()}>
          停止
        </Button>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || testing || !assetsOk || !selectedModelId || locked}
            onClick={() => void onTest()}
          >
            {testing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            测试
          </Button>
          {testOutcome === "success" ? (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              title="测试成功"
              aria-label="测试成功"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </span>
          ) : null}
          {testOutcome === "failure" ? (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300"
              title="测试失败"
              aria-label="测试失败"
            >
              <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}

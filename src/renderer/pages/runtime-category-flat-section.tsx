import { Button } from "@/components/ui/button"
import { formatBackendModelDisplayName, type RuntimeCategoryRow, type RuntimeVariantRow } from "@/lib/model-runtime-api"
import { GpuSwitch } from "@/pages/models-backend"
import { cn } from "@/lib/utils"

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
  onStart: () => void
  onStop: () => void
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
  onStart,
  onStop,
  taskToolbar,
  forceTopStackRule = false,
}: RuntimeCategoryFlatSectionProps) {
  const variantRow = row.variants.find((v) => v.model_id === selectedModelId)
  const assetsOk = variantRow?.assets_installed ?? false
  const locked = Boolean(taskToolbar && !taskToolbar.enabled)
  const hasVariants = row.variants.length > 0

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
          disabled={busy || row.running || locked}
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
          {hasVariants ? (
            row.variants.map((v: RuntimeVariantRow) => (
              <option key={v.model_id} value={v.model_id}>
                {v.label.trim() ? v.label : formatBackendModelDisplayName(v.model_id)}
              </option>
            ))
          ) : (
            <option value="" disabled>
              无可用模型（请检查后端资源）
            </option>
          )}
        </select>
        {!hasVariants ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            当前后端未返回可用权重。请确认已在服务端放置 `external/resources` 模型文件，并重启后端后再刷新。
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy || !assetsOk || locked || !hasVariants} onClick={() => void onStart()}>
          启动
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || !row.running} onClick={() => void onStop()}>
          停止
        </Button>
      </div>
    </section>
  )
}

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  fetchModelRuntimeCatalog,
  formatBackendModelDisplayName,
  runModelSmokePredict,
  startModelRuntime,
  stopModelRuntime,
  type RuntimeCategoryRow,
  type RuntimeVariantRow,
} from "@/lib/model-runtime-api"
import { cn } from "@/lib/utils"
import { AlertCircle, Check, Loader2, Server, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

function GpuSwitch({
  id,
  checked,
  disabled,
  onCheckedChange,
  label,
}: {
  id: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (v: boolean) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span id={`${id}-label`} className="text-xs text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onCheckedChange(!checked)
        }}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "border-primary bg-primary" : "border-border bg-muted",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        )}
      >
        <span
          className={cn(
            "pointer-events-none absolute top-0.5 left-0.5 block h-5 w-5 rounded-full bg-background shadow-md ring-1 ring-black/5 transition-transform duration-200 dark:ring-white/10",
            checked ? "translate-x-[1.375rem]" : "translate-x-0",
          )}
          aria-hidden
        />
      </button>
    </div>
  )
}

function CategoryBoard({
  row,
  selectedModelId,
  onModelIdChange,
  useGpu,
  onUseGpuChange,
  busy,
  testing,
  onStart,
  onStop,
  onTest,
  testOutcome,
}: {
  row: RuntimeCategoryRow
  selectedModelId: string
  onModelIdChange: (modelId: string) => void
  useGpu: boolean
  onUseGpuChange: (v: boolean) => void
  busy: boolean
  testing: boolean
  testOutcome: "success" | "failure" | null
  onStart: () => void
  onStop: () => void
  onTest: () => void
}) {
  const variantRow = row.variants.find((v: RuntimeVariantRow) => v.model_id === selectedModelId)
  const assetsOk = variantRow?.assets_installed ?? false

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{row.label_zh}</CardTitle>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <GpuSwitch
              id={`ea-gpu-${row.id}`}
              label="GPU"
              checked={useGpu}
              disabled={busy || testing || row.running}
              onCheckedChange={onUseGpuChange}
            />
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
              <span className="text-[10px] text-muted-foreground">
                {row.active_use_gpu ? "实例：GPU" : "实例：CPU"}
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <select
            id={`ea-model-select-${row.id}`}
            aria-label={`${row.label_zh} 选择权重`}
            className={cn(
              "flex h-9 w-full max-w-xl rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy || testing || !assetsOk} onClick={() => void onStart()}>
            启动
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || testing || !row.running} onClick={() => void onStop()}>
            停止
          </Button>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" variant="secondary" disabled={busy || testing || !assetsOk || !selectedModelId} onClick={() => void onTest()}>
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
      </CardContent>
    </Card>
  )
}

export default function ModelsBackendPage() {
  const [rows, setRows] = useState<RuntimeCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testOutcomeByCategory, setTestOutcomeByCategory] = useState<Record<string, "success" | "failure" | null>>({})

  const [modelIdByCategory, setModelIdByCategory] = useState<Record<string, string>>({})
  const [useGpuByCategory, setUseGpuByCategory] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchModelRuntimeCatalog()
      setRows(data.categories)
      setModelIdByCategory((prev) => {
        const next = { ...prev }
        for (const c of data.categories) {
          const validIds = new Set(c.variants.map((v: RuntimeVariantRow) => v.model_id))
          const current = next[c.id]
          if (!current || !validIds.has(current)) {
            if (c.active_model_id && validIds.has(c.active_model_id)) {
              next[c.id] = c.active_model_id
            } else {
              next[c.id] = c.variants[0]?.model_id ?? ""
            }
          }
        }
        return next
      })
      setUseGpuByCategory((prev) => {
        const next = { ...prev }
        for (const c of data.categories) {
          if (c.running && c.active_use_gpu != null) {
            next[c.id] = c.active_use_gpu
          } else if (next[c.id] === undefined) {
            next[c.id] = true
          }
        }
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleStart = async (categoryId: string) => {
    const row = rows.find((r) => r.id === categoryId)
    const modelId = modelIdByCategory[categoryId] ?? row?.variants[0]?.model_id ?? ""
    if (!modelId) {
      window.alert("请选择有效模型")
      return
    }
    setBusyId(categoryId)
    try {
      const useGpu = useGpuByCategory[categoryId] ?? true
      await startModelRuntime(categoryId, modelId, useGpu)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusyId(null)
    }
  }

  const handleStop = async (categoryId: string) => {
    setBusyId(categoryId)
    try {
      await stopModelRuntime(categoryId)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "停止失败")
    } finally {
      setBusyId(null)
    }
  }

  const handleTest = async (categoryId: string) => {
    const row = rows.find((r) => r.id === categoryId)
    const modelId = modelIdByCategory[categoryId] ?? row?.variants[0]?.model_id ?? ""
    if (!modelId) {
      setTestOutcomeByCategory((prev) => ({ ...prev, [categoryId]: "failure" }))
      return
    }
    setTestingId(categoryId)
    setTestOutcomeByCategory((prev) => ({ ...prev, [categoryId]: null }))
    try {
      await runModelSmokePredict(modelId)
      setTestOutcomeByCategory((prev) => ({ ...prev, [categoryId]: "success" }))
    } catch {
      setTestOutcomeByCategory((prev) => ({ ...prev, [categoryId]: "failure" }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Server className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">后端模型管理</h1>
        </div>
      </div>

      {error ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">无法拉取模型运行目录</p>
            <p className="mt-1 text-destructive/90">{error}</p>
          </div>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <span>正在连接后端…</span>
        </div>
      ) : (
        <div className="grid gap-6">
          {rows.map((row) => (
            <CategoryBoard
              key={row.id}
              row={row}
              selectedModelId={modelIdByCategory[row.id] ?? row.variants[0]?.model_id ?? ""}
              onModelIdChange={(mid) => {
                setModelIdByCategory((prev) => ({ ...prev, [row.id]: mid }))
                setTestOutcomeByCategory((prev) => ({ ...prev, [row.id]: null }))
              }}
              useGpu={useGpuByCategory[row.id] ?? true}
              onUseGpuChange={(v) => {
                setUseGpuByCategory((prev) => ({ ...prev, [row.id]: v }))
              }}
              busy={busyId === row.id}
              testing={testingId === row.id}
              testOutcome={testOutcomeByCategory[row.id] ?? null}
              onStart={() => void handleStart(row.id)}
              onStop={() => void handleStop(row.id)}
              onTest={() => void handleTest(row.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

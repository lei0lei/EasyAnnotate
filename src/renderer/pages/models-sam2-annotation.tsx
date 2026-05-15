import { Button } from "@/components/ui/button"
import { getSam2AiToolbarEnabled, subscribeSam2AiToolbarEnabled } from "@/lib/sam2-ai-toolbar-prefs"
import { applySam2AiToolbarEnabled } from "@/lib/sam2-toolbar-enable-actions"
import {
  fetchModelRuntimeCatalog,
  formatBackendModelDisplayName,
  runModelSmokePredict,
  startModelRuntime,
  stopModelRuntime,
  type RuntimeCategoryRow,
  type RuntimeVariantRow,
} from "@/lib/model-runtime-api"
import { RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE } from "@/lib/model-runtime-ui-visibility"
import {
  formatActiveSamAnnotationLabel,
  isSamAnnotationCategoryId,
  persistSamAnnotationSelection,
  reconcileSamFamilyAndModelId,
  resolveActiveSamFromCatalog,
  stopOtherSamAnnotationRuntimes,
  type SamAnnotationCategoryId,
} from "@/lib/sam-annotation-runtime"
import {
  getSamAnnotationFamily,
  SAM_ANNOTATION_FAMILY_LABELS,
  setSamAnnotationFamily,
} from "@/lib/sam-annotation-prefs"
import { GpuSwitch } from "@/pages/models-backend"
import { cn } from "@/lib/utils"
import { AlertCircle, ArrowLeft, Check, Loader2, Scan, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

export default function ModelsSam2AnnotationPage() {
  const [rows, setRows] = useState<RuntimeCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOutcome, setTestOutcome] = useState<"success" | "failure" | null>(null)

  const [selectedFamily, setSelectedFamily] = useState<SamAnnotationCategoryId>(() => {
    const fam = getSamAnnotationFamily()
    return isSamAnnotationCategoryId(fam) ? fam : "sam2"
  })
  const [selectedModelId, setSelectedModelId] = useState("")
  const [useGpu, setUseGpu] = useState(true)

  const [sam2ToolbarEnabled, setSam2ToolbarEnabled] = useState(getSam2AiToolbarEnabled)
  const [sam2ToolbarBusy, setSam2ToolbarBusy] = useState(false)

  useEffect(() => {
    return subscribeSam2AiToolbarEnabled(() => setSam2ToolbarEnabled(getSam2AiToolbarEnabled()))
  }, [])

  const syncSelectionFromCatalog = useCallback((categories: RuntimeCategoryRow[]) => {
    const active = resolveActiveSamFromCatalog(categories)
    if (active) {
      setSelectedFamily(active.family)
      const row = categories.find((c) => c.id === active.family)
      setSelectedModelId(reconcileSamFamilyAndModelId(active.family, row))
      if (active.useGpu != null) setUseGpu(active.useGpu)
      return
    }
    const family = (() => {
      const fam = getSamAnnotationFamily()
      return isSamAnnotationCategoryId(fam) ? fam : "sam2"
    })()
    setSelectedFamily(family)
    const row = categories.find((c) => c.id === family)
    setSelectedModelId(reconcileSamFamilyAndModelId(family, row))
  }, [])

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchModelRuntimeCatalog()
      setRows(data.categories)
      syncSelectionFromCatalog(data.categories)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [syncSelectionFromCatalog])

  useEffect(() => {
    void load()
  }, [load])

  const activeSam = useMemo(() => resolveActiveSamFromCatalog(rows), [rows])

  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedFamily),
    [rows, selectedFamily],
  )

  const selectedVariant = useMemo(
    () => selectedRow?.variants.find((v) => v.model_id === selectedModelId),
    [selectedRow, selectedModelId],
  )

  const assetsOk = selectedVariant?.assets_installed ?? false
  const toolbarLocked = !sam2ToolbarEnabled

  const handleFamilyChange = (family: SamAnnotationCategoryId) => {
    setSelectedFamily(family)
    setSamAnnotationFamily(family)
    const row = rows.find((r) => r.id === family)
    setSelectedModelId(reconcileSamFamilyAndModelId(family, row))
    setTestOutcome(null)
  }

  const handleSam2ToolbarSwitch = useCallback(
    async (next: boolean) => {
      if (sam2ToolbarBusy) return
      setSam2ToolbarBusy(true)
      const r = await applySam2AiToolbarEnabled(next)
      setSam2ToolbarBusy(false)
      if (!r.ok) {
        window.alert(next ? `操作失败：${r.error ?? ""}` : `禁用时停止模型失败：${r.error ?? ""}`)
        return
      }
      setSam2ToolbarEnabled(getSam2AiToolbarEnabled())
      if (!next) void load()
    },
    [load, sam2ToolbarBusy],
  )

  const handleStart = async () => {
    const modelId = selectedModelId.trim()
    if (!modelId) {
      window.alert("请选择有效模型")
      return
    }
    setBusy(true)
    try {
      await stopOtherSamAnnotationRuntimes(selectedFamily)
      await startModelRuntime(selectedFamily, modelId, useGpu)
      persistSamAnnotationSelection(selectedFamily, modelId)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusy(false)
    }
  }

  const handleStop = async () => {
    const stopFamily = activeSam?.family ?? selectedFamily
    setBusy(true)
    try {
      await stopModelRuntime(stopFamily)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "停止失败")
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    const modelId = selectedModelId.trim()
    if (!modelId) {
      setTestOutcome("failure")
      return
    }
    setTesting(true)
    setTestOutcome(null)
    try {
      await runModelSmokePredict(modelId)
      setTestOutcome("success")
    } catch {
      setTestOutcome("failure")
    } finally {
      setTesting(false)
    }
  }

  const hasAnySamCategory = useMemo(
    () => RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE.some((id) => rows.some((r) => r.id === id)),
    [rows],
  )

  const activeLabel = useMemo(() => {
    if (!activeSam) return null
    return formatActiveSamAnnotationLabel(activeSam, rows)
  }, [activeSam, rows])

  const familyMismatch = activeSam != null && activeSam.family !== selectedFamily

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label="返回自动标注工具">
          <Link to="/models/auto">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Scan className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">自动标注</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">SAM 标注</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              选择 SAM 模型族与权重，同时仅运行一个推理实例；任务页自动使用此处已启动的模型。
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive",
          )}
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">无法连接后端</p>
            <p className="mt-1 text-destructive/90">{error}</p>
          </div>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <span>正在连接后端…</span>
        </div>
      ) : !hasAnySamCategory ? (
        <p className="text-sm text-muted-foreground">
          目录中未找到 SAM 2.1 / MobileSAM 分类，请检查后端 registry 与资源是否已下载。
        </p>
      ) : (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 pb-4">
            <h2 className="text-lg font-semibold text-foreground">SAM 标注后端</h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  activeSam
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                    : "border-border bg-muted/50 text-muted-foreground",
                )}
              >
                {activeSam ? "运行中" : "已停止"}
              </span>
              {activeSam && activeSam.useGpu != null ? (
                <span className="text-xs text-muted-foreground">实例：{activeSam.useGpu ? "GPU" : "CPU"}</span>
              ) : null}
            </div>
          </div>

          {activeLabel ? (
            <p className="text-sm text-muted-foreground">
              当前推理：<span className="font-medium text-foreground">{activeLabel}</span>
            </p>
          ) : null}

          {familyMismatch ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              已选择 {SAM_ANNOTATION_FAMILY_LABELS[selectedFamily]}，但当前运行的是{" "}
              {SAM_ANNOTATION_FAMILY_LABELS[activeSam!.family]}。点击「启动」将停止后者并切换。
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-8 border-b border-border/80 pb-4">
            <GpuSwitch
              id="ea-sam2-ai-toolbar-enabled-flat"
              label={sam2ToolbarEnabled ? "任务栏：启用" : "任务栏：禁用"}
              checked={sam2ToolbarEnabled}
              disabled={sam2ToolbarBusy}
              onCheckedChange={(v) => void handleSam2ToolbarSwitch(v)}
            />
            <GpuSwitch
              id="ea-sam-annotation-gpu"
              label="GPU"
              checked={useGpu}
              disabled={busy || testing || Boolean(activeSam) || toolbarLocked}
              onCheckedChange={setUseGpu}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="ea-sam-family-select" className="text-sm font-medium text-foreground">
              模型族
            </label>
            <select
              id="ea-sam-family-select"
              aria-label="SAM 模型族"
              disabled={toolbarLocked}
              className={cn(
                "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                toolbarLocked && "cursor-not-allowed opacity-60",
              )}
              value={selectedFamily}
              onChange={(e) => {
                const v = e.target.value
                if (isSamAnnotationCategoryId(v)) handleFamilyChange(v)
              }}
            >
              {RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE.map((family) => {
                const row = rows.find((r) => r.id === family)
                if (!row) return null
                return (
                  <option key={family} value={family}>
                    {SAM_ANNOTATION_FAMILY_LABELS[family]}
                  </option>
                )
              })}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="ea-sam-model-select" className="text-sm font-medium text-foreground">
              权重
            </label>
            <select
              id="ea-sam-model-select"
              aria-label="SAM 权重"
              disabled={toolbarLocked || !selectedRow}
              className={cn(
                "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                (toolbarLocked || !selectedRow) && "cursor-not-allowed opacity-60",
              )}
              value={selectedModelId}
              onChange={(e) => {
                setSelectedModelId(e.target.value)
                setTestOutcome(null)
              }}
            >
              {(selectedRow?.variants ?? []).map((v: RuntimeVariantRow) => (
                <option key={v.model_id} value={v.model_id}>
                  {v.label.trim() ? v.label : formatBackendModelDisplayName(v.model_id)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || testing || !assetsOk || toolbarLocked}
              onClick={() => void handleStart()}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              启动
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || testing || !activeSam}
              onClick={() => void handleStop()}
            >
              停止
            </Button>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || testing || !assetsOk || !selectedModelId || toolbarLocked}
                onClick={() => void handleTest()}
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
      )}
    </div>
  )
}

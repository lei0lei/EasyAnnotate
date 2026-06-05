/**
 * 后端模型管理：全局 SAM（sam2 / mobile_sam 互斥）与 DINOv2 启停。
 */
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getGlobalDinov2ModelId, setGlobalDinov2ModelId } from "@/lib/global-dinov2-prefs"
import { GLOBAL_DINOV2_RUNTIME_CATEGORY_ID } from "@/lib/global-dinov2-runtime"
import {
  fetchModelRuntimeCatalog,
  formatBackendModelDisplayName,
  startModelRuntime,
  stopModelRuntime,
  type RuntimeCategoryRow,
  type RuntimeVariantRow,
} from "@/lib/model-runtime-api"
import { GLOBAL_SAM_RUNTIME_CATEGORY_IDS } from "@/lib/model-runtime-ui-visibility"
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
  setSamAnnotationModelId,
} from "@/lib/sam-annotation-prefs"
import { GpuSwitch } from "@/pages/models-backend"
import { RuntimeCategoryFlatSection } from "@/pages/runtime-category-flat-section"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { Link } from "react-router-dom"

function SamGlobalRuntimeBlock({
  rows,
  onReload,
}: {
  rows: RuntimeCategoryRow[]
  onReload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [selectedFamily, setSelectedFamily] = useState<SamAnnotationCategoryId>(() => {
    const fam = getSamAnnotationFamily()
    return isSamAnnotationCategoryId(fam) ? fam : "sam2"
  })
  const [selectedModelId, setSelectedModelId] = useState("")
  const [useGpu, setUseGpu] = useState(true)

  const activeSam = useMemo(() => resolveActiveSamFromCatalog(rows), [rows])
  const selectedRow = useMemo(() => rows.find((r) => r.id === selectedFamily), [rows, selectedFamily])
  const selectedVariant = useMemo(
    () => selectedRow?.variants.find((v) => v.model_id === selectedModelId),
    [selectedRow, selectedModelId],
  )
  const hasVariants = (selectedRow?.variants.length ?? 0) > 0
  const assetsOk = selectedVariant?.assets_installed ?? false
  const familyMismatch = activeSam != null && activeSam.family !== selectedFamily
  const activeLabel = useMemo(() => {
    if (!activeSam) return null
    return formatActiveSamAnnotationLabel(activeSam, rows)
  }, [activeSam, rows])

  useEffect(() => {
    const hit = resolveActiveSamFromCatalog(rows)
    if (hit) {
      setSelectedFamily(hit.family)
      const row = rows.find((c) => c.id === hit.family)
      setSelectedModelId(reconcileSamFamilyAndModelId(hit.family, row))
      if (hit.useGpu != null) setUseGpu(hit.useGpu)
      return
    }
    const family = (() => {
      const fam = getSamAnnotationFamily()
      return isSamAnnotationCategoryId(fam) ? fam : "sam2"
    })()
    setSelectedFamily(family)
    const row = rows.find((c) => c.id === family)
    setSelectedModelId(reconcileSamFamilyAndModelId(family, row))
  }, [rows])

  const handleFamilyChange = (family: SamAnnotationCategoryId) => {
    setSelectedFamily(family)
    setSamAnnotationFamily(family)
    const row = rows.find((r) => r.id === family)
    const mid = reconcileSamFamilyAndModelId(family, row)
    setSelectedModelId(mid)
    setSamAnnotationModelId(family, mid)
  }

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
      await onReload()
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
      await onReload()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "停止失败")
    } finally {
      setBusy(false)
    }
  }

  const hasSamCategories = GLOBAL_SAM_RUNTIME_CATEGORY_IDS.some((id) => rows.some((r) => r.id === id))
  if (!hasSamCategories) {
    return (
      <p className="text-sm text-muted-foreground">
        目录中未找到 SAM 2.1 / MobileSAM 分类，请检查 registry 与权重是否已下载。
      </p>
    )
  }

  return (
    <section className="space-y-6 border-t border-border/80 pt-8 first:border-t-0 first:pt-0">
      <SamGlobalHeader activeSam={activeSam} familyMismatch={familyMismatch} selectedFamily={selectedFamily} />
      <p className="text-sm text-muted-foreground">
        全应用唯一 SAM 推理实例；SAM 标注、扩散式标注等工具共用。SAM 2.1 与 MobileSAM 同时仅可运行一个。
      </p>
      {activeLabel ? (
        <p className="text-sm text-muted-foreground">
          当前推理：<span className="font-medium text-foreground">{activeLabel}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-8 border-b border-border/80 pb-4">
        <GpuSwitch
          id="ea-global-sam-gpu"
          label="GPU"
          checked={useGpu}
          disabled={busy || Boolean(activeSam)}
          onCheckedChange={setUseGpu}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="ea-global-sam-family" className="text-sm font-medium text-foreground">
          模型族
        </label>
        <select
          id="ea-global-sam-family"
          disabled={busy}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            busy && "cursor-not-allowed opacity-60",
          )}
          value={selectedFamily}
          onChange={(e) => {
            const v = e.target.value
            if (isSamAnnotationCategoryId(v)) handleFamilyChange(v)
          }}
        >
          {GLOBAL_SAM_RUNTIME_CATEGORY_IDS.map((family) => {
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
        <label htmlFor="ea-global-sam-model" className="text-sm font-medium text-foreground">
          权重
        </label>
        <select
          id="ea-global-sam-model"
          disabled={busy || !selectedRow}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            (busy || !selectedRow) && "cursor-not-allowed opacity-60",
          )}
          value={selectedModelId}
          onChange={(e) => {
            setSelectedModelId(e.target.value)
            setSamAnnotationModelId(selectedFamily, e.target.value)
          }}
        >
          {hasVariants ? (
            (selectedRow?.variants ?? []).map((v: RuntimeVariantRow) => (
              <option key={v.model_id} value={v.model_id}>
                {v.label.trim() ? v.label : formatBackendModelDisplayName(v.model_id)}
              </option>
            ))
          ) : (
            <option value="" disabled>
              无可用权重（请检查后端资源）
            </option>
          )}
        </select>
        {!hasVariants ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            当前后端未返回 SAM 可用权重。请确认服务端 `external/resources` 已放置模型文件，并重启后端后刷新本页。
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy || !assetsOk || !hasVariants} onClick={() => void handleStart()}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          启动
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || !activeSam} onClick={() => void handleStop()}>
          停止
        </Button>
      </div>
    </section>
  )
}

function SamGlobalHeader({
  activeSam,
  familyMismatch,
  selectedFamily,
}: {
  activeSam: ReturnType<typeof resolveActiveSamFromCatalog>
  familyMismatch: boolean
  selectedFamily: SamAnnotationCategoryId
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 pb-4">
        <h2 className="text-lg font-semibold text-foreground">SAM（全局）</h2>
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
      {familyMismatch && activeSam ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          已选择 {SAM_ANNOTATION_FAMILY_LABELS[selectedFamily]}，但当前运行的是{" "}
          {SAM_ANNOTATION_FAMILY_LABELS[activeSam.family]}。点击「启动」将停止后者并切换。
        </p>
      ) : null}
    </>
  )
}

export function BackendGlobalRuntimePanel() {
  const [rows, setRows] = useState<RuntimeCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modelIdByCategory, setModelIdByCategory] = useState<Record<string, string>>({})
  const [useGpuByCategory, setUseGpuByCategory] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchModelRuntimeCatalog()
      setRows(data.categories)
      const dinoId = GLOBAL_DINOV2_RUNTIME_CATEGORY_ID
      const dinoRow = data.categories.find((c) => c.id === dinoId)
      if (dinoRow) {
        const validIds = new Set(dinoRow.variants.map((v) => v.model_id))
        const preferred = getGlobalDinov2ModelId()
        setModelIdByCategory((prev) => ({
          ...prev,
          [dinoId]:
            preferred && validIds.has(preferred)
              ? preferred
              : dinoRow.active_model_id && validIds.has(dinoRow.active_model_id)
                ? dinoRow.active_model_id
                : dinoRow.variants[0]?.model_id ?? "",
        }))
        setUseGpuByCategory((prev) => ({
          ...prev,
          [dinoId]: dinoRow.running && dinoRow.active_use_gpu != null ? dinoRow.active_use_gpu : (prev[dinoId] ?? true),
        }))
      }
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

  const dinoRow = rows.find((r) => r.id === GLOBAL_DINOV2_RUNTIME_CATEGORY_ID)
  const categoryId = GLOBAL_DINOV2_RUNTIME_CATEGORY_ID

  const handleDinoStart = async () => {
    const modelId = modelIdByCategory[categoryId] ?? dinoRow?.variants[0]?.model_id ?? ""
    if (!modelId) {
      window.alert("请选择有效模型")
      return
    }
    setBusyId(categoryId)
    try {
      await startModelRuntime(categoryId, modelId, useGpuByCategory[categoryId] ?? true)
      setGlobalDinov2ModelId(modelId)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "启动失败")
    } finally {
      setBusyId(null)
    }
  }

  const handleDinoStop = async () => {
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

  if (error) {
    return <BackendRuntimeError error={error} />
  }

  if (loading && rows.length === 0) {
    return <BackendRuntimeLoading />
  }

  return (
    <BackendRuntimePanelBody
      rows={rows}
      load={load}
      dinoRow={dinoRow}
      categoryId={categoryId}
      modelIdByCategory={modelIdByCategory}
      setModelIdByCategory={setModelIdByCategory}
      useGpuByCategory={useGpuByCategory}
      setUseGpuByCategory={setUseGpuByCategory}
      busyId={busyId}
      handleDinoStart={handleDinoStart}
      handleDinoStop={handleDinoStop}
    />
  )
}

function BackendRuntimeError({ error }: { error: string }) {
  void error
  return (
    <Card className={cn("border-border/80", "border-destructive/40")}>
      <CardContent className="flex items-center gap-2 py-4 text-sm">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span>后端未连接，请先在设置中启动本地或连接远程后端</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto" asChild>
          <Link to="/settings">设置</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function BackendRuntimeLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span>正在连接后端…</span>
    </div>
  )
}

function BackendRuntimePanelBody({
  rows,
  load,
  dinoRow,
  categoryId,
  modelIdByCategory,
  setModelIdByCategory,
  useGpuByCategory,
  setUseGpuByCategory,
  busyId,
  handleDinoStart,
  handleDinoStop,
}: {
  rows: RuntimeCategoryRow[]
  load: () => Promise<void>
  dinoRow: RuntimeCategoryRow | undefined
  categoryId: string
  modelIdByCategory: Record<string, string>
  setModelIdByCategory: Dispatch<SetStateAction<Record<string, string>>>
  useGpuByCategory: Record<string, boolean>
  setUseGpuByCategory: Dispatch<SetStateAction<Record<string, boolean>>>
  busyId: string | null
  handleDinoStart: () => void
  handleDinoStop: () => void
}) {
  return (
    <div className="space-y-8">
      <SamGlobalRuntimeBlock rows={rows} onReload={load} />
      {dinoRow ? (
        <>
          <p className="text-sm text-muted-foreground">
            全应用唯一 DINOv2 推理实例；扩散式标注等工具共用。
          </p>
          <RuntimeCategoryFlatSection
            categoryId={categoryId}
            row={dinoRow}
            forceTopStackRule
            selectedModelId={modelIdByCategory[categoryId] ?? dinoRow.variants[0]?.model_id ?? ""}
            onModelIdChange={(mid) => {
              setGlobalDinov2ModelId(mid)
              setModelIdByCategory((prev) => ({ ...prev, [categoryId]: mid }))
            }}
            useGpu={useGpuByCategory[categoryId] ?? true}
            onUseGpuChange={(v) => setUseGpuByCategory((prev) => ({ ...prev, [categoryId]: v }))}
            busy={busyId === categoryId}
            onStart={() => void handleDinoStart()}
            onStop={() => void handleDinoStop()}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground border-t border-border/80 pt-8">
          目录中未找到 DINOv2 分类，请检查 registry 与权重是否已下载。
        </p>
      )}
    </div>
  )
}

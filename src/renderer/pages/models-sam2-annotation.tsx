import { Button } from "@/components/ui/button"
import { getSam2AnnotationBackendModelId, setSam2AnnotationBackendModelId } from "@/lib/sam2-annotation-prefs"
import { getSam2AiToolbarEnabled, subscribeSam2AiToolbarEnabled } from "@/lib/sam2-ai-toolbar-prefs"
import { applySam2AiToolbarEnabled } from "@/lib/sam2-toolbar-enable-actions"
import {
  fetchModelRuntimeCatalog,
  runModelSmokePredict,
  startModelRuntime,
  stopModelRuntime,
  type RuntimeCategoryRow,
  type RuntimeVariantRow,
} from "@/lib/model-runtime-api"
import { RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE } from "@/lib/model-runtime-ui-visibility"
import { RuntimeCategoryFlatSection } from "@/pages/runtime-category-flat-section"
import { cn } from "@/lib/utils"
import { AlertCircle, ArrowLeft, Loader2, Scan } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

const SAM2_PAGE_CATEGORY_IDS = new Set<string>(RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE)

export default function ModelsSam2AnnotationPage() {
  const [rows, setRows] = useState<RuntimeCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testOutcomeByCategory, setTestOutcomeByCategory] = useState<Record<string, "success" | "failure" | null>>({})
  const [modelIdByCategory, setModelIdByCategory] = useState<Record<string, string>>({})
  const [useGpuByCategory, setUseGpuByCategory] = useState<Record<string, boolean>>({})

  const [sam2ToolbarEnabled, setSam2ToolbarEnabled] = useState(getSam2AiToolbarEnabled)
  const [sam2ToolbarBusy, setSam2ToolbarBusy] = useState(false)

  useEffect(() => {
    return subscribeSam2AiToolbarEnabled(() => setSam2ToolbarEnabled(getSam2AiToolbarEnabled()))
  }, [])

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchModelRuntimeCatalog()
      setRows(data.categories)
      setModelIdByCategory((prev) => {
        const next = { ...prev }
        for (const c of data.categories) {
          if (!SAM2_PAGE_CATEGORY_IDS.has(c.id)) continue
          const validIds = new Set(c.variants.map((v: RuntimeVariantRow) => v.model_id))
          const current = next[c.id]
          if (c.id === "sam2") {
            if (current && validIds.has(current)) continue
            const stored = getSam2AnnotationBackendModelId()?.trim()
            if (stored && validIds.has(stored)) {
              next[c.id] = stored
            } else if (c.active_model_id && validIds.has(c.active_model_id)) {
              next[c.id] = c.active_model_id
            } else {
              next[c.id] = c.variants[0]?.model_id ?? ""
            }
          } else {
            if (current && validIds.has(current)) continue
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
          if (!SAM2_PAGE_CATEGORY_IDS.has(c.id)) continue
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

  const handleStart = async (categoryId: string) => {
    const row = rows.find((r) => r.id === categoryId)
    const modelId = modelIdByCategory[categoryId] ?? row?.variants[0]?.model_id ?? ""
    if (!modelId) {
      window.alert("请选择有效模型")
      return
    }
    if (categoryId === "sam2") {
      setSam2AnnotationBackendModelId(modelId)
    }
    setBusyId(categoryId)
    try {
      const ug = useGpuByCategory[categoryId] ?? true
      await startModelRuntime(categoryId, modelId, ug)
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

  const hasAnySam2PageCategory = useMemo(
    () => RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE.some((id) => rows.some((r) => r.id === id)),
    [rows],
  )

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
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">SAM2 标注</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              配置 SAM 2.1、MobileSAM、EfficientSAM 的后端权重与推理实例；任务页 SAM2 编码使用此处为 SAM2 保存的模型 ID。
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
      ) : !hasAnySam2PageCategory ? (
        <p className="text-sm text-muted-foreground">
          目录中未找到 SAM 2.1 / MobileSAM / EfficientSAM 分类，请检查后端 registry 与资源是否已下载。
        </p>
      ) : (
        <div className="space-y-2">
          {RUNTIME_CATEGORY_ORDER_ON_SAM2_ANNOTATION_PAGE.map((categoryId) => {
            const row = rows.find((r) => r.id === categoryId)
            if (!row) {
              const label =
                categoryId === "sam2"
                  ? "SAM 2.1"
                  : categoryId === "mobile_sam"
                    ? "MobileSAM"
                    : "EfficientSAM"
              return (
                <p key={categoryId} className="text-sm text-muted-foreground">
                  未在目录中找到「{label}」分类（可能未注册或权重文件未就绪）。
                </p>
              )
            }
            const selectedModelId = modelIdByCategory[categoryId] ?? row.variants[0]?.model_id ?? ""
            const isSam2 = categoryId === "sam2"
            return (
              <RuntimeCategoryFlatSection
                key={categoryId}
                categoryId={categoryId}
                row={row}
                selectedModelId={selectedModelId}
                onModelIdChange={(mid) => {
                  if (isSam2) setSam2AnnotationBackendModelId(mid)
                  setModelIdByCategory((prev) => ({ ...prev, [categoryId]: mid }))
                  setTestOutcomeByCategory((prev) => ({ ...prev, [categoryId]: null }))
                }}
                useGpu={useGpuByCategory[categoryId] ?? true}
                onUseGpuChange={(v) => setUseGpuByCategory((prev) => ({ ...prev, [categoryId]: v }))}
                busy={busyId === categoryId}
                testing={testingId === categoryId}
                testOutcome={testOutcomeByCategory[categoryId] ?? null}
                onStart={() => void handleStart(categoryId)}
                onStop={() => void handleStop(categoryId)}
                onTest={() => void handleTest(categoryId)}
                taskToolbar={
                  isSam2
                    ? {
                        enabled: sam2ToolbarEnabled,
                        busy: sam2ToolbarBusy,
                        onChange: (v) => void handleSam2ToolbarSwitch(v),
                        switchId: "ea-sam2-ai-toolbar-enabled-flat",
                      }
                    : undefined
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

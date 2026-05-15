import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { diffusionAiToolbarPrefs, trackingAiToolbarPrefs } from "@/lib/placeholder-ai-toolbar-prefs"
import {
  fetchModelRuntimeCatalog,
  runModelSmokePredict,
  startModelRuntime,
  stopModelRuntime,
  type RuntimeCategoryRow,
  type RuntimeVariantRow,
} from "@/lib/model-runtime-api"
import { RUNTIME_CATEGORY_ORDER_ON_DIFFUSION_ANNOTATION_PAGE } from "@/lib/model-runtime-ui-visibility"
import { GpuSwitch } from "@/pages/models-backend"
import { RuntimeCategoryFlatSection } from "@/pages/runtime-category-flat-section"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import { AlertCircle, ArrowLeft, Loader2, Sparkles, Video } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"

const DINOV2_PAGE_CATEGORY_IDS = new Set<string>(RUNTIME_CATEGORY_ORDER_ON_DIFFUSION_ANNOTATION_PAGE)

type PrefsBinding = {
  getEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
  subscribe: (onChange: () => void) => () => void
}

type PlaceholderSlug = "diffusion" | "tracking"

const META: Record<
  PlaceholderSlug,
  { prefs: PrefsBinding; title: string; lead: string; body: string; Icon: LucideIcon }
> = {
  diffusion: {
    prefs: diffusionAiToolbarPrefs,
    title: "扩散式标注",
    lead: "基于扩散模型的辅助标注、提示词与输出格式等将在此配置；与任务页工具栏联动。同页平铺：工具栏开关、DINOv2 权重与推理实例。",
    body: "扩散管线与落盘流程尚在接入；可先启动 DINOv2 推理实例。开启「启用」后可在任务页看到对应工具按钮。",
    Icon: Sparkles,
  },
  tracking: {
    prefs: trackingAiToolbarPrefs,
    title: "跟踪标注",
    lead: "时序 / 视频目标跟踪与关键帧传播等将在此配置；与任务页工具栏入口联动。",
    body: "当前为占位：跟踪管线与画布交互尚在规划中。",
    Icon: Video,
  },
}

function isPlaceholderSlug(value: string | undefined): value is PlaceholderSlug {
  return value === "diffusion" || value === "tracking"
}

function DiffusionDinov2RuntimePanel() {
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
          if (!DINOV2_PAGE_CATEGORY_IDS.has(c.id)) continue
          const validIds = new Set(c.variants.map((v: RuntimeVariantRow) => v.model_id))
          const current = next[c.id]
          if (current && validIds.has(current)) continue
          if (c.active_model_id && validIds.has(c.active_model_id)) {
            next[c.id] = c.active_model_id
          } else {
            next[c.id] = c.variants[0]?.model_id ?? ""
          }
        }
        return next
      })
      setUseGpuByCategory((prev) => {
        const next = { ...prev }
        for (const c of data.categories) {
          if (!DINOV2_PAGE_CATEGORY_IDS.has(c.id)) continue
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

  const hasDinov2Category = useMemo(
    () => RUNTIME_CATEGORY_ORDER_ON_DIFFUSION_ANNOTATION_PAGE.some((id) => rows.some((r) => r.id === id)),
    [rows],
  )

  return (
    <div className="space-y-8">
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
      ) : !hasDinov2Category ? (
        <p className="text-sm text-muted-foreground">
          目录中未找到 DINOv2 分类，请检查后端 registry 与 <code className="rounded bg-muted px-1 py-0.5 text-xs">dinov2/</code>{" "}
          权重是否已下载。
        </p>
      ) : (
        <div className="space-y-2">
          {RUNTIME_CATEGORY_ORDER_ON_DIFFUSION_ANNOTATION_PAGE.map((categoryId) => {
            const row = rows.find((r) => r.id === categoryId)
            if (!row) {
              return (
                <p key={categoryId} className="text-sm text-muted-foreground">
                  未在目录中找到「DINOv2」分类（可能未注册或权重文件未就绪）。
                </p>
              )
            }
            const selectedModelId = modelIdByCategory[categoryId] ?? row.variants[0]?.model_id ?? ""
            return (
              <RuntimeCategoryFlatSection
                key={categoryId}
                categoryId={categoryId}
                row={row}
                forceTopStackRule
                selectedModelId={selectedModelId}
                onModelIdChange={(mid) => {
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
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ModelsPlaceholderAnnotationPage() {
  const { placeholderSlug } = useParams<{ placeholderSlug: string }>()
  const slug = placeholderSlug?.trim() ?? ""

  const meta = useMemo(() => (isPlaceholderSlug(slug) ? META[slug] : null), [slug])

  const [toolbarEnabled, setToolbarEnabled] = useState(() => meta?.prefs.getEnabled() ?? false)

  useEffect(() => {
    if (!meta) return
    setToolbarEnabled(meta.prefs.getEnabled())
    return meta.prefs.subscribe(() => setToolbarEnabled(meta.prefs.getEnabled()))
  }, [meta])

  if (!meta) {
    return <Navigate to="/models/auto" replace />
  }

  const Icon = meta.Icon

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label="返回自动标注工具">
          <Link to="/models/auto">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">自动标注</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{meta.title}</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{meta.lead}</p>
          </div>
        </div>
      </div>

      {slug === "diffusion" ? (
        <div className="space-y-8">
          <section className="space-y-6 border-t border-border/80 pt-8 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 pb-4">
              <h2 className="text-lg font-semibold text-foreground">任务页工具栏</h2>
            </div>
            <div className="flex flex-wrap items-center gap-8 border-b border-border/80 pb-4">
              <GpuSwitch
                id={`ea-placeholder-ai-toolbar-${slug}`}
                label={toolbarEnabled ? "启用" : "禁用"}
                checked={toolbarEnabled}
                onCheckedChange={(v) => {
                  meta.prefs.setEnabled(v)
                  setToolbarEnabled(meta.prefs.getEnabled())
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              关闭「启用」后任务页左侧 AI 工具栏将隐藏本工具入口（与 SAM2 开关行为一致）。
            </p>
            <p className="text-sm text-muted-foreground">{meta.body}</p>
          </section>
          <DiffusionDinov2RuntimePanel />
        </div>
      ) : (
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base">任务页工具栏</CardTitle>
                <CardDescription className="mt-1">
                  关闭后任务页左侧 AI 工具栏将隐藏本工具的入口（与 SAM2 开关行为一致）。
                </CardDescription>
              </div>
              <GpuSwitch
                id={`ea-placeholder-ai-toolbar-${slug}`}
                label={toolbarEnabled ? "启用" : "禁用"}
                checked={toolbarEnabled}
                onCheckedChange={(v) => {
                  meta.prefs.setEnabled(v)
                  setToolbarEnabled(meta.prefs.getEnabled())
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{meta.body}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

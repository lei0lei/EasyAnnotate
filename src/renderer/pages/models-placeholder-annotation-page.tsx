import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { GlobalRuntimeStatusSection } from "@/components/global-runtime-status-section"
import { diffusionAiToolbarPrefs, trackingAiToolbarPrefs } from "@/lib/placeholder-ai-toolbar-prefs"
import { GpuSwitch } from "@/pages/models-backend"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import { ArrowLeft, Sparkles, Video } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"

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
    lead: "配置任务页工具栏开关；SAM 与 DINOv2 使用「后端模型管理」中的全局推理实例。",
    body: "相似检索与画布扩散流程仍在接入；请先在「后端模型管理」中启动全局 SAM 与 DINOv2。",
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
          <ToolPageIcon Icon={Icon} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">自动标注</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{meta.title}</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{meta.lead}</p>
          </div>
        </div>
      </div>
      {slug === "diffusion" ? (
        <>
          <ToolbarToggleSection
            enabled={toolbarEnabled}
            switchId="ea-diffusion-ai-toolbar"
            onChange={(v) => {
              meta.prefs.setEnabled(v)
              setToolbarEnabled(meta.prefs.getEnabled())
            }}
            body={meta.body}
          />
          <GlobalRuntimeStatusSection showDinov2 />
        </>
      ) : (
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <TrackingToolbarHeader
              toolbarEnabled={toolbarEnabled}
              meta={meta}
              setToolbarEnabled={setToolbarEnabled}
            />
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>{meta.body}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ToolPageIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary")}>
      <Icon className="h-5 w-5" aria-hidden />
    </div>
  )
}

function TrackingToolbarHeader({
  toolbarEnabled,
  meta,
  setToolbarEnabled,
}: {
  toolbarEnabled: boolean
  meta: (typeof META)["tracking"]
  setToolbarEnabled: (v: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <CardTitle className="text-base">任务页工具栏</CardTitle>
        <CardDescription className="mt-1">关闭后任务页左侧 AI 工具栏将隐藏本工具入口。</CardDescription>
      </div>
      <GpuSwitch
        id="ea-tracking-ai-toolbar"
        label={toolbarEnabled ? "启用" : "禁用"}
        checked={toolbarEnabled}
        onCheckedChange={(v) => {
          meta.prefs.setEnabled(v)
          setToolbarEnabled(meta.prefs.getEnabled())
        }}
      />
    </div>
  )
}

function ToolbarToggleSection({
  enabled,
  switchId,
  onChange,
  body,
}: {
  enabled: boolean
  switchId: string
  onChange: (v: boolean) => void
  body: string
}) {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 pb-4">
        <h2 className="text-lg font-semibold text-foreground">任务页工具栏</h2>
        <GpuSwitch id={switchId} label={enabled ? "启用" : "禁用"} checked={enabled} onCheckedChange={onChange} />
      </div>
      <p className="text-sm text-muted-foreground">
        关闭「启用」后任务页左侧 AI 工具栏将隐藏本工具入口。关闭工具栏不会停止全局推理实例。
      </p>
      <p className="text-sm text-muted-foreground">{body}</p>
    </section>
  )
}

import { Button } from "@/components/ui/button"
import { GlobalRuntimeStatusSection } from "@/components/global-runtime-status-section"
import { getSam2AiToolbarEnabled, subscribeSam2AiToolbarEnabled } from "@/lib/sam2-ai-toolbar-prefs"
import { applySam2AiToolbarEnabled } from "@/lib/sam2-toolbar-enable-actions"
import { GpuSwitch } from "@/pages/models-backend"
import { cn } from "@/lib/utils"
import { ArrowLeft, Scan } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

export default function ModelsSam2AnnotationPage() {
  const [sam2ToolbarEnabled, setSam2ToolbarEnabled] = useState(getSam2AiToolbarEnabled)
  const [sam2ToolbarBusy, setSam2ToolbarBusy] = useState(false)

  useEffect(() => {
    return subscribeSam2AiToolbarEnabled(() => setSam2ToolbarEnabled(getSam2AiToolbarEnabled()))
  }, [])

  const handleSam2ToolbarSwitch = useCallback(async (next: boolean) => {
    if (sam2ToolbarBusy) return
    setSam2ToolbarBusy(true)
    const r = await applySam2AiToolbarEnabled(next)
    setSam2ToolbarBusy(false)
    if (!r.ok) {
      window.alert(r.error ?? "操作失败")
      return
    }
    setSam2ToolbarEnabled(getSam2AiToolbarEnabled())
  }, [sam2ToolbarBusy])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8 pb-12">
      <SamAnnotationPageHeader />
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 pb-4">
          <h2 className="text-lg font-semibold text-foreground">任务页工具栏</h2>
          <GpuSwitch
            id="ea-sam2-ai-toolbar-enabled"
            label={sam2ToolbarEnabled ? "启用" : "禁用"}
            checked={sam2ToolbarEnabled}
            disabled={sam2ToolbarBusy}
            onCheckedChange={(v) => void handleSam2ToolbarSwitch(v)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          关闭后任务页左侧 AI 工具栏将隐藏 SAM 标注入口。关闭工具栏不会停止全局 SAM 推理实例。
        </p>
      </section>
      <GlobalRuntimeStatusSection showDinov2={false} />
    </div>
  )
}

function SamAnnotationPageHeader() {
  return (
    <div className="flex items-start gap-3">
      <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label="返回自动标注工具">
        <Link to="/models/auto">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="flex items-start gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary")}>
          <Scan className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">自动标注</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">SAM 标注</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            任务页使用「后端模型管理」中已启动的全局 SAM 实例；此处仅配置工具栏开关并查看连接状态。
          </p>
        </div>
      </div>
    </div>
  )
}

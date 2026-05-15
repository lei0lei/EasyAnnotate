import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getSam2AiToolbarEnabled, subscribeSam2AiToolbarEnabled } from "@/lib/sam2-ai-toolbar-prefs"
import {
  diffusionAiToolbarPrefs,
  getPlaceholderAiToolbarsSnapshot,
  subscribeAllPlaceholderAiToolbars,
  trackingAiToolbarPrefs,
} from "@/lib/placeholder-ai-toolbar-prefs"
import { applySam2AiToolbarEnabled } from "@/lib/sam2-toolbar-enable-actions"
import { GpuSwitch } from "@/pages/models-backend"
import { ArrowLeft, Scan, Sparkles, Video } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

export default function ModelsAutoPage() {
  const [sam2ToolbarEnabled, setSam2ToolbarEnabled] = useState(getSam2AiToolbarEnabled)
  const [sam2ToolbarBusy, setSam2ToolbarBusy] = useState(false)

  const [phToolbar, setPhToolbar] = useState(getPlaceholderAiToolbarsSnapshot)

  useEffect(() => {
    return subscribeSam2AiToolbarEnabled(() => setSam2ToolbarEnabled(getSam2AiToolbarEnabled()))
  }, [])

  useEffect(() => {
    return subscribeAllPlaceholderAiToolbars(() => setPhToolbar(getPlaceholderAiToolbarsSnapshot()))
  }, [])

  const handleSam2ToolbarSwitch = async (next: boolean) => {
    if (sam2ToolbarBusy) return
    setSam2ToolbarBusy(true)
    const r = await applySam2AiToolbarEnabled(next)
    setSam2ToolbarBusy(false)
    if (!r.ok) {
      window.alert(next ? `操作失败：${r.error ?? ""}` : `禁用时停止模型失败：${r.error ?? ""}`)
      return
    }
    setSam2ToolbarEnabled(getSam2AiToolbarEnabled())
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label="返回 Models">
          <Link to="/models">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">自动标注工具</h1>
            <p className="mt-1 text-sm text-muted-foreground">选择要配置的自动标注工具，每个工具单独管理后端模型与运行状态。</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Scan className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <CardTitle className="text-lg">SAM2 标注</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  官方 SAM2.1 权重、启动 / 停止 / 测试，与任务页 SAM2 编码请求对齐。
                </CardDescription>
              </div>
              <GpuSwitch
                id="ea-sam2-ai-toolbar-auto-home"
                label={sam2ToolbarEnabled ? "启用" : "禁用"}
                checked={sam2ToolbarEnabled}
                disabled={sam2ToolbarBusy}
                onCheckedChange={(v) => void handleSam2ToolbarSwitch(v)}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary" size="sm">
              <Link to="/models/annotation/sam2">进入配置</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <CardTitle className="text-lg">扩散式标注</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  与任务页左侧 AI 工具栏「扩散式标注」入口对应；开启后栏内显示，能力规划中。
                </CardDescription>
              </div>
              <GpuSwitch
                id="ea-diffusion-ai-toolbar-auto-home"
                label={phToolbar.diffusion ? "启用" : "禁用"}
                checked={phToolbar.diffusion}
                onCheckedChange={(v) => {
                  diffusionAiToolbarPrefs.setEnabled(v)
                  setPhToolbar(getPlaceholderAiToolbarsSnapshot())
                }}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary" size="sm">
              <Link to="/models/annotation/diffusion">进入配置</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Video className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <CardTitle className="text-lg">跟踪标注</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  与任务页左侧 AI 工具栏「跟踪标注」入口对应；开启后栏内显示，能力规划中。
                </CardDescription>
              </div>
              <GpuSwitch
                id="ea-tracking-ai-toolbar-auto-home"
                label={phToolbar.tracking ? "启用" : "禁用"}
                checked={phToolbar.tracking}
                onCheckedChange={(v) => {
                  trackingAiToolbarPrefs.setEnabled(v)
                  setPhToolbar(getPlaceholderAiToolbarsSnapshot())
                }}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary" size="sm">
              <Link to="/models/annotation/tracking">进入配置</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

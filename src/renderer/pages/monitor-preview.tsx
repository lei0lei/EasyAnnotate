import { MonitorOutputSection } from "@/components/monitor-output-section"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getMonitor } from "@/lib/monitors-storage"
import { loadWorkflowBoards } from "@/lib/workflows-storage"
import { cn } from "@/lib/utils"
import { ArrowLeft, Pencil, Radio } from "lucide-react"
import { useMemo } from "react"
import { Link, Navigate, useParams } from "react-router-dom"

export default function MonitorPreviewPage() {
  const { monitorId } = useParams<{ monitorId: string }>()
  const item = useMemo(() => (monitorId ? getMonitor(monitorId) : undefined), [monitorId])
  const boards = useMemo(() => loadWorkflowBoards(), [])

  if (!monitorId) {
    return <Navigate to="/monitor" replace />
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">未找到该监视项，可能已被删除。</p>
        <Button asChild variant="outline">
          <Link to="/monitor">返回看板</Link>
        </Button>
      </div>
    )
  }

  const linkedBoard = boards.find((b) => b.id === item.linkedWorkflowId)
  const linkedName = linkedBoard ? linkedBoard.name : "— 不关联 —"

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8 pb-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Monitor 看板">
              <Link to="/monitor">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">预览</p>
              <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-foreground">
                {item.name}
              </h1>
            </div>
          </div>
          <Button asChild className="gap-1.5">
            <Link to={`/monitor/${monitorId}`}>
              <Pencil className="h-4 w-4" aria-hidden />
              去编辑
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">只读展示当前保存的配置与运行输出占位，不可在此修改。</p>

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-muted-foreground" aria-hidden />
                <CardTitle className="text-lg">监视配置</CardTitle>
              </div>
              <CardDescription>只读</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">监视名称</span>
                <Input readOnly value={item.name} className="bg-muted/40" tabIndex={-1} />
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">关联工作流</span>
                <div
                  className={cn(
                    "flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm",
                    "text-foreground/90",
                  )}
                >
                  {linkedName}
                </div>
                {linkedBoard ? (
                  <p className="text-xs text-muted-foreground">
                    工作流链接（只读）：
                    <Link
                      to={`/workflows/${linkedBoard.id}`}
                      className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      在 Workflows 中打开
                    </Link>
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <MonitorOutputSection />
        </div>
      </div>
    </div>
  )
}

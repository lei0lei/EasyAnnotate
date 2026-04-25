import { MonitorOutputSection } from "@/components/monitor-output-section"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getMonitor, updateMonitor } from "@/lib/monitors-storage"
import { loadWorkflowBoards } from "@/lib/workflows-storage"
import { cn } from "@/lib/utils"
import { ArrowLeft, Radio } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"

export default function MonitorEditorPage() {
  const { monitorId } = useParams<{ monitorId: string }>()
  const item = useMemo(() => (monitorId ? getMonitor(monitorId) : undefined), [monitorId])
  const boards = useMemo(() => loadWorkflowBoards(), [])

  const [name, setName] = useState("")
  const [linkedWorkflowId, setLinkedWorkflowId] = useState("")

  useEffect(() => {
    if (!item) return
    setName(item.name)
    setLinkedWorkflowId(item.linkedWorkflowId)
  }, [item])

  const handleSave = useCallback(() => {
    if (!monitorId) return
    updateMonitor(monitorId, {
      name: name.trim() || "未命名监视",
      linkedWorkflowId,
    })
  }, [monitorId, name, linkedWorkflowId])

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

  const linkedBoard = boards.find((b) => b.id === linkedWorkflowId)

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8 pb-12">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Monitor 看板">
            <Link to="/monitor">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
              {name.trim() || item.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              编辑监视配置与运行输出占位；功能未对接，仅本地保存名称与关联工作流
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-muted-foreground" aria-hidden />
                <CardTitle className="text-lg">监视配置</CardTitle>
              </div>
              <CardDescription>当前监视项的名称与关联工作流</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={`monitor-name-${monitorId}`} className="text-sm font-medium text-foreground">
                  监视名称
                </label>
                <Input
                  id={`monitor-name-${monitorId}`}
                  placeholder="例如：产线检测流水线"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`monitor-workflow-${monitorId}`} className="text-sm font-medium text-foreground">
                  关联工作流
                </label>
                <select
                  id={`monitor-workflow-${monitorId}`}
                  className={cn(
                    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                    "ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  )}
                  value={linkedWorkflowId}
                  onChange={(e) => setLinkedWorkflowId(e.target.value)}
                >
                  <option value="">— 不关联 —</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {boards.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    暂无工作流，请先在{" "}
                    <Link to="/workflows" className="text-primary underline-offset-4 hover:underline">
                      Workflows
                    </Link>{" "}
                    创建。
                  </p>
                ) : null}
              </div>
              <Button type="button" onClick={handleSave}>
                保存配置
              </Button>
              {linkedBoard ? (
                <p className="text-xs text-muted-foreground">
                  当前关联：
                  <Link
                    to={`/workflows/${linkedBoard.id}`}
                    className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {linkedBoard.name}
                  </Link>
                </p>
              ) : null}
            </CardContent>
          </Card>

          <MonitorOutputSection />
        </div>
      </div>
    </div>
  )
}

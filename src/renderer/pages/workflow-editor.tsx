import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getWorkflowBoard } from "@/lib/workflows-storage"
import { ArrowLeft, Workflow } from "lucide-react"
import { useMemo } from "react"
import { Link, Navigate, useParams } from "react-router-dom"


export default function WorkflowEditorPage() {
  const { workflowId } = useParams<{ workflowId: string }>()
  const board = useMemo(
    () => (workflowId ? getWorkflowBoard(workflowId) : undefined),
    [workflowId],
  )

  if (!workflowId) {
    return <Navigate to="/workflows" replace />
  }

  if (!board) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">未找到该流程，可能已被删除。</p>
        <Button asChild variant="outline">
          <Link to="/workflows">返回看板</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8 pb-12">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Workflows 看板">
          <Link to="/workflows">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
            {board.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            流程编辑 · 画布占位（后续接入 LiteGraph.js）
          </p>
        </div>
      </div>

      <Card className="min-h-[420px] border-dashed border-2 border-border/80 bg-muted/10 shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Workflow className="h-5 w-5" aria-hidden />
            <CardTitle className="text-base font-medium text-foreground">推理流程画布</CardTitle>
          </div>
          <CardDescription>
            此处将挂载基于 <span className="font-medium text-foreground">LiteGraph.js</span>{" "}
            的节点编辑器，用于连接模型与前后处理节点，类似 Roboflow Workflow。运行日志后续将接入{" "}
            <Link to="/monitor" className="font-medium text-primary underline-offset-4 hover:underline">
              Monitor
            </Link>{" "}
            运行输出区域（当前仅占位界面）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-border/50 bg-background/50">
            <p className="text-sm text-muted-foreground">画布占位 — 开发中</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

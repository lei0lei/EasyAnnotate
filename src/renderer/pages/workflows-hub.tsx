import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  addWorkflowBoard,
  createWorkflowBoard,
  loadWorkflowBoards,
  removeWorkflowBoard,
  type WorkflowBoard,
} from "@/lib/workflows-storage"
import { cn } from "@/lib/utils"
import { GitBranch, Pencil, Plus, Trash2 } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

function formatUpdated(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export default function WorkflowsHubPage() {
  const navigate = useNavigate()
  const [boards, setBoards] = useState<WorkflowBoard[]>(() => loadWorkflowBoards())

  const refresh = useCallback(() => {
    setBoards(loadWorkflowBoards())
  }, [])

  const handleNew = useCallback(() => {
    const board = createWorkflowBoard()
    addWorkflowBoard(board)
    refresh()
    navigate(`/workflows/${board.id}`)
  }, [navigate, refresh])

  const handleDelete = useCallback(
    (id: string, name: string) => {
      if (!window.confirm(`确定删除流程「${name}」？`)) return
      removeWorkflowBoard(id)
      refresh()
    },
    [refresh],
  )

  const empty = boards.length === 0

  const sorted = useMemo(
    () => [...boards].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [boards],
  )

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            用节点图搭建推理流水线（画布将使用 LiteGraph.js；当前为看板与占位编辑页）
          </p>
        </div>
        <Button type="button" className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" aria-hidden />
          新建流程
        </Button>
      </div>

      {empty ? (
        <Card className="border-dashed border-border/80 bg-muted/20 shadow-none">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GitBranch className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle className="text-lg">还没有保存的流程</CardTitle>
            <CardDescription>创建新流程后将出现在此看板，可编辑或删除</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center pb-6">
            <Button type="button" onClick={handleNew} className="gap-2">
              <Plus className="h-4 w-4" aria-hidden />
              新建流程
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {sorted.map((b) => (
            <li key={b.id}>
              <Card className="h-full border-border/80 shadow-sm transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base font-semibold">{b.name}</CardTitle>
                      <CardDescription className="mt-1 text-xs">
                        更新于 {formatUpdated(b.updatedAt)}
                      </CardDescription>
                    </div>
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                        "bg-muted/60 text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      <GitBranch className="h-4 w-4" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3 pt-0">
                  <p className="text-xs text-muted-foreground">流程看板 · 点击进入画布编辑</p>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
                  <Button asChild size="sm" className="gap-1.5">
                    <Link to={`/workflows/${b.id}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      编辑
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDelete(b.id, b.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    删除
                  </Button>
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

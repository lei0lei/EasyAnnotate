import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  addMonitor,
  createMonitorItem,
  loadMonitors,
  removeMonitor,
  type MonitorItem,
} from "@/lib/monitors-storage"
import { cn } from "@/lib/utils"
import { Eye, Monitor, Pencil, Plus, Trash2 } from "lucide-react"
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

export default function MonitorHubPage() {
  const navigate = useNavigate()
  const [monitors, setMonitors] = useState<MonitorItem[]>(() => loadMonitors())

  const refresh = useCallback(() => {
    setMonitors(loadMonitors())
  }, [])

  const handleNew = useCallback(() => {
    const item = createMonitorItem()
    addMonitor(item)
    refresh()
    navigate(`/monitor/${item.id}`)
  }, [navigate, refresh])

  const handleDelete = useCallback(
    (id: string, name: string) => {
      if (!window.confirm(`确定删除监视项「${name}」？`)) return
      removeMonitor(id)
      refresh()
    },
    [refresh],
  )

  const empty = monitors.length === 0
  const sorted = useMemo(
    () => [...monitors].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [monitors],
  )

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Monitor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            创建、编辑、预览监视配置，并查看运行输出占位区（不接入实际执行，仅为界面）
          </p>
        </div>
        <Button type="button" className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" aria-hidden />
          新建 Monitor
        </Button>
      </div>

      {empty ? (
        <Card className="border-dashed border-border/80 bg-muted/20 shadow-none">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Monitor className="h-6 w-6" aria-hidden />
            </div>
            <CardTitle className="text-lg">还没有保存的 Monitor</CardTitle>
            <CardDescription>创建后可在此管理编辑、删除与预览</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center pb-6">
            <Button type="button" onClick={handleNew} className="gap-2">
              <Plus className="h-4 w-4" aria-hidden />
              新建 Monitor
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {sorted.map((m) => (
            <li key={m.id}>
              <Card className="h-full border-border/80 shadow-sm transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base font-semibold">{m.name}</CardTitle>
                      <CardDescription className="mt-1 text-xs">更新于 {formatUpdated(m.updatedAt)}</CardDescription>
                    </div>
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                        "bg-muted/60 text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      <Monitor className="h-4 w-4" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3 pt-0">
                  <p className="text-xs text-muted-foreground">Monitor 看板 · 编辑、预览与运行输出占位</p>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
                  <Button asChild size="sm" className="gap-1.5">
                    <Link to={`/monitor/${m.id}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      编辑
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="secondary" className="gap-1.5">
                    <Link to={`/monitor/${m.id}/preview`}>
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                      预览
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDelete(m.id, m.name)}
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

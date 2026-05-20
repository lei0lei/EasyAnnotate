import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchYoloTrainingHistory, probeBackendHealth, type YoloHistoryItem } from "@/lib/training-yolo-api"
import { cn } from "@/lib/utils"
import { ArrowLeft, Box, ChevronRight, History, LineChart, Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

function formatTrainingTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export default function ModelsTrainingPage() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyItems, setHistoryItems] = useState<YoloHistoryItem[]>([])

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  const loadHistory = useCallback(() => {
    if (!backendOk) {
      setHistoryItems([])
      return
    }
    setHistoryLoading(true)
    setHistoryError(null)
    void fetchYoloTrainingHistory()
      .then(setHistoryItems)
      .catch((e) => setHistoryError(e instanceof Error ? e.message : String(e)))
      .finally(() => setHistoryLoading(false))
  }, [backendOk])

  useEffect(() => {
    refreshBackend()
    const t = window.setInterval(refreshBackend, 2500)
    return () => window.clearInterval(t)
  }, [refreshBackend])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Models">
          <Link to="/models">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">模型训练</h1>
          <p className="mt-1 text-sm text-muted-foreground">需先连接本地或远程后端 API</p>
        </div>
      </div>

      <Card className={cn("border-border/80", backendOk === false && "border-destructive/40")}>
        <CardContent className="flex items-center gap-2 py-4 text-sm">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              backendOk === null ? "bg-muted-foreground/50" : backendOk ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          {backendOk === null ? "正在检测后端…" : backendOk ? "后端已就绪，可进入训练面板" : "后端未连接，请先在设置中启动本地或连接远程后端"}
          <Button type="button" variant="outline" size="sm" className="ml-auto" asChild>
            <Link to="/settings">设置</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/80 shadow-sm opacity-90">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Box className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">DINOv2</CardTitle>
            <CardDescription>特征与下游训练（即将推出）</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" disabled className="w-full">
              敬请期待
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LineChart className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">YOLO</CardTitle>
            <CardDescription>Ultralytics：检测 / 分割 / 姿态 / OBB</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="default" className="w-full" disabled={backendOk === false}>
              <Link to="/models/training/yolo">进入 YOLO 训练</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/80 text-foreground">
              <History className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">训练历史</CardTitle>
            <CardDescription className="mt-1">
              扫描 <code className="text-xs">backend/external/temp</code>，每次进入本页重新解析
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!backendOk || historyLoading} onClick={loadHistory}>
            刷新
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {historyLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在解析训练目录…
            </div>
          ) : historyError ? (
            <p className="py-4 text-sm text-destructive">{historyError}</p>
          ) : historyItems.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">暂无训练记录</p>
          ) : (
            historyItems.map((item) => (
              <Link
                key={item.job_slug}
                to={`/models/training/history/${encodeURIComponent(item.job_slug)}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-4 py-3 transition-colors hover:bg-muted/25"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{item.display_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatTrainingTime(item.created_at)}
                    {item.status ? ` · ${item.status}` : ""}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

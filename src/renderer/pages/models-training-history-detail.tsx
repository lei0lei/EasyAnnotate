import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchYoloTrainingLogs, probeBackendHealth } from "@/lib/training-yolo-api"
import { cn } from "@/lib/utils"
import { ArrowLeft, Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

export default function ModelsTrainingHistoryDetailPage() {
  const { jobSlug = "" } = useParams<{ jobSlug: string }>()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState("")
  const [error, setError] = useState<string | null>(null)

  const loadLogs = useCallback(() => {
    if (!jobSlug) return
    setLoading(true)
    setError(null)
    void fetchYoloTrainingLogs(jobSlug)
      .then(setLogs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [jobSlug])

  useEffect(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回训练历史">
          <Link to="/models/training">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">训练日志</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{jobSlug || "—"}</p>
        </div>
      </div>

      {backendOk === false ? (
        <p className="text-sm text-destructive">后端未连接，无法读取日志。请先在设置中启动本地或连接远程后端。</p>
      ) : null}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-medium">日志内容</CardTitle>
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={loadLogs}>
            重新加载
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <pre
              className={cn(
                "max-h-[min(70vh,640px)] overflow-auto rounded-lg border border-border/60 bg-muted/20 p-4",
                "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground",
              )}
            >
              {logs}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

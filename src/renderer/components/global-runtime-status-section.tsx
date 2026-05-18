/**
 * 只读展示全局 SAM / DINOv2 后端连接状态（各 AI 工具配置页使用）。
 */
import { Button } from "@/components/ui/button"
import {
  formatActiveGlobalDinov2Label,
  resolveActiveGlobalDinov2FromCatalog,
} from "@/lib/global-dinov2-runtime"
import { fetchModelRuntimeCatalog } from "@/lib/model-runtime-api"
import { formatActiveSamAnnotationLabel, resolveActiveSamFromCatalog } from "@/lib/sam-annotation-runtime"
import { cn } from "@/lib/utils"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

export type GlobalRuntimeStatusSectionProps = {
  /** 是否展示 DINOv2 行（扩散工具需要 SAM + DINOv2） */
  showDinov2?: boolean
  className?: string
}

export function GlobalRuntimeStatusSection({ showDinov2 = false, className }: GlobalRuntimeStatusSectionProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [samLabel, setSamLabel] = useState<string | null>(null)
  const [samRunning, setSamRunning] = useState(false)
  const [dinoLabel, setDinoLabel] = useState<string | null>(null)
  const [dinoRunning, setDinoRunning] = useState(false)

  const refresh = useCallback(() => {
    setError(null)
    setLoading(true)
    void fetchModelRuntimeCatalog()
      .then((cat) => {
        const sam = resolveActiveSamFromCatalog(cat.categories)
        if (sam) {
          setSamRunning(true)
          setSamLabel(formatActiveSamAnnotationLabel(sam, cat.categories))
        } else {
          setSamRunning(false)
          setSamLabel(null)
        }
        const dino = resolveActiveGlobalDinov2FromCatalog(cat.categories)
        if (dino) {
          setDinoRunning(true)
          setDinoLabel(formatActiveGlobalDinov2Label(dino, cat.categories))
        } else {
          setDinoRunning(false)
          setDinoLabel(null)
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败")
        setSamRunning(false)
        setSamLabel(null)
        setDinoRunning(false)
        setDinoLabel(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <section className={cn("space-y-4", className)}>
      <StatusHeader loading={loading} onRefresh={refresh} />
      {error ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      ) : null}
      {loading && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>正在查询后端…</span>
        </div>
      ) : null}
      {!loading && !error ? (
        <ul className="space-y-3 rounded-lg border border-border/80 bg-muted/20 px-3 py-3 text-sm">
          <RuntimeStatusRow label="SAM" running={samRunning} detail={samLabel} />
          {showDinov2 ? <RuntimeStatusRow label="DINOv2" running={dinoRunning} detail={dinoLabel} /> : null}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        在{" "}
        <Link to="/models/backend" className="font-medium text-primary underline-offset-2 hover:underline">
          模型 → 后端模型管理
        </Link>{" "}
        中启动、停止或测试全局推理实例。
      </p>
    </section>
  )
}

function StatusHeader({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-3">
      <h2 className="text-lg font-semibold text-foreground">后端推理状态</h2>
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onRefresh}>
        <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
        刷新
      </Button>
    </div>
  )
}

function RuntimeStatusRow({
  label,
  running,
  detail,
}: {
  label: string
  running: boolean
  detail: string | null
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        {running ? (
          <>
            <span className="font-medium text-emerald-800 dark:text-emerald-200">已连接</span>
            {detail ? <span className="ml-1.5 text-foreground/90">· {detail}</span> : null}
          </>
        ) : (
          <span className="text-amber-800 dark:text-amber-200">未启动</span>
        )}
      </span>
    </li>
  )
}

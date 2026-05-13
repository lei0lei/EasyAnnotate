import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ipc } from "@/gen/ipc"
import { loadAppConfig, updateAppConfig } from "@/lib/app-config-storage"
import { cn } from "@/lib/utils"
import { FolderOpen, Server } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

const LOCAL_BACKEND_START_TIMEOUT_MS = 60_000

export function LocalBackendBoard() {
  const [backendDir, setBackendDir] = useState(() => loadAppConfig().backend.localBackendDir ?? "")
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [picking, setPicking] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [pendingStartSince, setPendingStartSince] = useState<number | null>(null)
  const [startupTimedOut, setStartupTimedOut] = useState(false)

  const refreshStatus = useCallback(() => {
    void ipc.app
      .GetLocalBackendStatus({})
      .then((s) => setReachable(s.reachable))
      .catch(() => setReachable(false))
  }, [])

  useEffect(() => {
    refreshStatus()
    const timer = setInterval(refreshStatus, 2500)
    return () => clearInterval(timer)
  }, [refreshStatus])

  useEffect(() => {
    if (reachable === true) {
      setStartupTimedOut(false)
      setPendingStartSince(null)
    }
  }, [reachable])

  useEffect(() => {
    if (pendingStartSince === null || reachable === true) return

    const delay = Math.max(0, pendingStartSince + LOCAL_BACKEND_START_TIMEOUT_MS - Date.now())
    const id = window.setTimeout(() => {
      setStartupTimedOut(true)
      setHint("1 分钟内未能启动本地 API 服务，请检查 backend 目录、start.ps1 与端口占用。")
      setPendingStartSince(null)
    }, delay)

    return () => clearTimeout(id)
  }, [pendingStartSince, reachable])

  const pickBackendDirectory = useCallback(async () => {
    setPicking(true)
    setHint(null)
    try {
      const result = await ipc.app.SelectDirectory({
        title: "选择 backend 目录（需包含 start.ps1）",
        defaultPath: backendDir.trim(),
      })
      if (result.errorMessage) {
        setHint(`无法打开目录选择：${result.errorMessage}`)
        return
      }
      if (result.canceled || !result.path?.trim()) return
      const next = result.path.trim()
      updateAppConfig({ backend: { ...loadAppConfig().backend, localBackendDir: next } })
      setBackendDir(next)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setPicking(false)
    }
  }, [backendDir])

  const clearBackendDirectory = useCallback(() => {
    updateAppConfig({ backend: { ...loadAppConfig().backend, localBackendDir: "" } })
    setBackendDir("")
    setHint(null)
  }, [])

  const startBackend = useCallback(async () => {
    setHint(null)
    setStartupTimedOut(false)
    try {
      const result = await ipc.app.StartLocalBackend({
        backendDirectory: backendDir.trim(),
      })
      if (!result.ok) {
        setPendingStartSince(null)
        setHint(result.errorMessage.trim() || "启动失败")
      } else {
        setPendingStartSince(Date.now())
        if (result.alreadyRunning) {
          setHint("服务已在运行")
        }
      }
      refreshStatus()
    } catch (e) {
      setPendingStartSince(null)
      setHint(e instanceof Error ? e.message : String(e))
    }
  }, [backendDir, refreshStatus])

  const stopBackend = useCallback(async () => {
    setHint(null)
    try {
      const result = await ipc.app.StopLocalBackend({})
      if (!result.stopped && result.message?.trim()) {
        setHint(result.message.trim())
      }
      refreshStatus()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }, [refreshStatus])

  const dirLabel = backendDir.trim() ? backendDir.trim() : "未设置（将自动查找项目内的 backend）"

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Server className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
              本地后端
              {startupTimedOut ? (
                <span className="text-sm font-normal text-destructive" aria-live="polite">
                  无法启动
                </span>
              ) : null}
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">API 目录</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={picking}
                onClick={() => void pickBackendDirectory()}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                {picking ? "选择中…" : "选择目录"}
              </Button>
              {backendDir.trim() ? (
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearBackendDirectory}>
                  清除（自动查找）
                </Button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="mt-1.5 w-full rounded-md px-1 py-1 text-left text-xs font-mono text-foreground hover:bg-muted/50"
            title={dirLabel}
            onClick={() => void pickBackendDirectory()}
          >
            <span className="line-clamp-2 break-all">{dirLabel}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-[6.75rem]"
              onClick={() => void startBackend()}
            >
              启动
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-[6.75rem]"
              onClick={() => void stopBackend()}
            >
              停止
            </Button>
          </div>
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background",
              reachable === null && "bg-muted-foreground/45",
              reachable === true && "bg-emerald-500",
              reachable === false && "bg-red-500",
            )}
            title={reachable === true ? "已连接" : reachable === false ? "无法连接" : "检测中"}
            role="status"
            aria-label={
              reachable === true ? "后端已连接" : reachable === false ? "后端无法连接" : "正在检测连接"
            }
          />
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

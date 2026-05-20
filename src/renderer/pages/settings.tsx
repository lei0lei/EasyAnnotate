import { LocalBackendBoard } from "@/components/local-backend-board"
import { ShortcutCaptureDialog } from "@/components/shortcut-capture-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ipc } from "@/gen/ipc"
import { APP_SHORTCUT_ROWS, buildShortcutsPersistPatch } from "@/lib/app-shortcut-registry"
import { loadAppConfig, migrateAndUpdateGlobalConfigDir, updateAppConfig } from "@/lib/app-config-storage"
import { cn } from "@/lib/utils"
import { CheckCircle2, FolderOpen, Keyboard, Network, RotateCcw, Settings2 } from "lucide-react"
import { useCallback, useEffect, useId, useState } from "react"

const DEFAULT_BACKEND = { protocol: "http", host: "127.0.0.1", port: "8000", basePath: "" } as const

function defaultShortcutMap(): Record<string, string> {
  return Object.fromEntries(APP_SHORTCUT_ROWS.map((row) => [row.id, row.defaultBinding]))
}

function savedShortcutMap(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(loadAppConfig().shortcuts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function remoteOriginFromFields(protocol: "http" | "https", host: string, port: string): string {
  const scheme = protocol === "https" ? "https" : "http"
  const h = host.trim() || DEFAULT_BACKEND.host
  const p = (port.trim() || DEFAULT_BACKEND.port).replace(/^:/, "")
  return `${scheme}://${h}:${p}`
}

type CompletionStatus = "applied" | "reset" | null

function CompletionIcon({ status }: { status: CompletionStatus }) {
  if (!status) return null
  const Icon = status === "applied" ? CheckCircle2 : RotateCcw
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
      aria-live="polite"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {status === "applied" ? "已应用" : "已还原"}
    </span>
  )
}

export default function SettingsPage() {
  const baseId = useId()
  const initial = loadAppConfig()
  const [defaultGlobalConfigDir, setDefaultGlobalConfigDir] = useState(initial.storagePaths.globalConfigDir)
  const [host, setHost] = useState(initial.backend.host)
  const [port, setPort] = useState(initial.backend.port)
  const [protocol, setProtocol] = useState(initial.backend.protocol)
  const [basePath, setBasePath] = useState(initial.backend.basePath)
  const [remoteConnected, setRemoteConnected] = useState(Boolean(initial.backend.remoteConnected))
  const [remoteReachable, setRemoteReachable] = useState(false)
  const [remotePending, setRemotePending] = useState(false)
  const [globalConfigDir, setGlobalConfigDir] = useState(initial.storagePaths.globalConfigDir)
  const [storageStatus, setStorageStatus] = useState<CompletionStatus>(null)
  const [shortcutStatus, setShortcutStatus] = useState<CompletionStatus>(null)
  const [shortcutDraft, setShortcutDraft] = useState<Record<string, string>>(() => ({
    ...defaultShortcutMap(),
    ...savedShortcutMap(),
  }))
  const [shortcutCaptureRowId, setShortcutCaptureRowId] = useState<string | null>(null)
  const [selectingGlobalConfigDir, setSelectingGlobalConfigDir] = useState(false)

  const handleSelectGlobalConfigDir = useCallback(async () => {
    setSelectingGlobalConfigDir(true)
    try {
      const result = await ipc.app.SelectDirectory({
        title: "全局配置存储路径",
        defaultPath: globalConfigDir,
      })
      if (result.errorMessage) {
        window.alert(`无法打开目录选择窗口：${result.errorMessage}\n请先手动输入目录路径，或重启开发服务后再试。`)
        return
      }
      if (!result.canceled && result.path) {
        setGlobalConfigDir(result.path)
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "未知错误"
      window.alert(`无法打开目录选择窗口：${message}\n请确认已重启开发服务，或先手动输入目录路径。`)
    } finally {
      setSelectingGlobalConfigDir(false)
    }
  }, [globalConfigDir])

  useEffect(() => {
    void ipc.app
      .GetDefaultGlobalConfigDir({})
      .then((result) => {
        setDefaultGlobalConfigDir(result.path)
        setGlobalConfigDir((current) => (current.trim() ? current : result.path))
      })
      .catch(() => {
        /* ignore */
      })
  }, [])

  const probeRemoteHealth = useCallback(
    async (nextProtocol: "http" | "https", nextHost: string, nextPort: string, nextBasePath: string): Promise<boolean> => {
      const origin = remoteOriginFromFields(nextProtocol, nextHost, nextPort)
      const base = nextBasePath.trim() ? (nextBasePath.trim().startsWith("/") ? nextBasePath.trim() : `/${nextBasePath.trim()}`) : ""
      const healthUrl = `${origin}${base}/health`
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
        return response.ok
      } catch {
        return false
      }
    },
    [],
  )

  useEffect(() => {
    if (!remoteConnected) {
      setRemoteReachable(false)
      return
    }
    let alive = true
    const tick = () => {
      void probeRemoteHealth(protocol, host, port, basePath).then((ok) => {
        if (!alive) return
        setRemoteReachable(ok)
      })
    }
    tick()
    const timer = window.setInterval(tick, 2500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [basePath, host, port, probeRemoteHealth, protocol, remoteConnected])

  const [storageMigrating, setStorageMigrating] = useState(false)

  const handleApplyStoragePaths = useCallback(async () => {
    const resolvedGlobalConfigDir = globalConfigDir.trim() || defaultGlobalConfigDir
    const currentRaw = loadAppConfig().storagePaths.globalConfigDir.trim()
    const currentEffective = currentRaw || defaultGlobalConfigDir
    if (currentEffective !== resolvedGlobalConfigDir) {
      setStorageMigrating(true)
      try {
        const errMsg = await migrateAndUpdateGlobalConfigDir(resolvedGlobalConfigDir)
        if (errMsg) {
          window.alert(`配置迁移失败：${errMsg}`)
          return
        }
      } finally {
        setStorageMigrating(false)
      }
    } else {
      updateAppConfig({
        storagePaths: {
          databaseDir: "",
          assetsDir: "",
          globalConfigDir: resolvedGlobalConfigDir,
        },
      })
    }
    setGlobalConfigDir(resolvedGlobalConfigDir)
    setStorageStatus("applied")
  }, [defaultGlobalConfigDir, globalConfigDir])

  const handleStorageDefaults = useCallback(async () => {
    const resolvedGlobalConfigDir = defaultGlobalConfigDir
    const currentRaw = loadAppConfig().storagePaths.globalConfigDir.trim()
    const currentEffective = currentRaw || defaultGlobalConfigDir
    if (currentEffective !== resolvedGlobalConfigDir) {
      setStorageMigrating(true)
      try {
        const errMsg = await migrateAndUpdateGlobalConfigDir(resolvedGlobalConfigDir)
        if (errMsg) {
          window.alert(`配置迁移失败：${errMsg}`)
          return
        }
      } finally {
        setStorageMigrating(false)
      }
    } else {
      updateAppConfig({
        storagePaths: {
          databaseDir: "",
          assetsDir: "",
          globalConfigDir: resolvedGlobalConfigDir,
        },
      })
    }
    setGlobalConfigDir(resolvedGlobalConfigDir)
    setStorageStatus("reset")
  }, [defaultGlobalConfigDir])

  const handleShortcutRowSave = useCallback((rowId: string, binding: string) => {
    setShortcutDraft((prev) => {
      const next = { ...prev, [rowId]: binding }
      updateAppConfig({ shortcuts: buildShortcutsPersistPatch(next) })
      return next
    })
    setShortcutStatus("applied")
  }, [])

  const handleShortcutDefaults = useCallback(() => {
    const defaults = defaultShortcutMap()
    setShortcutDraft(defaults)
    updateAppConfig({
      shortcuts: Object.fromEntries(APP_SHORTCUT_ROWS.map((row) => [row.id, ""])),
    })
    setShortcutStatus("reset")
  }, [])

  const handleStartRemote = useCallback(async () => {
    setRemotePending(true)
    try {
      const normalizedProtocol = protocol === "https" ? "https" : "http"
      const normalizedHost = host.trim() || DEFAULT_BACKEND.host
      const normalizedPort = port.trim() || DEFAULT_BACKEND.port
      const normalizedBasePath = basePath.trim()

      const local = await ipc.app.GetLocalBackendStatus({})
      if (local.reachable) {
        window.alert("请先停止本地后端，再连接远程后端。")
        return
      }

      const ok = await probeRemoteHealth(normalizedProtocol, normalizedHost, normalizedPort, normalizedBasePath)
      if (!ok) {
        window.alert("远程后端健康检查失败（/health 不可用）。请确认服务端已启动且地址端口正确。")
        return
      }

      updateAppConfig({
        backend: {
          ...loadAppConfig().backend,
          protocol: normalizedProtocol,
          host: normalizedHost,
          port: normalizedPort,
          basePath: normalizedBasePath,
          remoteConnected: true,
        },
      })
      setProtocol(normalizedProtocol)
      setHost(normalizedHost)
      setPort(normalizedPort)
      setBasePath(normalizedBasePath)
      setRemoteConnected(true)
      setRemoteReachable(true)
    } finally {
      setRemotePending(false)
    }
  }, [basePath, host, port, probeRemoteHealth, protocol])

  const handleStopRemote = useCallback(() => {
    updateAppConfig({
      backend: {
        ...loadAppConfig().backend,
        remoteConnected: false,
      },
    })
    setRemoteConnected(false)
    setRemoteReachable(false)
  }, [])

  const shortcutCaptureRow = shortcutCaptureRowId
    ? (APP_SHORTCUT_ROWS.find((r) => r.id === shortcutCaptureRowId) ?? null)
    : null

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8 pb-12">
        <header>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings2 className="h-5 w-5" aria-hidden />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">设置</h1>
          </div>
        </header>

        <section className="space-y-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Network className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-base">远程后端</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor={`${baseId}-protocol`} className="text-sm font-medium text-foreground">
                    协议
                  </label>
                  <select
                    id={`${baseId}-protocol`}
                    value={protocol}
                    onChange={(e) => setProtocol(e.target.value === "https" ? "https" : "http")}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor={`${baseId}-host`} className="text-sm font-medium text-foreground">
                    IP 或主机名
                  </label>
                  <Input
                    id={`${baseId}-host`}
                    placeholder="例如 127.0.0.1"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`${baseId}-port`} className="text-sm font-medium text-foreground">
                    端口
                  </label>
                  <Input
                    id={`${baseId}-port`}
                    type="text"
                    inputMode="numeric"
                    placeholder="例如 8080"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label htmlFor={`${baseId}-base-path`} className="text-sm font-medium text-foreground">
                    API 根路径（可选）
                  </label>
                  <Input
                    id={`${baseId}-base-path`}
                    placeholder="例如 /easyannotate（留空表示直接 /api/v1）"
                    value={basePath}
                    onChange={(e) => setBasePath(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={remotePending} onClick={() => void handleStartRemote()}>
                  启动
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={remotePending} onClick={handleStopRemote}>
                  停止
                </Button>
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background",
                    remoteConnected && remoteReachable ? "bg-emerald-500" : "bg-red-500",
                  )}
                  title={remoteConnected && remoteReachable ? "远程已连接" : "远程未连接"}
                  role="status"
                  aria-label={remoteConnected && remoteReachable ? "远程后端已连接" : "远程后端未连接"}
                />
              </div>
            </CardContent>
          </Card>
          <LocalBackendBoard />
        </section>

        <Separator className="bg-border/60" />

        <section>
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FolderOpen className="h-4 w-4" aria-hidden />
                </div>
                <CardTitle className="text-base">全局配置存储路径</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={`${baseId}-global-config-dir`}
                  value={globalConfigDir}
                  onChange={(e) => setGlobalConfigDir(e.target.value)}
                  placeholder="/home/user/EasyAnnotate/config"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="全局配置存储路径"
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  disabled={selectingGlobalConfigDir || storageMigrating}
                  onClick={() => void handleSelectGlobalConfigDir()}
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                  {selectingGlobalConfigDir ? "选择中..." : "选择目录"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={storageMigrating} onClick={() => void handleApplyStoragePaths()}>
                  {storageMigrating ? "迁移中..." : "应用"}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={storageMigrating} onClick={() => void handleStorageDefaults()}>
                  使用默认
                </Button>
                <CompletionIcon status={storageStatus} />
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator className="bg-border/60" />

        <section>
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Keyboard className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-base">键位</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {APP_SHORTCUT_ROWS.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 gap-y-2 px-3 py-2.5 first:rounded-t-[inherit] last:rounded-b-[inherit] sm:px-4"
                  >
                    <span className="text-sm text-foreground">{row.label}</span>
                    <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:min-w-[12rem]">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0"
                        onClick={() => setShortcutCaptureRowId(row.id)}
                      >
                        点击设置
                      </Button>
                      <span
                        className="inline-flex min-h-8 min-w-[6.5rem] items-center justify-end rounded-md border border-border/80 bg-muted/20 px-2 py-1.5 font-mono text-xs text-foreground"
                        aria-label={`${row.label}当前快捷键`}
                      >
                        {shortcutDraft[row.id] ?? row.defaultBinding}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {shortcutCaptureRow ? (
                <ShortcutCaptureDialog
                  open
                  title={shortcutCaptureRow.label}
                  initialBinding={shortcutDraft[shortcutCaptureRow.id] ?? shortcutCaptureRow.defaultBinding}
                  onClose={() => setShortcutCaptureRowId(null)}
                  onSave={(binding) => handleShortcutRowSave(shortcutCaptureRow.id, binding)}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleShortcutDefaults}>
                  使用默认
                </Button>
                <CompletionIcon status={shortcutStatus} />
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ipc } from "@/gen/ipc"
import { loadAppConfig, updateAppConfig } from "@/lib/app-config-storage"
import { cn } from "@/lib/utils"
import { CheckCircle2, Database, FolderOpen, Images, Keyboard, Network, RotateCcw, Settings2 } from "lucide-react"
import { useCallback, useEffect, useId, useState, type ReactNode } from "react"

const SHORTCUT_ROWS: { id: string; label: string; defaultBinding: string }[] = [
  { id: "img-prev", label: "上一张图像", defaultBinding: "A 或 ←" },
  { id: "img-next", label: "下一张图像", defaultBinding: "D 或 →" },
  { id: "save", label: "保存标注", defaultBinding: "Ctrl + S" },
  { id: "undo", label: "撤销", defaultBinding: "Ctrl + Z" },
  { id: "redo", label: "重做", defaultBinding: "Ctrl + Y" },
  { id: "del", label: "删除选中", defaultBinding: "Delete" },
  { id: "zoom-in", label: "放大画布", defaultBinding: "Ctrl + =" },
  { id: "zoom-out", label: "缩小画布", defaultBinding: "Ctrl + -" },
  { id: "open-settings", label: "打开设置", defaultBinding: "Ctrl + ," },
]

function Kbd({ children }: { children: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-border bg-muted/80 px-2 py-0.5 font-mono text-[11px] font-medium text-foreground/90",
        "shadow-sm",
      )}
    >
      {children}
    </kbd>
  )
}

const DEFAULT_BACKEND = { host: "127.0.0.1", port: "8080" } as const

function defaultShortcutMap(): Record<string, string> {
  return Object.fromEntries(SHORTCUT_ROWS.map((row) => [row.id, row.defaultBinding]))
}

function savedShortcutMap(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(loadAppConfig().shortcuts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
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

function DirectoryPathField({
  icon,
  id,
  label,
  description,
  placeholder,
  value,
  onChange,
}: {
  icon: ReactNode
  id: string
  label: string
  description: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  const [selecting, setSelecting] = useState(false)

  const handleSelectDirectory = useCallback(async () => {
    setSelecting(true)
    try {
      const result = await ipc.app.SelectDirectory({
        title: label,
        defaultPath: value,
      })
      if (result.errorMessage) {
        window.alert(`无法打开目录选择窗口：${result.errorMessage}\n请先手动输入目录路径，或重启开发服务后再试。`)
        return
      }
      if (!result.canceled && result.path) {
        onChange(result.path)
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "未知错误"
      window.alert(`无法打开目录选择窗口：${message}\n请确认已重启开发服务，或先手动输入目录路径。`)
    } finally {
      setSelecting(false)
    }
  }, [label, onChange, value])

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-1.5"
          disabled={selecting}
          onClick={() => void handleSelectDirectory()}
        >
          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          {selecting ? "选择中..." : "选择目录"}
        </Button>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const baseId = useId()
  const initial = loadAppConfig()
  const [defaultGlobalConfigDir, setDefaultGlobalConfigDir] = useState(initial.storagePaths.globalConfigDir)
  const [host, setHost] = useState(initial.backend.host)
  const [port, setPort] = useState(initial.backend.port)
  const [databaseDir, setDatabaseDir] = useState(initial.storagePaths.databaseDir)
  const [assetsDir, setAssetsDir] = useState(initial.storagePaths.assetsDir)
  const [globalConfigDir, setGlobalConfigDir] = useState(initial.storagePaths.globalConfigDir)
  const [backendStatus, setBackendStatus] = useState<CompletionStatus>(null)
  const [storageStatus, setStorageStatus] = useState<CompletionStatus>(null)
  const [shortcutStatus, setShortcutStatus] = useState<CompletionStatus>(null)
  const [shortcutDraft, setShortcutDraft] = useState<Record<string, string>>(() => ({
    ...defaultShortcutMap(),
    ...savedShortcutMap(),
  }))

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

  const persistConfigToDisk = useCallback((globalConfigDirOverride?: string) => {
    const nextConfig = loadAppConfig()
    const persistedGlobalConfigDir = (globalConfigDirOverride ?? nextConfig.storagePaths.globalConfigDir).trim() || defaultGlobalConfigDir
    const payload = {
      ...nextConfig,
      storagePaths: {
        ...nextConfig.storagePaths,
        globalConfigDir: persistedGlobalConfigDir,
      },
    }
    void ipc.app.SaveAppConfigToDisk({
      globalConfigDir: persistedGlobalConfigDir,
      appConfigJson: JSON.stringify(payload, null, 2),
    }).catch((error) => {
      const message = error instanceof Error && error.message ? error.message : "未知错误"
      window.alert(`无法写入配置文件：${message}\n请检查“全局配置存储路径”是否可访问。`)
    })
  }, [defaultGlobalConfigDir])

  const handleApplyBackend = useCallback(() => {
    updateAppConfig({
      backend: { host: host.trim() || DEFAULT_BACKEND.host, port: port.trim() || DEFAULT_BACKEND.port },
    })
    setBackendStatus("applied")
    persistConfigToDisk()
  }, [host, persistConfigToDisk, port])

  const handleApplyStoragePaths = useCallback(() => {
    const resolvedGlobalConfigDir = globalConfigDir.trim() || defaultGlobalConfigDir
    updateAppConfig({
      storagePaths: {
        databaseDir: databaseDir.trim(),
        assetsDir: assetsDir.trim(),
        globalConfigDir: resolvedGlobalConfigDir,
      },
    })
    setGlobalConfigDir(resolvedGlobalConfigDir)
    setStorageStatus("applied")
    persistConfigToDisk(resolvedGlobalConfigDir)
  }, [assetsDir, databaseDir, defaultGlobalConfigDir, globalConfigDir, persistConfigToDisk])

  const handleStorageDefaults = useCallback(() => {
    const resolvedGlobalConfigDir = defaultGlobalConfigDir
    setDatabaseDir("")
    setAssetsDir("")
    setGlobalConfigDir(resolvedGlobalConfigDir)
    updateAppConfig({
      storagePaths: {
        databaseDir: "",
        assetsDir: "",
        globalConfigDir: resolvedGlobalConfigDir,
      },
    })
    setStorageStatus("reset")
    persistConfigToDisk(resolvedGlobalConfigDir)
  }, [defaultGlobalConfigDir, persistConfigToDisk])

  const handleApplyShortcuts = useCallback(() => {
    const patch: Record<string, string> = {}
    for (const row of SHORTCUT_ROWS) {
      const value = (shortcutDraft[row.id] ?? "").trim()
      patch[row.id] = value && value !== row.defaultBinding ? value : ""
    }
    updateAppConfig({ shortcuts: patch })
    setShortcutStatus("applied")
    persistConfigToDisk()
  }, [persistConfigToDisk, shortcutDraft])

  const handleShortcutDefaults = useCallback(() => {
    const defaults = defaultShortcutMap()
    setShortcutDraft(defaults)
    updateAppConfig({
      shortcuts: Object.fromEntries(SHORTCUT_ROWS.map((row) => [row.id, ""])),
    })
    setShortcutStatus("reset")
    persistConfigToDisk()
  }, [persistConfigToDisk])

  const handleBackendDefaults = useCallback(() => {
    updateAppConfig({ backend: { ...DEFAULT_BACKEND } })
    setHost(DEFAULT_BACKEND.host)
    setPort(DEFAULT_BACKEND.port)
    setBackendStatus("reset")
    persistConfigToDisk()
  }, [persistConfigToDisk])

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8 pb-12">
        <header>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Settings2 className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">设置</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                应用级偏好见下方「后端」等；与 Workflows、Monitor 等业务数据分 key 存于本机。详细约定见{" "}
                <code className="rounded bg-muted px-1 font-mono text-xs">lib/storage/keys.ts</code> 注释。
              </p>
            </div>
          </div>
        </header>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">后端</h2>
            <CompletionIcon status={backendStatus} />
          </div>
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Network className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-base">服务地址</CardTitle>
                  <CardDescription className="text-xs">REST / WebSocket 所依赖的主机与端口</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
              <p className="text-xs text-muted-foreground">
                将用于拼接如 <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">http://{host || "…"}:{port || "…"}</code>
                ；点「应用」后写入 <span className="font-mono">ea-app-config</span>。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleApplyBackend}>
                  应用
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleBackendDefaults}>
                  使用默认
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator className="bg-border/60" />

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">本地存储目录</h2>
            <CompletionIcon status={storageStatus} />
          </div>
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Database className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-base">数据库、图片与标注目录</CardTitle>
                  <CardDescription className="text-xs">
                    保存本机路径，后续用于 SQLite 数据库文件，以及图片/标注统一存储目录
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <DirectoryPathField
                id={`${baseId}-database-dir`}
                icon={<Database className="h-4 w-4" aria-hidden />}
                label="数据库文件存储目录"
                description="用于放置项目索引数据库，例如 easyannotate.db"
                placeholder="/home/user/EasyAnnotate/databases"
                value={databaseDir}
                onChange={setDatabaseDir}
              />
              <DirectoryPathField
                id={`${baseId}-assets-dir`}
                icon={<Images className="h-4 w-4" aria-hidden />}
                label="图片标注和存储目录"
                description="用于统一保存/引用图片、标注 JSON、导出文件或项目 annotation 子目录"
                placeholder="/home/user/Datasets/easyannotate"
                value={assetsDir}
                onChange={setAssetsDir}
              />
              <DirectoryPathField
                id={`${baseId}-global-config-dir`}
                icon={<FolderOpen className="h-4 w-4" aria-hidden />}
                label="全局配置存储路径"
                description="用于存放软件级配置 JSON（workflow/models/monitor 流程配置等）"
                placeholder="/home/user/EasyAnnotate/config"
                value={globalConfigDir}
                onChange={setGlobalConfigDir}
              />
              <p className="text-xs text-muted-foreground">
                当前目录会随「应用」一起写入应用配置；「选择目录」通过主进程原生目录选择 IPC 获取本机绝对路径。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleApplyStoragePaths}>
                  应用
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleStorageDefaults}>
                  使用默认
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator className="bg-border/60" />

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">快捷键</h2>
            <CompletionIcon status={shortcutStatus} />
          </div>
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Keyboard className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-base">键位</CardTitle>
                  <CardDescription className="text-xs">展示默认键位；已保存的覆盖存在应用配置中（录制与改键 UI 可后续接）</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {SHORTCUT_ROWS.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 gap-y-2 px-3 py-2.5 first:rounded-t-[inherit] last:rounded-b-[inherit] sm:px-4"
                  >
                    <span className="text-sm text-foreground">{row.label}</span>
                    <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:min-w-[14rem]">
                      <Input
                        value={shortcutDraft[row.id] ?? row.defaultBinding}
                        onChange={(e) =>
                          setShortcutDraft((current) => ({
                            ...current,
                            [row.id]: e.target.value,
                          }))
                        }
                        aria-label={`${row.label}快捷键`}
                        className="h-8 w-36 font-mono text-xs"
                        spellCheck={false}
                      />
                      <Kbd>{row.defaultBinding}</Kbd>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleApplyShortcuts}>
                  应用
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleShortcutDefaults}>
                  使用默认
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

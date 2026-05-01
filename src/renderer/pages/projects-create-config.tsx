import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ipc } from "@/gen/ipc"
import { Input } from "@/components/ui/input"
import { createProject, type ProjectTag } from "@/lib/projects-api"
import { ArrowLeft, CircleX } from "lucide-react"
import { useMemo, useState } from "react"
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom"

type CreateProjectState = {
  name?: string
  projectInfo?: string
  projectType?: string
  storageType?: string
  tags?: ProjectTag[]
}

export default function ProjectsCreateConfigPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as CreateProjectState
  const [localPath, setLocalPath] = useState("")
  const [remoteIp, setRemoteIp] = useState("")
  const [remotePort, setRemotePort] = useState("")
  const [selectingPath, setSelectingPath] = useState(false)
  const [creating, setCreating] = useState(false)
  const [localPathError, setLocalPathError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  if (!state.name) {
    return <Navigate to="/projects/new" replace />
  }

  const isRemoteStorage = state.storageType === "remote"
  const storageLabel = isRemoteStorage ? "远程存储" : "本地存储"
  const canFinish = useMemo(() => {
    if (isRemoteStorage) {
      return remoteIp.trim().length > 0 && remotePort.trim().length > 0
    }
    return localPath.trim().length > 0
  }, [isRemoteStorage, localPath, remoteIp, remotePort])

  async function handleFinish() {
    if (creating) return
    if (!canFinish) {
      if (isRemoteStorage) {
        setFormError("请先填写远程 IP 和端口。")
      } else {
        setLocalPathError("请选择本地路径。")
      }
      return
    }
    setFormError(null)
    if (!isRemoteStorage) {
      try {
        const validation = await ipc.app.ValidateProjectDirectory({ path: localPath })
        if (!validation.isEmpty) {
          setLocalPathError("请选择空白路径文件夹")
          return
        }
        setLocalPathError(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("No handler registered")) {
          setLocalPathError("目录校验服务未就绪，请重启开发服务。")
        } else {
          setLocalPathError(`目录校验失败：${message}`)
        }
        return
      }
    }
    setCreating(true)
    try {
      const result = await createProject({
        name: state.name ?? "",
        projectInfo: state.projectInfo ?? "",
        projectType: state.projectType ?? "",
        storageType: state.storageType ?? "local",
        localPath: localPath.trim(),
        remoteIp: remoteIp.trim(),
        remotePort: remotePort.trim(),
        tags: state.tags ?? [],
      })
      if (result.errorMessage) {
        if (result.errorMessage.includes("目录不为空")) {
          setLocalPathError("请选择空白路径文件夹")
        } else {
          setFormError(result.errorMessage)
        }
        return
      }
      if (!result.project) {
        setFormError("创建项目失败，请重试。")
        return
      }
      navigate(`/projects/${result.project.id}`)
    } finally {
      setCreating(false)
    }
  }

  async function handleSelectLocalPath() {
    setSelectingPath(true)
    try {
      const result = await ipc.app.SelectDirectory({
        title: "选择本地存储路径",
        defaultPath: localPath,
      })
      if (result.errorMessage) {
        setLocalPathError(`无法打开目录选择窗口：${result.errorMessage}`)
        return
      }
      if (!result.canceled && result.path) {
        setLocalPath(result.path)
        setLocalPathError(null)
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "未知错误"
      setLocalPathError(`无法打开目录选择窗口：${message}`)
    } finally {
      setSelectingPath(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回项目创建表单">
          <Link to="/projects/new">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">创建项目 - 下一步配置</h1>
          <p className="mt-1 text-sm text-muted-foreground">根据上一步的存储类型，补全项目存储配置。</p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium">创建信息确认</CardTitle>
          <CardDescription>下面是第一步填写的信息。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>名称：{state.name}</p>
          <p>类型：{state.projectType ?? "-"}</p>
          <p>存储：{storageLabel}</p>
          <p>项目信息：{state.projectInfo || "（未填写）"}</p>
          <p>初始标签：{state.tags && state.tags.length > 0 ? state.tags.map((t) => t.name).join("、") : "（未填写）"}</p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium">{storageLabel}配置</CardTitle>
          <CardDescription>
            {isRemoteStorage ? "请输入远程服务地址，当前仅作界面占位。" : "请选择本地存储路径，当前仅作界面占位。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isRemoteStorage ? (
            <>
              <div className="space-y-2">
                <label htmlFor="project-remote-ip" className="text-sm font-medium text-foreground">
                  远程 IP
                </label>
                <Input
                  id="project-remote-ip"
                  value={remoteIp}
                  onChange={(e) => setRemoteIp(e.target.value)}
                  placeholder="例如：192.168.1.100"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="project-remote-port" className="text-sm font-medium text-foreground">
                  端口
                </label>
                <Input
                  id="project-remote-port"
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  placeholder="例如：8080"
                  inputMode="numeric"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="project-local-path" className="text-sm font-medium text-foreground">
                  本地路径
                </label>
                {localPathError ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                    <CircleX className="h-3.5 w-3.5" aria-hidden />
                    {localPathError}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="project-local-path"
                  value={localPath}
                  onChange={(e) => {
                    setLocalPath(e.target.value)
                    if (localPathError) setLocalPathError(null)
                  }}
                  placeholder="例如：D:/datasets/project-a"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void handleSelectLocalPath()}
                  disabled={selectingPath}
                >
                  {selectingPath ? "选择中..." : "选择路径"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="outline" asChild>
              <Link to="/projects/new">上一步</Link>
            </Button>
            <Button type="button" onClick={() => void handleFinish()} disabled={creating}>
              {creating ? "创建中..." : "完成创建"}
            </Button>
          </div>
          {formError ? (
            <p className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
              <CircleX className="h-3.5 w-3.5" aria-hidden />
              {formError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

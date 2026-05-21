import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  deleteYoloBatchModel,
  fetchYoloBatchModels,
  probeBackendHealth,
  probeYoloBatchApiAvailable,
  resolveYoloBatchBackendContext,
  startYoloBatchModel,
  stopYoloBatchModel,
  updateYoloBatchModel,
  type YoloBatchBackendContext,
  type YoloBatchModel,
  type YoloBatchTaskId,
} from "@/lib/yolo-batch-api"
import { formatYoloBackendEndpointLabel } from "@/lib/yolo-dataset-upload"
import { cn } from "@/lib/utils"
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

const TASKS: Array<{ id: YoloBatchTaskId; label: string }> = [
  { id: "detect", label: "Detect" },
  { id: "obb", label: "OBB" },
  { id: "pose", label: "Pose" },
  { id: "segment", label: "Segment" },
]

function RunningDot({ running }: { running: boolean }) {
  return (
    <span
      className={cn("h-2.5 w-2.5 shrink-0 rounded-full", running ? "bg-emerald-500" : "bg-red-500")}
      title={running ? "已启动" : "未启动"}
      aria-label={running ? "模型已启动" : "模型未启动"}
    />
  )
}

function ModelRow({
  model,
  onRefresh,
}: {
  model: YoloBatchModel
  onRefresh: () => void
}) {
  const [name, setName] = useState(model.display_name)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(model.display_name)
  }, [model.display_name])

  const running = Boolean(model.running)

  const handleToggle = async () => {
    if (!model.ready) {
      window.alert("模型尚未完成配置，无法启动")
      return
    }
    setBusy(true)
    try {
      if (running) {
        await stopYoloBatchModel(model.model_slug)
      } else {
        await startYoloBatchModel(model.model_slug)
      }
      onRefresh()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  const handleNameBlur = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === model.display_name) return
    try {
      await updateYoloBatchModel(model.model_slug, { display_name: trimmed })
      onRefresh()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "保存名称失败")
      setName(model.display_name)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`确定删除模型「${model.display_name}」？`)) return
    setBusy(true)
    try {
      await deleteYoloBatchModel(model.model_slug)
      onRefresh()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "删除失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 bg-card px-4 py-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void handleNameBlur()}
        disabled={running || busy}
        className="min-w-[10rem] max-w-xs flex-1"
        aria-label="模型名称"
      />
      <span className="text-xs text-muted-foreground uppercase">{model.task ?? "—"}</span>
      {!model.ready ? (
        <span className="text-xs text-amber-600 dark:text-amber-400">未完成配置</span>
      ) : null}
      <Button
        type="button"
        variant={running ? "outline" : "default"}
        size="sm"
        disabled={busy || !model.ready}
        onClick={() => void handleToggle()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {running ? "停止" : "启动"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        disabled={busy || running}
        aria-label="删除模型"
        onClick={() => void handleDelete()}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <RunningDot running={running} />
    </li>
  )
}

export default function ModelsYoloBatchPage() {
  const navigate = useNavigate()
  const backendEndpoint = formatYoloBackendEndpointLabel()
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [backendCtx, setBackendCtx] = useState<YoloBatchBackendContext | null>(null)
  const [task, setTask] = useState<YoloBatchTaskId>("detect")
  const [models, setModels] = useState<YoloBatchModel[]>([])
  const [loading, setLoading] = useState(false)
  const [yoloApiOk, setYoloApiOk] = useState<boolean | null>(null)

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
    void resolveYoloBatchBackendContext().then(setBackendCtx)
    void probeYoloBatchApiAvailable().then(setYoloApiOk)
  }, [])

  const loadModels = useCallback(() => {
    setLoading(true)
    void fetchYoloBatchModels()
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refreshBackend()
    loadModels()
    const t = window.setInterval(() => {
      refreshBackend()
      loadModels()
    }, 3000)
    return () => window.clearInterval(t)
  }, [refreshBackend, loadModels])

  const filteredModels = useMemo(
    () => models.filter((m) => (m.task ?? "").toLowerCase() === task),
    [models, task],
  )

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Models">
          <Link to="/models">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">YOLO 批量标注工具</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            对项目中某一任务的全部图片调用 YOLO 模型进行标注；启停与文件均在当前连接的后端执行。
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 text-xs font-medium",
            backendEndpoint.mode === "remote"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/70 bg-muted/50 text-muted-foreground",
          )}
          title={backendEndpoint.label}
        >
          {backendEndpoint.mode === "remote" ? `远程 · ${backendEndpoint.label}` : "本地后端"}
        </span>
      </div>

      <Card
        className={cn(
          "border-border/80",
          (backendOk === false || yoloApiOk === false) && "border-destructive/40",
        )}
      >
        <CardContent className="flex flex-col gap-1 py-4 text-sm sm:flex-row sm:items-center sm:gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                backendOk === null ? "bg-muted-foreground/50" : backendOk ? "bg-emerald-500" : "bg-red-500",
              )}
            />
            {backendOk === null
              ? "正在检测后端…"
              : backendOk
                ? yoloApiOk === false
                  ? "后端已连通，但缺少 YOLO 批量标注 API（请重启后端）"
                  : backendEndpoint.mode === "remote"
                    ? `远程后端已就绪（${backendEndpoint.label}）`
                    : "本地后端已就绪"
                : "后端未连接，请先在设置中启动本地或连接远程后端"}
          </div>
          {backendCtx ? (
            <span className="text-xs text-muted-foreground sm:ml-2">
              模型目录：<code className="break-all">{backendCtx.storagePath}</code>
            </span>
          ) : null}
          <Button type="button" variant="outline" size="sm" className="sm:ml-auto" asChild>
            <Link to="/settings">设置</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-foreground">任务类型</span>
        <ToggleGroup
          type="single"
          value={task}
          onValueChange={(v) => {
            if (v) setTask(v as YoloBatchTaskId)
          }}
          className="flex flex-wrap justify-start"
        >
          {TASKS.map((t) => (
            <ToggleGroupItem key={t.id} value={t.id} className="px-4">
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          type="button"
          className="ml-auto gap-1"
          disabled={backendOk === false}
          onClick={() => navigate(`/models/yolo-batch/new/${task}`)}
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建模型
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">模型列表 · {task}</h2>
        {loading && models.length === 0 ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : filteredModels.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
            当前任务下暂无模型，点击「新建模型」添加。
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredModels.map((m) => (
              <ModelRow key={m.model_slug} model={m} onRefresh={loadModels} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

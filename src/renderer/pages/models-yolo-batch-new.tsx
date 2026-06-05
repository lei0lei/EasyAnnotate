import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ipc } from "@/gen/ipc"
import {
  finalizeYoloBatchModel,
  isYoloBatchRemoteBackend,
  modelNameToSlug,
  prepareYoloBatchModel,
  resolveYoloBatchBackendContext,
  transferYoloBatchDataYaml,
  transferYoloBatchWeights,
  type YoloBatchBackendContext,
  type YoloBatchTaskId,
  type YoloBatchUploadProgress,
} from "@/lib/yolo-batch-api"
import { formatYoloBackendEndpointLabel } from "@/lib/yolo-dataset-upload"
import { probeBackendHealth } from "@/lib/training-yolo-api"
import { GpuSwitch } from "@/pages/models-backend"
import { cn } from "@/lib/utils"
import { ArrowLeft, Loader2, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"

const VALID_TASKS: YoloBatchTaskId[] = ["detect", "segment", "pose", "obb"]

const TASK_LABEL: Record<YoloBatchTaskId, string> = {
  detect: "Detect",
  obb: "OBB",
  pose: "Pose",
  segment: "Segment",
}

function uploadPercent(progress: YoloBatchUploadProgress | null, kind: YoloBatchUploadProgress["kind"]): number | null {
  if (!progress || progress.kind !== kind) return null
  return progress.percent
}

export default function ModelsYoloBatchNewPage() {
  const { task: taskParam } = useParams<{ task: string }>()
  const navigate = useNavigate()
  const task = (taskParam?.trim().toLowerCase() ?? "") as YoloBatchTaskId

  const isRemote = isYoloBatchRemoteBackend()
  const backendEndpoint = formatYoloBackendEndpointLabel()

  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [backendCtx, setBackendCtx] = useState<YoloBatchBackendContext | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [conf, setConf] = useState("0.25")
  const [iou, setIou] = useState("0.7")
  const [imgsz, setImgsz] = useState("640")
  const [maxDet, setMaxDet] = useState("300")
  const [useGpu, setUseGpu] = useState(true)
  const [yamlLabel, setYamlLabel] = useState<string | null>(null)
  const [yamlLocalPath, setYamlLocalPath] = useState("")
  const [ptLabel, setPtLabel] = useState<string | null>(null)
  const [ptLocalPath, setPtLocalPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<YoloBatchUploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewSlug = useMemo(() => modelNameToSlug(displayName), [displayName])

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
    void resolveYoloBatchBackendContext().then(setBackendCtx)
  }, [])

  useEffect(() => {
    refreshBackend()
  }, [refreshBackend])

  if (!VALID_TASKS.includes(task)) {
    return <Navigate to="/models/yolo-batch" replace />
  }

  async function pickYaml() {
    const picked = await ipc.app.SelectFiles({
      title: "选择 data.yaml",
      defaultPath: "",
    })
    if (picked.canceled || !picked.paths[0]) return
    setYamlLocalPath(picked.paths[0])
    setYamlLabel(picked.paths[0].split(/[/\\]/).pop() ?? picked.paths[0])
  }

  async function pickPt() {
    const picked = await ipc.app.SelectFiles({
      title: "选择 YOLO 权重 .pt",
      defaultPath: "",
    })
    if (picked.canceled || !picked.paths[0]) return
    setPtLocalPath(picked.paths[0])
    setPtLabel(picked.paths[0].split(/[/\\]/).pop() ?? picked.paths[0])
  }

  const handleCreate = async () => {
    const name = displayName.trim()
    if (!name) {
      setError("请填写模型名称")
      return
    }
    const hasYaml = Boolean(yamlLocalPath)
    const hasPt = Boolean(ptLocalPath)
    if (!hasYaml) {
      setError("请上传 data.yaml（含类别名 names）")
      return
    }
    if (!hasPt) {
      setError("请上传 .pt 权重文件")
      return
    }
    const confN = Number(conf)
    const iouN = Number(iou)
    const imgszN = Number(imgsz)
    const maxDetN = Number(maxDet)
    if (!Number.isFinite(confN) || confN < 0 || confN > 1) {
      setError("置信度阈值须在 0～1 之间")
      return
    }
    if (!Number.isFinite(iouN) || iouN < 0 || iouN > 1) {
      setError("IoU 须在 0～1 之间")
      return
    }
    if (!Number.isFinite(imgszN) || imgszN < 32) {
      setError("推理尺寸无效")
      return
    }
    if (!Number.isFinite(maxDetN) || maxDetN < 1) {
      setError("最大检测数无效")
      return
    }

    setBusy(true)
    setError(null)
    setUploadProgress(null)
    try {
      const prepared = await prepareYoloBatchModel({
        display_name: name,
        task,
        conf: confN,
        iou: iouN,
        imgsz: imgszN,
        max_det: maxDetN,
        use_gpu: useGpu,
      })
      const slug = prepared.model_slug

      await transferYoloBatchDataYaml(slug, { localPath: yamlLocalPath }, { onProgress: setUploadProgress })
      await transferYoloBatchWeights(slug, { localPath: ptLocalPath }, { onProgress: setUploadProgress })
      await finalizeYoloBatchModel(slug)
      navigate("/models/yolo-batch")
    } catch (e) {
      setError(e instanceof Error ? e.message : "新建失败")
    } finally {
      setBusy(false)
      setUploadProgress(null)
    }
  }

  const yamlPct = uploadPercent(uploadProgress, "data_yaml")
  const ptPct = uploadPercent(uploadProgress, "weights")

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回批量标注工具">
          <Link to="/models/yolo-batch">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            新建模型 · {TASK_LABEL[task]}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">YOLO 批量标注工具</h1>
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

      <Card className={cn("border-border/80", backendOk === false && "border-destructive/40")}>
        <CardContent className="space-y-1 py-3 text-sm text-muted-foreground">
          <p>
            {isRemote
              ? "已连接远程后端：模型文件将经 WebSocket 分片上传到远程服务器的"
              : "使用本地后端：模型文件将经 WebSocket 分片上传到"}
            <code className="text-xs"> external/model_temp</code>
          </p>
          {backendCtx ? (
            <p>
              存储路径：<code className="break-all text-xs">{backendCtx.storagePath}</code>
              {previewSlug ? (
                <>
                  {" "}
                  / <code className="text-xs">{previewSlug}</code>
                </>
              ) : null}
            </p>
          ) : null}
          <p className="text-xs">启停模型均在当前连接的后端进程内执行（远程连远程，本地连本地）。</p>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="text-base">模型名称</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例如：产线检测 v1"
            disabled={busy}
          />
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="text-base">推理参数</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">置信度 conf</span>
            <Input value={conf} onChange={(e) => setConf(e.target.value)} disabled={busy} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">NMS IoU</span>
            <Input value={iou} onChange={(e) => setIou(e.target.value)} disabled={busy} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">推理尺寸 imgsz</span>
            <Input value={imgsz} onChange={(e) => setImgsz(e.target.value)} disabled={busy} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">最大检测数 max_det</span>
            <Input value={maxDet} onChange={(e) => setMaxDet(e.target.value)} disabled={busy} />
          </label>
          <div className="sm:col-span-2">
            <GpuSwitch
              id="yolo-batch-use-gpu"
              checked={useGpu}
              disabled={busy}
              onCheckedChange={setUseGpu}
              label="启动时使用 GPU（当前连接的后端）"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="text-base">上传文件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void pickYaml()}>
              <Upload className="mr-2 h-4 w-4" aria-hidden />
              选择 data.yaml（WebSocket 上传）
            </Button>
            <span className="text-sm text-muted-foreground">{yamlLabel ?? "未选择"}</span>
            {yamlPct != null ? <span className="text-xs text-muted-foreground">{yamlPct}%</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void pickPt()}>
              <Upload className="mr-2 h-4 w-4" aria-hidden />
              选择 .pt 权重（WebSocket 上传）
            </Button>
            <span className="text-sm text-muted-foreground">{ptLabel ?? "未选择"}</span>
            {ptPct != null ? <span className="text-xs text-muted-foreground">{ptPct}%</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            data.yaml 与 .pt 权重均经 WebSocket 5MB 分片上传（本地/远程同一通道）。
            {" "}
            data.yaml 须包含 <code className="text-xs">names</code> 类别列表。
          </p>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={busy || backendOk === false} onClick={() => void handleCreate()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          新建完成
        </Button>
        <Button type="button" variant="outline" disabled={busy} asChild>
          <Link to="/models/yolo-batch">取消</Link>
        </Button>
      </div>
    </div>
  )
}

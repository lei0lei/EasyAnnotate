import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import {
  fetchYoloDevices,
  fetchYoloModels,
  fetchYoloTrainStatus,
  fetchYoloWorkspace,
  prepareYoloTrainingJob,
  probeBackendHealth,
  selectYoloBaseModel,
  startYoloTraining,
  unpackYoloDataset,
  uploadYoloBaseModel,
  uploadYoloDatasetZip,
  type YoloCatalogModel,
  type YoloFamilyId,
  type YoloTaskId,
} from "@/lib/training-yolo-api"
import { cn } from "@/lib/utils"
import { ArrowLeft, FolderArchive, LineChart, Play, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

const FAMILIES: Array<{ id: YoloFamilyId; label: string }> = [
  { id: "yolov8", label: "YOLOv8" },
  { id: "yolo26", label: "YOLO26" },
]

const TASKS: Array<{ id: YoloTaskId; label: string }> = [
  { id: "detect", label: "Detect" },
  { id: "segment", label: "Segment" },
  { id: "pose", label: "Pose" },
  { id: "obb", label: "OBB" },
]

export default function ModelsTrainingYoloPage() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const [trainingName, setTrainingName] = useState("")
  const [jobSlug, setJobSlug] = useState("")
  const [prepareBusy, setPrepareBusy] = useState(false)

  const [family, setFamily] = useState<YoloFamilyId>("yolov8")
  const [task, setTask] = useState<YoloTaskId>("detect")
  const [models, setModels] = useState<YoloCatalogModel[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState("")
  const [modelsLoading, setModelsLoading] = useState(false)

  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [dataYaml, setDataYaml] = useState<string | null>(null)
  const [baseModelReady, setBaseModelReady] = useState(false)

  const [datasetBusy, setDatasetBusy] = useState(false)
  const [baseModelBusy, setBaseModelBusy] = useState(false)
  const [training, setTraining] = useState(false)
  const [trainProgress, setTrainProgress] = useState(0)
  const [trainMessage, setTrainMessage] = useState("")

  const [epochs, setEpochs] = useState(100)
  const [imgsz, setImgsz] = useState(640)
  const [batch, setBatch] = useState(16)
  const [patience, setPatience] = useState(50)
  const [device, setDevice] = useState("cpu")
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([])

  const isLocalBackend = !loadAppConfig().backend.remoteConnected
  const localBackendDir = loadAppConfig().backend.localBackendDir?.trim() ?? ""

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  const refreshWorkspace = useCallback(() => {
    if (!jobSlug) return
    void fetchYoloWorkspace(jobSlug)
      .then((ws) => {
        setWorkspaceReady(Boolean(ws.dataset_dir || ws.data_yaml))
        setDataYaml(ws.data_yaml)
        setBaseModelReady(Boolean(ws.base_model))
        if (ws.base_model_asset_id && typeof ws.base_model_asset_id === "string") {
          setSelectedAssetId(ws.base_model_asset_id)
        }
      })
      .catch(() => {
        /* backend may be down */
      })
  }, [jobSlug])

  useEffect(() => {
    refreshBackend()
    const t = window.setInterval(refreshBackend, 2500)
    return () => window.clearInterval(t)
  }, [refreshBackend])

  useEffect(() => {
    if (!backendOk || !jobSlug) return
    refreshWorkspace()
    void fetchYoloDevices()
      .then(setDevices)
      .catch(() => setDevices([{ id: "cpu", label: "CPU" }]))
  }, [backendOk, jobSlug, refreshWorkspace])

  useEffect(() => {
    if (!backendOk) return
    setModelsLoading(true)
    void fetchYoloModels(family, task)
      .then((list) => {
        setModels(list)
        if (list.length > 0 && !list.some((m) => m.asset_id === selectedAssetId)) {
          setSelectedAssetId(list[0]?.asset_id ?? "")
        }
      })
      .catch((e) => setHint(e instanceof Error ? e.message : String(e)))
      .finally(() => setModelsLoading(false))
  }, [backendOk, family, task, selectedAssetId])

  useEffect(() => {
    if (!jobSlug || !backendOk || baseModelReady || baseModelBusy || !selectedAssetId || modelsLoading) return
    void handleSelectRegistryModel(selectedAssetId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when catalog / job context changes
  }, [jobSlug, backendOk, selectedAssetId, modelsLoading, family, task])

  useEffect(() => {
    if (!training) return
    let alive = true
    const tick = () => {
      void fetchYoloTrainStatus(jobSlug)
        .then(({ job }) => {
          if (!alive) return
          setTrainProgress(job.progress)
          setTrainMessage(job.message)
          if (job.status === "success" || job.status === "failed") {
            setTraining(false)
            refreshWorkspace()
          } else {
            window.setTimeout(tick, 1000)
          }
        })
        .catch(() => {
          if (alive) window.setTimeout(tick, 1500)
        })
    }
    tick()
    return () => {
      alive = false
    }
  }, [training, jobSlug, refreshWorkspace])

  const jobReady = Boolean(jobSlug)
  const canStart = useMemo(
    () => jobReady && backendOk && baseModelReady && Boolean(dataYaml) && !training,
    [jobReady, backendOk, baseModelReady, dataYaml, training],
  )

  const startChecklist = useMemo(
    () => [
      { label: "后端 API 已连接", done: Boolean(backendOk) },
      { label: "已创建本次训练任务", done: jobReady },
      {
        label: baseModelReady
          ? "初始权重已就绪（registry 或上传 .pt）"
          : models.length === 0
            ? "初始权重：registry 无可用模型，请上传 .pt 或先 install-resources"
            : "初始权重：在下拉框选择后点击「使用所选 registry 权重」，或上传 .pt",
        done: baseModelReady,
      },
      {
        label: dataYaml
          ? "训练数据集已解压（含 data.yaml）"
          : isLocalBackend
            ? "训练数据：点击「选择 ZIP 数据集」并解压"
            : "训练数据：上传 ZIP 数据集（远程后端）",
        done: Boolean(dataYaml),
      },
    ],
    [backendOk, jobReady, baseModelReady, dataYaml, models.length, isLocalBackend],
  )

  async function handlePrepareJob() {
    const name = trainingName.trim()
    if (!name) {
      setHint("请填写本次训练名称")
      return
    }
    setPrepareBusy(true)
    setHint(null)
    try {
      const prepared = await prepareYoloTrainingJob(name)
      setJobSlug(prepared.job_slug)
      setHint(`已创建训练目录：external/temp/${prepared.job_slug}`)
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setPrepareBusy(false)
    }
  }

  async function handleSelectRegistryModel(assetId = selectedAssetId) {
    if (!jobSlug || !assetId) return
    setBaseModelBusy(true)
    setHint(null)
    try {
      await selectYoloBaseModel(jobSlug, assetId)
      setBaseModelReady(true)
      setHint("已选用 registry 初始权重")
      refreshWorkspace()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBaseModelBusy(false)
    }
  }

  async function handleUploadBaseModel(file: File | null) {
    if (!jobSlug || !file) return
    setBaseModelBusy(true)
    setHint(null)
    try {
      await uploadYoloBaseModel(jobSlug, file)
      setBaseModelReady(true)
      setHint("已上传自定义权重")
      refreshWorkspace()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setBaseModelBusy(false)
    }
  }

  async function handlePickDatasetZip() {
    if (!jobSlug) {
      setHint("请先创建训练任务")
      return
    }
    if (!isLocalBackend) {
      setHint("远程后端请使用下方「上传 ZIP 数据集」")
      return
    }
    setDatasetBusy(true)
    setHint(null)
    try {
      const picked = await ipc.app.SelectFiles({
        title: "选择训练数据集（ZIP）",
        defaultPath: "",
      })
      if (picked.canceled || !picked.paths[0]) return
      if (!localBackendDir) {
        setHint("请先在设置中配置本地 backend 目录")
        return
      }
      const copy = await ipc.app.CopyYoloTrainingDatasetZip({
        backendDirectory: localBackendDir,
        sourceZipPath: picked.paths[0],
        trainingName: trainingName.trim() || jobSlug,
      })
      if (!copy.ok) {
        setHint(copy.errorMessage || "复制数据集失败")
        return
      }
      const unpacked = await unpackYoloDataset(jobSlug)
      setDataYaml(unpacked.data_yaml)
      setWorkspaceReady(true)
      setHint(`数据集已写入 external/temp/${jobSlug} 并解压`)
      refreshWorkspace()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setDatasetBusy(false)
    }
  }

  async function handleUploadDatasetZip(file: File | null) {
    if (!jobSlug || !file) return
    setDatasetBusy(true)
    setHint(null)
    try {
      const uploaded = await uploadYoloDatasetZip(jobSlug, file)
      setDataYaml(uploaded.data_yaml)
      setWorkspaceReady(true)
      setHint(`数据集已上传至 external/temp/${jobSlug} 并解压`)
      refreshWorkspace()
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    } finally {
      setDatasetBusy(false)
    }
  }

  async function handleStartTraining() {
    if (!jobSlug) return
    setTraining(true)
    setTrainProgress(0)
    setTrainMessage("正在启动训练…")
    setHint(null)
    try {
      await startYoloTraining(jobSlug, { epochs, imgsz, batch, device, patience })
    } catch (e) {
      setTraining(false)
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回模型训练">
              <Link to="/models/training">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">YOLO 训练</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                每次训练在 <code className="text-xs">external/temp/&lt;训练名&gt;/</code> 独立目录
              </p>
            </div>
          </div>

      <Card className={cn("border-border/80", backendOk === false && "border-destructive/50")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">后端连接</CardTitle>
          <CardDescription>
            {isLocalBackend
              ? "当前为本地后端（127.0.0.1:8000），请先在设置中启动本地 API"
              : "当前为远程后端，训练数据与 temp 目录在远程机器上"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              backendOk === null ? "bg-muted-foreground/50" : backendOk ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          {backendOk === null ? "检测中…" : backendOk ? "后端已连接" : "后端不可用"}
          <Button type="button" variant="outline" size="sm" className="ml-auto" asChild>
            <Link to="/settings">打开设置</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">本次训练</CardTitle>
          <CardDescription>名称用作 temp 子文件夹名；同名已存在时需更换</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1 text-sm">
            <span className="text-muted-foreground">训练名称</span>
            <Input
              value={trainingName}
              onChange={(e) => setTrainingName(e.target.value)}
              placeholder="例如 retail-counter-v1"
              disabled={Boolean(jobSlug) || prepareBusy}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!backendOk || prepareBusy || Boolean(jobSlug) || !trainingName.trim()}
            onClick={() => void handlePrepareJob()}
          >
            {prepareBusy ? "创建中…" : jobSlug ? "已创建" : "创建训练任务"}
          </Button>
        </CardContent>
        {jobSlug ? (
          <p className="px-6 pb-4 text-xs text-muted-foreground">
            当前目录：<span className="font-mono">external/temp/{jobSlug}</span>
          </p>
        ) : null}
      </Card>

      <Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">模型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">模型族</p>
            <ToggleGroup
              type="single"
              value={family}
              onValueChange={(v) => v && setFamily(v as YoloFamilyId)}
              className="flex flex-wrap justify-start gap-2"
            >
              {FAMILIES.map((f) => (
                <ToggleGroupItem key={f.id} value={f.id} className="px-4">
                  {f.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">任务</p>
            <ToggleGroup
              type="single"
              value={task}
              onValueChange={(v) => v && setTask(v as YoloTaskId)}
              className="flex flex-wrap justify-start gap-2"
            >
              {TASKS.map((t) => (
                <ToggleGroupItem key={t.id} value={t.id} className="px-3">
                  {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">初始权重（resources/ultralytics）</p>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              disabled={!jobReady || !backendOk || modelsLoading || models.length === 0 || baseModelBusy}
            >
              {models.length === 0 ? <option value="">无可用模型（请先 install-resources）</option> : null}
              {models.map((m) => (
                <option key={m.asset_id} value={m.asset_id}>
                  {m.label} ({m.asset_id})
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!jobReady || !backendOk || !selectedAssetId || baseModelBusy}
                onClick={() => void handleSelectRegistryModel()}
              >
                使用所选 registry 权重
              </Button>
              <label className="inline-flex cursor-pointer items-center">
                <input
                  type="file"
                  accept=".pt"
                  className="sr-only"
                  disabled={!jobReady || !backendOk || baseModelBusy}
                  onChange={(e) => void handleUploadBaseModel(e.target.files?.[0] ?? null)}
                />
                <span
                  className={cn(
                    "inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium",
                    (!backendOk || baseModelBusy) && "pointer-events-none opacity-50",
                  )}
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  上传 .pt
                </span>
              </label>
            </div>
            {baseModelReady ? <p className="text-xs text-emerald-600 dark:text-emerald-400">基础模型已就绪</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">训练数据</CardTitle>
          <CardDescription>仅支持 ZIP；解压到本次训练目录（需含 data.yaml）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLocalBackend ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={!jobReady || !backendOk || datasetBusy}
              onClick={() => void handlePickDatasetZip()}
            >
              <FolderArchive className="h-4 w-4" />
              {datasetBusy ? "处理中…" : "选择 ZIP 数据集"}
            </Button>
          ) : (
            <label className="inline-flex cursor-pointer items-center">
              <input
                type="file"
                accept=".zip"
                className="sr-only"
                disabled={!jobReady || !backendOk || datasetBusy}
                onChange={(e) => void handleUploadDatasetZip(e.target.files?.[0] ?? null)}
              />
              <span
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium",
                  (!jobReady || !backendOk || datasetBusy) && "pointer-events-none opacity-50",
                )}
              >
                <FolderArchive className="h-4 w-4" />
                {datasetBusy ? "处理中…" : "上传 ZIP 数据集"}
              </span>
            </label>
          )}
          {dataYaml ? <p className="break-all text-xs text-emerald-600 dark:text-emerald-400">data.yaml: {dataYaml}</p> : null}
        </CardContent>
      </Card>

      <Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">高级参数</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">训练轮数 epochs</span>
            <Input
              type="number"
              min={1}
              value={epochs}
              onChange={(e) => setEpochs(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">图像尺寸 imgsz</span>
            <Input
              type="number"
              min={32}
              step={32}
              value={imgsz}
              onChange={(e) => setImgsz(Math.max(32, Number(e.target.value) || 640))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">batch</span>
            <Input
              type="number"
              min={1}
              value={batch}
              onChange={(e) => setBatch(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">早停 patience</span>
            <Input
              type="number"
              min={0}
              value={patience}
              onChange={(e) => setPatience(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">设备</span>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="flex flex-col gap-4 py-4">
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {startChecklist.map((item) => (
              <li key={item.label} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    item.done ? "bg-emerald-500" : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className={item.done ? "text-foreground/80" : undefined}>{item.label}</span>
              </li>
            ))}
          </ul>
          <Button type="button" className="gap-2" disabled={!canStart} onClick={() => void handleStartTraining()}>
            <Play className="h-4 w-4" />
            {training ? "训练中…" : "开始训练"}
          </Button>
          {training || trainMessage ? (
            <div className="space-y-1.5">
              <div className="h-2.5 overflow-hidden rounded-full bg-muted/90">
                <div
                  className="h-full rounded-full bg-primary/90 transition-[width] duration-300"
                  style={{ width: `${trainProgress}%` }}
                  role="progressbar"
                  aria-valuenow={trainProgress}
                />
              </div>
              <p className="text-xs text-muted-foreground">{trainMessage || "…"}</p>
              {training ? (
                <p className="text-xs text-muted-foreground/90">
                  首轮开始前会校验数据集，可能需数分钟；无进展时请查看{" "}
                  <code className="text-[11px]">external/temp/{jobSlug}/train.log</code>
                  {jobSlug ? (
                    <>
                      {" "}
                      或{" "}
                      <Link to={`/models/training/history/${jobSlug}`} className="underline underline-offset-2">
                        训练历史日志
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {hint ? <p className="text-sm text-destructive">{hint}</p> : null}
        </div>
      </div>
    </div>
  )
}

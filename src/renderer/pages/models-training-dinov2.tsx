import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDinov2TrainingMessages } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { GpuSwitch } from "@/pages/models-backend"
import {
  fetchDinov2TrainingCatalog,
  fetchDinov2Devices,
  fetchDinov2Models,
  fetchDinov2TrainStatus,
  fetchDinov2TrainingHistory,
  fetchDinov2Workspace,
  formatDinov2BackendEndpointLabel,
  prepareDinov2TrainingJob,
  probeBackendHealth,
  selectDinov2BaseModel,
  startDinov2Training,
  trainingNameToJobSlug,
  uploadDinov2BaseModel,
  uploadDinov2DatasetZip,
  type Dinov2CatalogModel,
  type Dinov2DeviceOption,
  type Dinov2ObjectiveId,
} from "@/lib/training-dinov2-api"
import { ArrowLeft, Loader2, Plus, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Link } from "react-router-dom"

const DINOV2_PIPELINE_READY = true

const UPLOADED_WEIGHT_VALUE = "__uploaded_weight__"
const OBJECTIVE_IDS: Dinov2ObjectiveId[] = ["linear_probe", "fine_tune", "partial_tune"]

type ChecklistTone = "done" | "warn" | "error" | "pending"

function ChecklistRow({ label, tone }: { label: string; tone: ChecklistTone }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={cn(
          "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
          tone === "done" && "bg-emerald-500",
          tone === "warn" && "bg-amber-500",
          tone === "error" && "bg-red-500",
          tone === "pending" && "bg-muted-foreground/40",
        )}
        aria-hidden
      />
      <span
        className={cn(
          tone === "done" && "text-foreground",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "error" && "text-destructive",
          tone === "pending" && "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </li>
  )
}

export default function ModelsTrainingDinov2Page() {
  const { m } = useDinov2TrainingMessages()
  const weightFileRef = useRef<HTMLInputElement>(null)
  const datasetFileRef = useRef<HTMLInputElement>(null)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  const [trainingName, setTrainingName] = useState("")
  const [jobSlug, setJobSlug] = useState("")
  const [prepareBusy, setPrepareBusy] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [historySlugs, setHistorySlugs] = useState<Set<string>>(new Set())

  const [objective, setObjective] = useState<Dinov2ObjectiveId>("linear_probe")
  const [objectiveOptions, setObjectiveOptions] = useState<Array<{ id: Dinov2ObjectiveId; label: string }>>(
    OBJECTIVE_IDS.map((id) => ({ id, label: m.objectives[id] })),
  )
  const [models, setModels] = useState<Dinov2CatalogModel[]>([])
  const [selectedWeightKey, setSelectedWeightKey] = useState("")
  const [uploadedWeightLabel, setUploadedWeightLabel] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)

  const [baseModelReady, setBaseModelReady] = useState(false)
  const [baseModelBusy, setBaseModelBusy] = useState(false)
  const [baseModelError, setBaseModelError] = useState<string | null>(null)

  const [datasetReady, setDatasetReady] = useState(false)
  const [datasetImageCount, setDatasetImageCount] = useState(0)
  const [datasetZipFilename, setDatasetZipFilename] = useState<string | null>(null)
  const [datasetBusy, setDatasetBusy] = useState(false)
  const [datasetPhase, setDatasetPhase] = useState<"uploading" | "unpacking" | null>(null)
  const [datasetError, setDatasetError] = useState<string | null>(null)

  const [training, setTraining] = useState(false)
  const [trainProgress, setTrainProgress] = useState(0)
  const [trainMessage, setTrainMessage] = useState("")
  const [startError, setStartError] = useState<string | null>(null)

  const [epochs, setEpochs] = useState(50)
  const [batch, setBatch] = useState(8)
  const [lr, setLr] = useState(0.0001)
  const [weightDecay, setWeightDecay] = useState(0.01)
  const [imgsz, setImgsz] = useState(518)
  const [workers, setWorkers] = useState(2)
  const [device, setDevice] = useState("cpu")
  const [freezeBackbone, setFreezeBackbone] = useState(true)
  const [devices, setDevices] = useState<Dinov2DeviceOption[]>([])

  const backendEndpoint = formatDinov2BackendEndpointLabel()

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  const loadHistorySlugs = useCallback(() => {
    void fetchDinov2TrainingHistory()
      .then((items) => setHistorySlugs(new Set(items.map((i) => i.job_slug))))
      .catch(() => setHistorySlugs(new Set()))
  }, [])

  const applyWorkspace = useCallback((ws: Awaited<ReturnType<typeof fetchDinov2Workspace>>) => {
    setDatasetReady(Boolean(ws.dataset_ready))
    setDatasetImageCount(ws.dataset_image_count ?? 0)
    setDatasetZipFilename(ws.dataset_zip_filename ?? null)
    setBaseModelReady(Boolean(ws.base_model))
    if (ws.objective && OBJECTIVE_IDS.includes(ws.objective as Dinov2ObjectiveId)) {
      setObjective(ws.objective as Dinov2ObjectiveId)
    }
    if (ws.base_model_asset_id) {
      setSelectedWeightKey(ws.base_model_asset_id)
      setUploadedWeightLabel(null)
    } else if (ws.base_model) {
      setSelectedWeightKey(UPLOADED_WEIGHT_VALUE)
      setUploadedWeightLabel(ws.base_model_filename ?? m.errors.uploadedWeightFallback)
    }
  }, [m.errors.uploadedWeightFallback])

  const refreshWorkspace = useCallback(() => {
    if (!jobSlug) return
    void fetchDinov2Workspace(jobSlug)
      .then(applyWorkspace)
      .catch(() => {
        /* backend may be down */
      })
  }, [jobSlug, applyWorkspace])

  useEffect(() => {
    setObjectiveOptions(OBJECTIVE_IDS.map((id) => ({ id, label: m.objectives[id] })))
  }, [m.objectives])

  useEffect(() => {
    refreshBackend()
    loadHistorySlugs()
    const t = window.setInterval(refreshBackend, 2500)
    return () => window.clearInterval(t)
  }, [refreshBackend, loadHistorySlugs])

  const devicesInflightRef = useRef<Promise<Dinov2DeviceOption[]> | null>(null)

  const fetchDevicesList = useCallback((): Promise<Dinov2DeviceOption[]> => {
    if (!backendOk) {
      return Promise.resolve([{ id: "cpu", label: "CPU" }])
    }
    if (devicesInflightRef.current) return devicesInflightRef.current
    const p = fetchDinov2Devices()
      .catch(() => [{ id: "cpu", label: "CPU" }])
      .finally(() => {
        devicesInflightRef.current = null
      })
    devicesInflightRef.current = p
    return p
  }, [backendOk])

  const applyDevicesList = useCallback((list: Dinov2DeviceOption[]) => {
    setDevices(list)
    setDevice((prev) => {
      if (list.length > 0 && !list.some((d) => d.id === prev)) {
        return list[0]?.id ?? "cpu"
      }
      return prev
    })
  }, [])

  const refreshDevices = useCallback(() => {
    void fetchDevicesList().then(applyDevicesList)
  }, [fetchDevicesList, applyDevicesList])

  const openDevicePicker = useCallback(
    async (select: HTMLSelectElement) => {
      const list = await fetchDevicesList()
      flushSync(() => applyDevicesList(list))
      if (typeof select.showPicker === "function") {
        try {
          select.showPicker()
        } catch {
          select.focus()
        }
      } else {
        select.focus()
      }
    },
    [fetchDevicesList, applyDevicesList],
  )

  useEffect(() => {
    if (!backendOk || !jobSlug) return
    refreshWorkspace()
    refreshDevices()
  }, [backendOk, jobSlug, refreshWorkspace, refreshDevices])

  useEffect(() => {
    if (objective === "linear_probe") {
      setFreezeBackbone(true)
    } else if (objective === "fine_tune") {
      setFreezeBackbone(false)
    }
  }, [objective])

  useEffect(() => {
    if (!backendOk) return
    void fetchDinov2TrainingCatalog()
      .then((catalog) => {
        const next = (catalog.objectives ?? []).filter(
          (item): item is { id: Dinov2ObjectiveId; label: string } => OBJECTIVE_IDS.includes(item.id),
        )
        if (next.length > 0) {
          setObjectiveOptions(next)
          setObjective((prev) => (next.some((item) => item.id === prev) ? prev : next[0].id))
        } else {
          setObjectiveOptions(OBJECTIVE_IDS.map((id) => ({ id, label: m.objectives[id] })))
        }
      })
      .catch(() => {
        setObjectiveOptions(OBJECTIVE_IDS.map((id) => ({ id, label: m.objectives[id] })))
      })

    setModelsLoading(true)
    void fetchDinov2Models()
      .then((list) => {
        setModels(list)
        setSelectedWeightKey((prev) => {
          if (prev === UPLOADED_WEIGHT_VALUE) return prev
          if (list.some((item) => item.asset_id === prev)) return prev
          return list[0]?.asset_id ?? ""
        })
      })
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false))
  }, [backendOk, m.objectives])

  const lastObservedStatusRef = useRef<string>("idle")
  useEffect(() => {
    if (!backendOk || !jobSlug) return
    lastObservedStatusRef.current = "idle"
    let alive = true
    const tick = () => {
      void fetchDinov2TrainStatus(jobSlug)
        .then(({ job }) => {
          if (!alive) return
          const nextProgress = Number.isFinite(job.progress) ? job.progress : 0
          setTrainProgress(nextProgress)
          setTraining(job.status === "running")
          setTrainMessage(job.message || "")
          if (job.status === "failed" && job.last_error) {
            setStartError(job.last_error)
          }

          const prev = lastObservedStatusRef.current
          if (prev !== job.status && (job.status === "success" || job.status === "failed")) {
            refreshWorkspace()
            loadHistorySlugs()
          }
          lastObservedStatusRef.current = job.status
          window.setTimeout(tick, job.status === "running" ? 1000 : 2000)
        })
        .catch(() => {
          if (alive) window.setTimeout(tick, 2000)
        })
    }
    tick()
    return () => {
      alive = false
    }
  }, [backendOk, jobSlug, refreshWorkspace, loadHistorySlugs])

  const slugPreview = useMemo(() => trainingNameToJobSlug(trainingName), [trainingName])
  const nameDuplicate = Boolean(slugPreview && historySlugs.has(slugPreview) && slugPreview !== jobSlug)
  const jobReady = Boolean(jobSlug)

  const canStart = useMemo(
    () =>
      DINOV2_PIPELINE_READY &&
      Boolean(jobSlug) &&
      Boolean(backendOk) &&
      baseModelReady &&
      datasetReady &&
      !training,
    [jobSlug, backendOk, baseModelReady, datasetReady, training],
  )

  const backendChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (backendOk === null) return { label: m.checklist.backendChecking, tone: "pending" }
    if (!backendOk) return { label: m.checklist.backendDisconnected, tone: "error" }
    return { label: m.checklist.backendConnected, tone: "done" }
  }, [backendOk, m.checklist])

  const jobChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (nameError) return { label: nameError, tone: "error" }
    if (nameDuplicate) return { label: m.checklist.nameDuplicate, tone: "error" }
    if (jobReady) return { label: m.checklist.jobCreated(jobSlug), tone: "done" }
    if (slugPreview) return { label: m.checklist.nameThenCreate, tone: "pending" }
    return { label: m.checklist.createWorkspaceFirst, tone: "pending" }
  }, [nameError, nameDuplicate, jobReady, jobSlug, slugPreview, m.checklist])

  const weightChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (!jobReady) return { label: m.checklist.weightNeedWorkspace, tone: "pending" }
    if (baseModelBusy) return { label: m.checklist.weightBinding, tone: "pending" }
    if (baseModelError) return { label: baseModelError, tone: "error" }
    if (!baseModelReady) {
      if (models.length === 0) {
        return { label: m.checklist.weightNoRegistry, tone: "pending" }
      }
      return { label: m.checklist.weightSelectOrUpload, tone: "pending" }
    }
    return { label: m.checklist.weightReady, tone: "done" }
  }, [jobReady, baseModelBusy, baseModelError, baseModelReady, models.length, m.checklist])

  const datasetChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (!jobReady) return { label: m.checklist.datasetNeedWorkspace, tone: "pending" }
    if (datasetError) return { label: datasetError, tone: "error" }
    if (datasetReady) {
      return { label: m.checklist.datasetReady(datasetImageCount, datasetZipFilename), tone: "done" }
    }
    return { label: m.checklist.datasetUploadZip, tone: "pending" }
  }, [jobReady, datasetError, datasetReady, datasetImageCount, datasetZipFilename, m.checklist])

  const startChecklistExtra = useMemo((): { label: string; tone: ChecklistTone } | null => {
    if (!startError) return null
    return { label: startError, tone: "error" }
  }, [startError])

  async function handlePrepareJob() {
    const name = trainingName.trim()
    if (!name) {
      setNameError(m.errors.nameRequired)
      return
    }
    const slug = trainingNameToJobSlug(name)
    if (!slug) {
      setNameError(m.errors.nameInvalid)
      return
    }
    if (historySlugs.has(slug)) {
      setNameError(m.errors.nameDuplicate)
      return
    }
    if (!backendOk) {
      setNameError(m.errors.connectBackend)
      return
    }
    setPrepareBusy(true)
    setNameError(null)
    setDatasetError(null)
    setStartError(null)
    try {
      const prepared = await prepareDinov2TrainingJob(name)
      setJobSlug(prepared.job_slug)
      setHistorySlugs((prev) => new Set(prev).add(prepared.job_slug))
    } catch (e) {
      setNameError(e instanceof Error ? e.message : String(e))
    } finally {
      setPrepareBusy(false)
    }
  }

  async function handleSelectRegistryWeight(assetId: string) {
    if (!jobSlug || !assetId || assetId === UPLOADED_WEIGHT_VALUE) return
    setBaseModelBusy(true)
    setBaseModelError(null)
    try {
      await selectDinov2BaseModel(jobSlug, assetId, objective)
      setBaseModelReady(true)
      setUploadedWeightLabel(null)
      refreshWorkspace()
    } catch (e) {
      setBaseModelReady(false)
      setBaseModelError(e instanceof Error ? e.message : String(e))
    } finally {
      setBaseModelBusy(false)
    }
  }

  async function handleUploadBaseModel(file: File | null) {
    if (!jobSlug || !file) return
    const archId =
      selectedWeightKey && selectedWeightKey !== UPLOADED_WEIGHT_VALUE ? selectedWeightKey : ""
    if (!archId) {
      setBaseModelError(m.errors.selectArchBeforeUpload)
      return
    }
    setBaseModelBusy(true)
    setBaseModelError(null)
    try {
      await uploadDinov2BaseModel(jobSlug, file, objective, archId)
      setBaseModelReady(true)
      setSelectedWeightKey(UPLOADED_WEIGHT_VALUE)
      setUploadedWeightLabel(file.name)
      refreshWorkspace()
    } catch (e) {
      setBaseModelReady(false)
      setBaseModelError(e instanceof Error ? e.message : String(e))
    } finally {
      setBaseModelBusy(false)
      if (weightFileRef.current) weightFileRef.current.value = ""
    }
  }

  function handleWeightSelectChange(value: string) {
    setSelectedWeightKey(value)
    if (value !== UPLOADED_WEIGHT_VALUE) {
      void handleSelectRegistryWeight(value)
    }
  }

  async function handleUploadDatasetZip(file: File | null) {
    if (!jobSlug || !file) return
    setDatasetBusy(true)
    setDatasetError(null)
    setDatasetPhase("uploading")
    try {
      setDatasetPhase("unpacking")
      const uploaded = await uploadDinov2DatasetZip(jobSlug, file)
      setDatasetReady(uploaded.dataset_ready)
      setDatasetImageCount(uploaded.dataset_image_count)
      setDatasetZipFilename(uploaded.dataset_zip_filename ?? file.name)
      refreshWorkspace()
    } catch (e) {
      setDatasetError(e instanceof Error ? e.message : String(e) || m.errors.datasetUploadFailed)
    } finally {
      setDatasetBusy(false)
      setDatasetPhase(null)
      if (datasetFileRef.current) datasetFileRef.current.value = ""
    }
  }

  async function handleStartTraining() {
    if (!jobSlug || !canStart) return
    setTraining(true)
    setTrainProgress(0)
    setTrainMessage("")
    setStartError(null)
    try {
      await startDinov2Training(jobSlug, {
        epochs,
        batch,
        lr,
        imgsz,
        workers,
        device,
        freeze_backbone: freezeBackbone,
        weight_decay: weightDecay,
      })
    } catch (e) {
      setTraining(false)
      setStartError(e instanceof Error ? e.message : String(e))
    }
  }

  const nameFieldError = nameError ?? (nameDuplicate ? m.errors.nameDuplicate : null)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label={m.backAria}>
              <Link to="/models/training">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{m.pageTitle}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{m.pageSubtitle}</p>
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
              {backendEndpoint.mode === "remote"
                ? m.backendModeRemote(backendEndpoint.label)
                : m.backendModeLocal}
            </span>
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={trainingName}
                  onChange={(e) => {
                    setTrainingName(e.target.value)
                    setNameError(null)
                  }}
                  placeholder={m.trainingNamePlaceholder}
                  disabled={Boolean(jobSlug) || prepareBusy}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  aria-label={m.createJobAria}
                  disabled={
                    !backendOk ||
                    prepareBusy ||
                    Boolean(jobSlug) ||
                    !trainingName.trim() ||
                    nameDuplicate
                  }
                  onClick={() => void handlePrepareJob()}
                >
                  {prepareBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {nameFieldError ? (
                <p className="mt-2 text-sm text-destructive">{nameFieldError}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{m.labelObjective}</p>
                <ToggleGroup
                  type="single"
                  value={objective}
                  onValueChange={(v) => {
                    if (!v) return
                    const next = v as Dinov2ObjectiveId
                    setObjective(next)
                    if (selectedWeightKey && selectedWeightKey !== UPLOADED_WEIGHT_VALUE) {
                      void handleSelectRegistryWeight(selectedWeightKey)
                    }
                  }}
                  className="flex flex-wrap justify-start gap-2"
                  disabled={!jobReady}
                >
                  {objectiveOptions.map((item) => (
                    <ToggleGroupItem key={item.id} value={item.id} className="px-3">
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{m.labelBaseWeight}</p>
                <div className="flex gap-2">
                  <select
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    value={selectedWeightKey}
                    onChange={(e) => handleWeightSelectChange(e.target.value)}
                    disabled={!jobReady || !backendOk || modelsLoading || baseModelBusy}
                  >
                    {models.length === 0 && selectedWeightKey !== UPLOADED_WEIGHT_VALUE ? (
                      <option value="">{m.noModelsOption}</option>
                    ) : null}
                    {uploadedWeightLabel && baseModelReady ? (
                      <option value={UPLOADED_WEIGHT_VALUE}>{m.uploadedWeightOption(uploadedWeightLabel)}</option>
                    ) : null}
                    {models.map((item) => (
                      <option key={item.asset_id} value={item.asset_id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <input
                    ref={weightFileRef}
                    type="file"
                    accept=".pth"
                    className="hidden"
                    disabled={!jobReady || !backendOk || baseModelBusy}
                    onChange={(e) => void handleUploadBaseModel(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label={m.uploadWeightAria}
                    disabled={!jobReady || !backendOk || baseModelBusy}
                    onClick={() => weightFileRef.current?.click()}
                  >
                    {baseModelBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{m.labelZipData}</p>
                <span className="text-[11px] text-muted-foreground">{m.zipHint}</span>
              </div>
              <div className="flex gap-2">
                <Input
                  readOnly
                  className="h-9 min-w-0 flex-1 bg-muted/30"
                  value={datasetZipFilename ?? ""}
                  placeholder={m.zipPlaceholder}
                />
                <input
                  ref={datasetFileRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  disabled={!jobReady || !backendOk || datasetBusy}
                  onChange={(e) => void handleUploadDatasetZip(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label={m.uploadZipAria}
                  disabled={!jobReady || !backendOk || datasetBusy}
                  onClick={() => datasetFileRef.current?.click()}
                >
                  {datasetBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {datasetPhase ? (
                <p className="text-xs text-muted-foreground">
                  {datasetPhase === "uploading" ? m.datasetUploading : m.datasetUnpacking}
                </p>
              ) : null}
              {datasetError ? <p className="text-sm text-destructive">{datasetError}</p> : null}
            </CardContent>
          </Card>

          <Card className={cn("border-border/80 shadow-sm", !jobReady && "opacity-60")}>
            <CardContent className="space-y-4 pt-6">
              <p className="text-xs font-medium text-muted-foreground">{m.labelCommonParams}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{m.paramEpochs}</span>
                  <Input
                    type="number"
                    min={1}
                    value={epochs}
                    onChange={(e) => setEpochs(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{m.paramBatch}</span>
                  <Input
                    type="number"
                    min={1}
                    value={batch}
                    onChange={(e) => setBatch(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{m.paramLr}</span>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={lr}
                    onChange={(e) => setLr(Math.max(0, Number(e.target.value) || 0.0001))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{m.paramWeightDecay}</span>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={weightDecay}
                    onChange={(e) => setWeightDecay(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{m.paramImgsz}</span>
                  <Input
                    type="number"
                    min={32}
                    step={14}
                    value={imgsz}
                    onChange={(e) => setImgsz(Math.max(32, Number(e.target.value) || 518))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{m.paramWorkers}</span>
                  <Input
                    type="number"
                    min={0}
                    value={workers}
                    onChange={(e) => setWorkers(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label className="space-y-1 text-sm sm:col-span-2">
                  <span className="text-muted-foreground">{m.paramDevice}</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={device}
                    onMouseDown={(e) => {
                      if (!backendOk) return
                      e.preventDefault()
                      void openDevicePicker(e.currentTarget)
                    }}
                    onKeyDown={(e) => {
                      if (!backendOk) return
                      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== " " && e.key !== "Enter") {
                        return
                      }
                      e.preventDefault()
                      void openDevicePicker(e.currentTarget)
                    }}
                    onChange={(e) => setDevice(e.target.value)}
                  >
                    {devices.map((d) => (
                      <option key={d.id} value={d.id} title={d.label}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{m.paramFreezeBackbone}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.paramFreezeBackboneHint}</p>
                </div>
                <GpuSwitch
                  id="dinov2-freeze-backbone"
                  checked={freezeBackbone}
                  disabled={!jobReady || training}
                  onCheckedChange={setFreezeBackbone}
                  label={freezeBackbone ? m.switchOn : m.switchOff}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="flex flex-col gap-4 py-4">
              <ul className="space-y-2">
                <ChecklistRow {...backendChecklist} />
                <ChecklistRow {...jobChecklist} />
                <ChecklistRow {...weightChecklist} />
                <ChecklistRow {...datasetChecklist} />
                {startChecklistExtra ? <ChecklistRow {...startChecklistExtra} /> : null}
              </ul>
              <Button
                type="button"
                className="gap-2"
                disabled={!canStart || training}
                onClick={() => void handleStartTraining()}
              >
                {training ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {m.trainingInProgress}
                  </>
                ) : (
                  m.startTraining
                )}
              </Button>
              {training ? (
                <div className="h-2.5 overflow-hidden rounded-full bg-muted/90">
                  <div
                    className="h-full rounded-full bg-primary/90 transition-[width] duration-300"
                    style={{ width: `${trainProgress}%` }}
                    role="progressbar"
                    aria-valuenow={trainProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
              ) : null}
              {trainMessage ? <p className="text-xs text-muted-foreground">{trainMessage}</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

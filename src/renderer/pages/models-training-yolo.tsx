import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  YoloAdvancedBoard,
  YoloBoolSelect,
  YoloFloatInput,
  YoloParamField,
  YoloSelectInput,
  YoloTextInput,
} from "@/components/yolo-advanced-board"
import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"
import {
  augmentFieldVisible,
  buildAugmentTrainPayload,
  buildOptimizerTrainPayload,
  defaultAugmentValues,
  defaultOptimizerValues,
  optimizerFieldVisible,
  YOLO_AUGMENT_FIELDS,
  YOLO_OPTIMIZER_FIELDS,
} from "@/lib/yolo-train-advanced"
import {
  fetchYoloDevices,
  fetchYoloModels,
  fetchYoloTrainStatus,
  fetchYoloTrainingHistory,
  fetchYoloWorkspace,
  formatWeightWarnings,
  prepareYoloTrainingJob,
  probeBackendHealth,
  readWorkspaceWeightBinding,
  selectYoloBaseModel,
  startYoloTraining,
  trainingNameToJobSlug,
  uploadYoloBaseModel,
  validateYoloBaseModel,
  weightMetaHasMismatch,
  type YoloCatalogModel,
  type YoloFamilyId,
  type YoloTaskId,
  type YoloWeightMeta,
  type YoloWeightValidationResponse,
} from "@/lib/training-yolo-api"
import { useYoloTrainingMessages } from "@/lib/i18n"
import {
  formatYoloBackendEndpointLabel,
  unpackYoloDatasetWithTimeout,
  uploadYoloDatasetZipWithProgress,
  type YoloDatasetUploadProgress,
} from "@/lib/yolo-dataset-upload"
import { cn } from "@/lib/utils"
import { ArrowLeft, Loader2, Plus, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

const UPLOADED_WEIGHT_VALUE = "__uploaded_weight__"

const FAMILIES: Array<{ id: YoloFamilyId; label: string }> = [
  { id: "yolov8", label: "YOLOv8" },
  { id: "yolo26", label: "YOLO26" },
]

const TASK_IDS: YoloTaskId[] = ["detect", "segment", "pose", "obb", "classify"]

type ChecklistTone = "done" | "warn" | "error" | "pending"

function applyWeightValidation(
  result: YoloWeightValidationResponse,
  family: YoloFamilyId,
  task: YoloTaskId,
  weightMismatchFallback: string,
): {
  weightMeta: YoloWeightMeta | null
  baseModelValid: boolean
  baseModelError: string | null
  baseModelWarning: string | null
} {
  const weightMeta = result.weight_meta ?? null
  const warningText = formatWeightWarnings(result.weight_warnings ?? [])

  if (weightMetaHasMismatch(weightMeta, family, task)) {
    return {
      weightMeta,
      baseModelValid: false,
      baseModelError: warningText ?? weightMismatchFallback,
      baseModelWarning: null,
    }
  }

  return {
    weightMeta,
    baseModelValid: true,
    baseModelError: null,
    baseModelWarning: warningText,
  }
}

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

export default function ModelsTrainingYoloPage() {
  const { m } = useYoloTrainingMessages()
  const weightFileRef = useRef<HTMLInputElement>(null)
  const datasetFileRef = useRef<HTMLInputElement>(null)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  const [trainingName, setTrainingName] = useState("")
  const [jobSlug, setJobSlug] = useState("")
  const [prepareBusy, setPrepareBusy] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [historySlugs, setHistorySlugs] = useState<Set<string>>(new Set())

  const [family, setFamily] = useState<YoloFamilyId>("yolov8")
  const [task, setTask] = useState<YoloTaskId>("detect")
  const [models, setModels] = useState<YoloCatalogModel[]>([])
  const [selectedWeightKey, setSelectedWeightKey] = useState("")
  const [uploadedWeightLabel, setUploadedWeightLabel] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)

  const [baseModelReady, setBaseModelReady] = useState(false)
  const [baseModelValid, setBaseModelValid] = useState(false)
  const [baseModelError, setBaseModelError] = useState<string | null>(null)
  const [baseModelWarning, setBaseModelWarning] = useState<string | null>(null)
  const [baseModelBusy, setBaseModelBusy] = useState(false)

  const [dataYaml, setDataYaml] = useState<string | null>(null)
  const [datasetZipFilename, setDatasetZipFilename] = useState<string | null>(null)
  const [datasetBusy, setDatasetBusy] = useState(false)
  const [datasetUploadProgress, setDatasetUploadProgress] = useState<YoloDatasetUploadProgress | null>(
    null,
  )
  const [datasetError, setDatasetError] = useState<string | null>(null)

  const [training, setTraining] = useState(false)
  const [trainProgress, setTrainProgress] = useState(0)
  const [startError, setStartError] = useState<string | null>(null)

  const [epochs, setEpochs] = useState(100)
  const [timeHours, setTimeHours] = useState("")
  const [workers, setWorkers] = useState(2)
  const [batch, setBatch] = useState(2)
  const [imgsz, setImgsz] = useState(640)
  const [device, setDevice] = useState("cpu")
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([])

  const [augmentEnabled, setAugmentEnabled] = useState(false)
  const [optimizerEnabled, setOptimizerEnabled] = useState(false)
  const [augmentValues, setAugmentValues] = useState(defaultAugmentValues)
  const [optimizerValues, setOptimizerValues] = useState(defaultOptimizerValues)

  const isLocalBackend = !loadAppConfig().backend.remoteConnected
  const localBackendDir = loadAppConfig().backend.localBackendDir?.trim() ?? ""
  const backendEndpoint = formatYoloBackendEndpointLabel()

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  const loadHistorySlugs = useCallback(() => {
    void fetchYoloTrainingHistory()
      .then((items) => setHistorySlugs(new Set(items.map((i) => i.job_slug))))
      .catch(() => setHistorySlugs(new Set()))
  }, [])

  const applyWorkspace = useCallback(
    (ws: Awaited<ReturnType<typeof fetchYoloWorkspace>>) => {
      setDataYaml(ws.data_yaml)
      setDatasetZipFilename(ws.dataset_zip_filename ?? null)
      setBaseModelReady(Boolean(ws.base_model))
      const binding = readWorkspaceWeightBinding(ws.meta)
      if (binding.weightMeta) {
        const v = applyWeightValidation(
          { weight_meta: binding.weightMeta, weight_warnings: binding.weightWarnings },
          family,
          task,
          m.errors.weightMismatch,
        )
        setBaseModelValid(v.baseModelValid)
        setBaseModelError(v.baseModelError)
        setBaseModelWarning(v.baseModelWarning)
      } else if (!ws.base_model) {
        setBaseModelValid(false)
        setBaseModelError(null)
        setBaseModelWarning(null)
      }
      if (ws.base_model_asset_id) {
        setSelectedWeightKey(ws.base_model_asset_id)
        setUploadedWeightLabel(null)
      } else if (ws.base_model) {
        setSelectedWeightKey(UPLOADED_WEIGHT_VALUE)
        setUploadedWeightLabel(ws.base_model_filename ?? m.errors.uploadedWeightFallback)
      }
      if (binding.savedFamily && binding.savedFamily in { yolov8: 1, yolo26: 1 }) {
        setFamily(binding.savedFamily as YoloFamilyId)
      }
      if (
        binding.savedTask &&
        ["detect", "segment", "pose", "obb", "classify"].includes(binding.savedTask)
      ) {
        setTask(binding.savedTask as YoloTaskId)
      }
    },
    [family, task, m.errors.weightMismatch, m.errors.uploadedWeightFallback],
  )

  const refreshWorkspace = useCallback(() => {
    if (!jobSlug) return
    void fetchYoloWorkspace(jobSlug)
      .then(applyWorkspace)
      .catch(() => {
        /* backend may be down */
      })
  }, [jobSlug, applyWorkspace])

  useEffect(() => {
    refreshBackend()
    loadHistorySlugs()
    const t = window.setInterval(refreshBackend, 2500)
    return () => window.clearInterval(t)
  }, [refreshBackend, loadHistorySlugs])

  useEffect(() => {
    if (!backendOk || !jobSlug) return
    refreshWorkspace()
    void fetchYoloDevices()
      .then((list) => {
        setDevices(list)
        if (list.length > 0 && !list.some((d) => d.id === device)) {
          setDevice(list[0]?.id ?? "cpu")
        }
      })
      .catch(() => setDevices([{ id: "cpu", label: "CPU" }]))
  }, [backendOk, jobSlug, refreshWorkspace, device])

  useEffect(() => {
    if (!backendOk) return
    setModelsLoading(true)
    void fetchYoloModels(family, task)
      .then((list) => {
        setModels(list)
        setSelectedWeightKey((prev) => {
          if (prev === UPLOADED_WEIGHT_VALUE) return prev
          if (list.some((m) => m.asset_id === prev)) return prev
          return list[0]?.asset_id ?? ""
        })
      })
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false))
  }, [backendOk, family, task])

  useEffect(() => {
    if (!jobSlug || !backendOk || !baseModelReady || baseModelBusy) return
    void validateYoloBaseModel(jobSlug, family, task)
      .then((result) => {
        const v = applyWeightValidation(result, family, task, m.errors.weightMismatch)
        setBaseModelValid(v.baseModelValid)
        setBaseModelError(v.baseModelError)
        setBaseModelWarning(v.baseModelWarning)
      })
      .catch((e) => {
        setBaseModelValid(false)
        setBaseModelError(e instanceof Error ? e.message : String(e))
        setBaseModelWarning(null)
      })
  }, [jobSlug, backendOk, family, task, baseModelReady, baseModelBusy, m.errors.weightMismatch])

  useEffect(() => {
    if (!training || !jobSlug) return
    let alive = true
    const tick = () => {
      void fetchYoloTrainStatus(jobSlug)
        .then(({ job }) => {
          if (!alive) return
          setTrainProgress(job.progress)
          if (job.status === "success" || job.status === "failed") {
            setTraining(false)
            setTrainProgress(job.progress ?? (job.status === "success" ? 100 : 0))
            if (job.status === "failed" && job.last_error) {
              setStartError(job.last_error)
            }
            refreshWorkspace()
            loadHistorySlugs()
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
  }, [training, jobSlug, refreshWorkspace, loadHistorySlugs])

  const slugPreview = useMemo(() => trainingNameToJobSlug(trainingName), [trainingName])
  const nameDuplicate = Boolean(slugPreview && historySlugs.has(slugPreview) && slugPreview !== jobSlug)

  const jobReady = Boolean(jobSlug)

  const canStart = useMemo(
    () =>
      Boolean(jobSlug) &&
      Boolean(backendOk) &&
      baseModelReady &&
      baseModelValid &&
      Boolean(dataYaml) &&
      !training,
    [jobSlug, backendOk, baseModelReady, baseModelValid, dataYaml, training],
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
    if (!baseModelValid) return { label: m.checklist.weightInvalid, tone: "error" }
    if (baseModelWarning) return { label: baseModelWarning, tone: "warn" }
    return { label: m.checklist.weightReady, tone: "done" }
  }, [jobReady, baseModelBusy, baseModelError, baseModelReady, baseModelValid, baseModelWarning, models.length, m.checklist])

  const datasetChecklist = useMemo((): { label: string; tone: ChecklistTone } => {
    if (!jobReady) return { label: m.checklist.datasetNeedWorkspace, tone: "pending" }
    if (datasetError) return { label: datasetError, tone: "error" }
    if (dataYaml) {
      return { label: m.checklist.datasetReady(datasetZipFilename), tone: "done" }
    }
    if (isLocalBackend) {
      return { label: m.checklist.datasetPickZip, tone: "pending" }
    }
    return { label: m.checklist.datasetUploadZip, tone: "pending" }
  }, [jobReady, datasetError, dataYaml, datasetZipFilename, isLocalBackend, m.checklist])

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
      const prepared = await prepareYoloTrainingJob(name)
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
    setBaseModelWarning(null)
    try {
      const result = await selectYoloBaseModel(jobSlug, assetId, family, task)
      const v = applyWeightValidation(result, family, task, m.errors.weightMismatch)
      setBaseModelValid(v.baseModelValid)
      setBaseModelError(v.baseModelError)
      setBaseModelWarning(v.baseModelWarning)
      setBaseModelReady(true)
      setUploadedWeightLabel(null)
      refreshWorkspace()
    } catch (e) {
      setBaseModelReady(false)
      setBaseModelValid(false)
      setBaseModelError(e instanceof Error ? e.message : String(e))
      setBaseModelWarning(null)
    } finally {
      setBaseModelBusy(false)
    }
  }

  async function handleUploadBaseModel(file: File | null) {
    if (!jobSlug || !file) return
    setBaseModelBusy(true)
    setBaseModelError(null)
    setBaseModelWarning(null)
    try {
      const result = await uploadYoloBaseModel(jobSlug, file, family, task)
      const v = applyWeightValidation(result, family, task, m.errors.weightMismatch)
      setBaseModelValid(v.baseModelValid)
      setBaseModelError(v.baseModelError)
      setBaseModelWarning(v.baseModelWarning)
      setBaseModelReady(true)
      setSelectedWeightKey(UPLOADED_WEIGHT_VALUE)
      setUploadedWeightLabel(file.name)
      refreshWorkspace()
    } catch (e) {
      setBaseModelReady(false)
      setBaseModelValid(false)
      setBaseModelError(e instanceof Error ? e.message : String(e))
      setBaseModelWarning(null)
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

  async function handlePickDatasetZip() {
    if (!jobSlug) {
      setDatasetError(m.errors.createWorkspaceFirst)
      return
    }
    if (!isLocalBackend) {
      setDatasetError(m.errors.remoteZipUpload)
      return
    }
    if (!localBackendDir) {
      setDatasetError(m.errors.pickBackendDir)
      return
    }
    setDatasetBusy(true)
    setDatasetError(null)
    try {
      const picked = await ipc.app.SelectFiles({
        title: m.ipc.pickDatasetZipTitle,
        defaultPath: "",
      })
      if (picked.canceled || !picked.paths[0]) return
      const sourcePath = picked.paths[0]
      const originalName = sourcePath.split(/[/\\]/).pop() ?? "dataset.zip"
      const copy = await ipc.app.CopyYoloTrainingDatasetZip({
        backendDirectory: localBackendDir,
        sourceZipPath: sourcePath,
        trainingName: trainingName.trim() || jobSlug,
      })
      if (!copy.ok) {
        setDatasetError(copy.errorMessage || m.errors.copyDatasetFailed)
        return
      }
      setDatasetUploadProgress({ phase: "unpacking", percent: 35 })
      const unpacked = await unpackYoloDatasetWithTimeout(jobSlug, originalName)
      setDataYaml(unpacked.data_yaml)
      setDatasetZipFilename(unpacked.dataset_zip_filename ?? originalName)
      refreshWorkspace()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDatasetError(
        msg.includes("??") ? m.errors.datasetUnpackTimeout : msg || m.errors.copyDatasetFailed,
      )
    } finally {
      setDatasetBusy(false)
      setDatasetUploadProgress(null)
    }
  }

  function handleDatasetUploadClick() {
    if (isLocalBackend) {
      void handlePickDatasetZip()
    } else {
      datasetFileRef.current?.click()
    }
  }

  async function handleUploadDatasetZip(file: File | null) {
    if (!jobSlug || !file) return
    setDatasetBusy(true)
    setDatasetError(null)
    setDatasetUploadProgress({ phase: "uploading", percent: 0 })
    try {
      const uploaded = await uploadYoloDatasetZipWithProgress(jobSlug, file, {
        onProgress: setDatasetUploadProgress,
      })
      setDataYaml(uploaded.data_yaml)
      setDatasetZipFilename(uploaded.dataset_zip_filename ?? file.name)
      refreshWorkspace()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("??")) {
        setDatasetError(m.errors.datasetUploadTimeout)
      } else if (msg.includes("??") || msg.includes("??")) {
        setDatasetError(m.errors.datasetUploadNetwork)
      } else if (msg.includes("??")) {
        setDatasetError(m.errors.datasetUnpackTimeout)
      } else {
        setDatasetError(msg)
      }
    } finally {
      setDatasetBusy(false)
      setDatasetUploadProgress(null)
      if (datasetFileRef.current) datasetFileRef.current.value = ""
    }
  }

  async function handleStartTraining() {
    if (!jobSlug || !canStart) return
    setTraining(true)
    setTrainProgress(0)
    setStartError(null)
    const parsedHours = timeHours.trim() === "" ? null : Number(timeHours)
    const time_hours =
      parsedHours !== null && Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : null
    try {
      await startYoloTraining(jobSlug, {
        epochs,
        imgsz,
        batch,
        workers,
        device,
        time_hours,
        use_custom_augment: augmentEnabled,
        augment: augmentEnabled ? buildAugmentTrainPayload(augmentValues, task) : null,
        use_custom_optimizer: optimizerEnabled,
        optimizer: optimizerEnabled ? buildOptimizerTrainPayload(optimizerValues, task) : null,
      })
    } catch (e) {
      setTraining(false)
      setStartError(e instanceof Error ? e.message : String(e))
    }
  }

  const visibleAugmentFields = YOLO_AUGMENT_FIELDS.filter((f) => augmentFieldVisible(f, task))
  const visibleOptimizerFields = YOLO_OPTIMIZER_FIELDS.filter((f) => optimizerFieldVisible(f, task))

  const nameFieldError =
    nameError ?? (nameDuplicate ? m.errors.nameDuplicate : null)

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
                <p className="text-xs font-medium text-muted-foreground">{m.labelFamily}</p>
                <ToggleGroup
                  type="single"
                  value={family}
                  onValueChange={(v) => v && setFamily(v as YoloFamilyId)}
                  className="flex flex-wrap justify-start gap-2"
                  disabled={!jobReady}
                >
                  {FAMILIES.map((f) => (
                    <ToggleGroupItem key={f.id} value={f.id} className="px-4">
                      {f.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{m.labelTask}</p>
                <ToggleGroup
                  type="single"
                  value={task}
                  onValueChange={(v) => v && setTask(v as YoloTaskId)}
                  className="flex flex-wrap justify-start gap-2"
                  disabled={!jobReady}
                >
                  {TASK_IDS.map((id) => (
                    <ToggleGroupItem key={id} value={id} className="px-3">
                      {m.tasks[id]}
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
                    {models.map((m) => (
                      <option key={m.asset_id} value={m.asset_id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <input
                    ref={weightFileRef}
                    type="file"
                    accept=".pt"
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
                {!isLocalBackend ? (
                  <span className="text-[11px] text-muted-foreground">{m.zipHintRemote}</span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{m.zipHintLocal}</span>
                )}
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
                  onClick={handleDatasetUploadClick}
                >
                  {datasetBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {datasetUploadProgress ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {datasetUploadProgress.phase === "uploading"
                        ? m.datasetUploading(datasetUploadProgress.percent)
                        : m.datasetUnpacking}
                    </span>
                    <span className="tabular-nums">{datasetUploadProgress.percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted/90">
                    <div
                      className="h-full rounded-full bg-primary/90 transition-[width] duration-300"
                      style={{ width: `${datasetUploadProgress.percent}%` }}
                      role="progressbar"
                      aria-valuenow={datasetUploadProgress.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>
                </div>
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
                  <span className="text-muted-foreground" title={m.paramTimeHoursTitle}>
                    {m.paramTimeHours}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={timeHours}
                    placeholder={m.paramTimePlaceholder}
                    onChange={(e) => setTimeHours(e.target.value)}
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
                  <span className="text-muted-foreground">{m.paramImgsz}</span>
                  <Input
                    type="number"
                    min={32}
                    step={32}
                    value={imgsz}
                    onChange={(e) => setImgsz(Math.max(32, Number(e.target.value) || 640))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{m.paramDevice}</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              </div>
            </CardContent>
          </Card>

          <YoloAdvancedBoard
            title={m.boardAugment}
            enabled={augmentEnabled}
            onEnabledChange={setAugmentEnabled}
            dimmed={!jobReady}
            switchOnLabel={m.switchOn}
            switchOffLabel={m.switchOff}
          >
            {visibleAugmentFields.map((field) => (
              <YoloParamField key={field.key} label={field.label} hint={field.hint}>
                {field.type === "float" ? (
                  <YoloFloatInput
                    value={augmentValues[field.key] ?? field.default}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(n) => setAugmentValues((prev) => ({ ...prev, [field.key]: n }))}
                  />
                ) : (
                  <YoloSelectInput
                    value={String(augmentValues[field.key] ?? field.default)}
                    options={field.options ?? []}
                    onChange={(v) => setAugmentValues((prev) => ({ ...prev, [field.key]: v }))}
                  />
                )}
              </YoloParamField>
            ))}
          </YoloAdvancedBoard>

          <YoloAdvancedBoard
            title={m.boardOptimizer}
            enabled={optimizerEnabled}
            onEnabledChange={setOptimizerEnabled}
            dimmed={!jobReady}
            switchOnLabel={m.switchOn}
            switchOffLabel={m.switchOff}
          >
            {visibleOptimizerFields.map((field) => (
              <YoloParamField key={field.key} label={field.label} hint={field.hint}>
                {field.type === "float" ? (
                  <YoloFloatInput
                    value={optimizerValues[field.key] ?? field.default}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(n) => setOptimizerValues((prev) => ({ ...prev, [field.key]: n }))}
                  />
                ) : field.type === "int" ? (
                  <YoloFloatInput
                    value={optimizerValues[field.key] ?? field.default}
                    min={field.min}
                    max={field.max}
                    step={1}
                    onChange={(n) =>
                      setOptimizerValues((prev) => ({ ...prev, [field.key]: Math.round(n) }))
                    }
                  />
                ) : field.type === "bool" ? (
                  <YoloBoolSelect
                    value={optimizerValues[field.key] ?? field.default}
                    noLabel={m.boolNo}
                    yesLabel={m.boolYes}
                    onChange={(on) =>
                      setOptimizerValues((prev) => ({ ...prev, [field.key]: on ? 1 : 0 }))
                    }
                  />
                ) : field.type === "text" ? (
                  <YoloTextInput
                    value={String(optimizerValues[field.key] ?? field.default)}
                    placeholder={field.placeholder}
                    onChange={(v) => setOptimizerValues((prev) => ({ ...prev, [field.key]: v }))}
                  />
                ) : (
                  <YoloSelectInput
                    value={String(optimizerValues[field.key] ?? field.default)}
                    options={field.options ?? []}
                    onChange={(v) => setOptimizerValues((prev) => ({ ...prev, [field.key]: v }))}
                  />
                )}
              </YoloParamField>
            ))}
          </YoloAdvancedBoard>

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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

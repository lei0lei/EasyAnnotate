import { AugmentTileArt } from "@/components/augment-tile-art"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  type ExportPipelineStep,
  type ExportVersionItem,
  loadProjectExportVersions,
  saveProjectExportVersions,
} from "@/lib/project-export-storage"
import {
  getProject,
  listExportJobs,
  listProjectTasks,
  countTaskSourceStats,
  startDatasetExport,
  type ProjectTaskItem,
} from "@/lib/projects-api"
import { cn } from "@/lib/utils"
import {
  ArrowLeft,
  Box,
  Contrast,
  Crop,
  Download,
  Filter,
  Image as ImageIcon,
  Layers,
  ListTodo,
  Maximize2,
  Plus,
  RotateCw,
  Scaling,
  Shuffle,
  Sparkles,
  Tags,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useParams } from "react-router-dom"

type SourceStats = {
  imageCount: number
  classCount: number
  annotationFileCount: number
}
const EXPORT_LOG_SEPARATOR = "\n---EXPORT_LOG---\n"

function splitExportJobMessage(rawMessage: string): { statusMessage: string; logLines: string[] } {
  const message = (rawMessage || "").trim()
  if (!message) return { statusMessage: "", logLines: [] }
  const idx = message.indexOf(EXPORT_LOG_SEPARATOR)
  if (idx < 0) return { statusMessage: message, logLines: [] }
  const statusMessage = message.slice(0, idx).trim()
  const logsRaw = message.slice(idx + EXPORT_LOG_SEPARATOR.length)
  const logLines = logsRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return { statusMessage, logLines }
}

const PREPROCESS_OPTIONS = [
  "切块",
  "旋转",
  "裁剪",
  "静态裁剪",
  "缩放",
  "转灰度图像",
  "对比度调整",
  "类别编辑",
  "随机采样",
  "去除无标签图像",
] as const

const PREPROCESS_ICONS: Record<(typeof PREPROCESS_OPTIONS)[number], LucideIcon> = {
  切块: Layers,
  旋转: RotateCw,
  裁剪: Crop,
  静态裁剪: Maximize2,
  缩放: Scaling,
  转灰度图像: ImageIcon,
  对比度调整: Contrast,
  类别编辑: Tags,
  随机采样: Shuffle,
  去除无标签图像: Filter,
}

const AUGMENT_OPTIONS = {
  图像: [
    "反转",
    "90°旋转",
    "裁剪",
    "旋转",
    "shear",
    "灰度",
    "hue",
    "饱和度",
    "亮度",
    "曝光",
    "模糊",
    "噪声",
    "cutout",
    "mosaic",
    "运动模糊",
    "相机增益",
  ],
  标注框: [
    "反转",
    "90°旋转",
    "裁剪",
    "旋转",
    "shear",
    "亮度",
    "曝光",
    "模糊",
    "噪声",
    "运动模糊",
    "相机增益",
  ],
} as const

type AugmentCategory = keyof typeof AUGMENT_OPTIONS

function formatTypeLabel(taskId?: string): string {
  return taskId ? "任务导出" : "项目导出"
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function createExportVersion(scope: ExportVersionItem["scope"], orderIndex: number): ExportVersionItem {
  const now = new Date().toISOString()
  return {
    id: createId("expver"),
    name: `Version ${orderIndex}`,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    scope,
    trainBoundary: 70,
    valBoundary: 90,
    preprocessSteps: [],
    augmentSteps: [],
    exportFormat: "coco",
    keepProjectStructureEnabled: false,
    compressToZip: false,
  }
}

function isScopeMatched(versionScope: ExportVersionItem["scope"], currentScope: ExportVersionItem["scope"]): boolean {
  if (currentScope.kind === "project") return versionScope.kind === "project"
  return versionScope.kind === "task" && versionScope.taskId === currentScope.taskId
}

export default function ProjectExportPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>()
  const location = useLocation()
  const [, setProjectName] = useState("")
  const [taskName, setTaskName] = useState("")
  const [sourceStats, setSourceStats] = useState<SourceStats>({ imageCount: 0, classCount: 0, annotationFileCount: 0 })
  const [sourceRefreshTick, setSourceRefreshTick] = useState(0)
  const [allVersions, setAllVersions] = useState<ExportVersionItem[]>([])
  /** 预处理：平铺选板 → 单项设置 */
  const [preprocessUi, setPreprocessUi] = useState<"closed" | "pick" | "settings">("closed")
  const [preprocessDraftType, setPreprocessDraftType] = useState<(typeof PREPROCESS_OPTIONS)[number]>("切块")
  const [preprocessDraftConfig, setPreprocessDraftConfig] = useState("")
  /** 数据增强：平铺选板 → 单项设置 */
  const [augmentUi, setAugmentUi] = useState<"closed" | "pick" | "settings">("closed")
  const [augmentDraft, setAugmentDraft] = useState<{ category: AugmentCategory; name: string } | null>(null)
  const [augmentDraftConfig, setAugmentDraftConfig] = useState("")
  const [exporting, setExporting] = useState(false)
  const [activeExportJobId, setActiveExportJobId] = useState("")
  const [exportMessage, setExportMessage] = useState("")
  const [exportProgress, setExportProgress] = useState(0)
  const [exportLogLines, setExportLogLines] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [projectTasks, setProjectTasks] = useState<ProjectTaskItem[]>([])
  const [sourceImageCounting, setSourceImageCounting] = useState(false)
  const [sourceAnnotationCounting, setSourceAnnotationCounting] = useState(false)
  const sourceImageCountTokenRef = useRef(0)
  const sourceAnnotationCountTokenRef = useRef(0)

  const backHref = projectId ? `/projects/${projectId}` : "/projects/mine"
  const pageTitle = formatTypeLabel(taskId)

  const scope = useMemo<ExportVersionItem["scope"]>(() => {
    if (taskId) return { kind: "task", taskId }
    return { kind: "project" }
  }, [taskId])

  const activeVersion = useMemo(() => {
    return [...allVersions]
      .filter((item) => isScopeMatched(item.scope, scope))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  }, [allVersions, scope])
  const showKeepProjectStructureToggle = scope.kind === "project"

  const trainRatio = activeVersion?.trainBoundary ?? 70
  const valRatio = Math.max(0, (activeVersion?.valBoundary ?? 90) - trainRatio)
  const testRatio = Math.max(0, 100 - (activeVersion?.valBoundary ?? 90))

  const sliderInputClass =
    "pointer-events-none absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-0 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:-mt-1.5 [&::-moz-range-track]:h-0 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow"

  useEffect(() => {
    if (!projectId) return
    setHydrated(false)
    let alive = true
    void loadProjectExportVersions(projectId).then((items) => {
      if (!alive) return
      setAllVersions(items)
      setHydrated(true)
    })
    return () => {
      alive = false
    }
  }, [projectId])

  useEffect(() => {
    if (!hydrated) return
    setAllVersions((prev) => {
      const scoped = [...prev]
        .filter((item) => isScopeMatched(item.scope, scope))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      const selected = scoped[0] ?? createExportVersion(scope, 1)
      const others = prev.filter((item) => !isScopeMatched(item.scope, scope))
      if (scoped.length === 1 && scoped[0].id === selected.id) return prev
      return [selected, ...others]
    })
  }, [hydrated, scope])

  useEffect(() => {
    if (!projectId || !hydrated) return
    void saveProjectExportVersions(projectId, allVersions).then(({ errorMessage }) => {
      if (errorMessage) setExportMessage(`保存导出版本失败：${errorMessage}`)
    })
  }, [allVersions, hydrated, projectId])

  useEffect(() => {
    setSourceRefreshTick((v) => v + 1)
  }, [location.key])

  useEffect(() => {
    const handleFocusRefresh = () => setSourceRefreshTick((v) => v + 1)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setSourceRefreshTick((v) => v + 1)
      }
    }
    window.addEventListener("focus", handleFocusRefresh)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("focus", handleFocusRefresh)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    let alive = true
    if (!projectId) return
    void Promise.all([getProject(projectId), listProjectTasks(projectId)]).then(([project, tasks]) => {
      if (!alive) return
      setProjectName(project?.name ?? "")
      setProjectTasks(tasks)
      const classCount = project?.tags?.length ?? 0
      const targetTaskIds = taskId ? [taskId] : tasks.map((item) => item.id)
      if (taskId) {
        const currentTask = tasks.find((item) => item.id === taskId)
        setTaskName(currentTask?.name ?? "")
        const imageCount = Math.max(0, Math.floor(Number(currentTask?.fileCount) || 0))
        setSourceStats({
          imageCount,
          classCount,
          // Avoid heavy full-dataset scan on page entry.
          annotationFileCount: 0,
        })
      } else {
        setTaskName("")
        const imageCount = tasks.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.fileCount) || 0)), 0)
        setSourceStats({
          imageCount,
          classCount,
          // Avoid heavy full-dataset scan on page entry.
          annotationFileCount: 0,
        })
      }
    })
    return () => {
      alive = false
    }
  }, [projectId, taskId, sourceRefreshTick])

  function updateActiveVersion(patch: Partial<ExportVersionItem>) {
    if (!activeVersion) return
    const safePatch = showKeepProjectStructureToggle
      ? patch
      : { ...patch, keepProjectStructureEnabled: activeVersion.keepProjectStructureEnabled }
    setAllVersions((prev) =>
      prev.map((item) =>
        item.id === activeVersion.id
          ? {
              ...item,
              ...safePatch,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    )
  }

  function handleRefreshSourceImageCount() {
    if (!projectId || sourceImageCounting) return
    const token = sourceImageCountTokenRef.current + 1
    sourceImageCountTokenRef.current = token
    setSourceImageCounting(true)
    setExportMessage("正在重新统计图片数量…")
    const targetTaskIds = taskId ? [taskId] : projectTasks.map((item) => item.id)
    void countTaskSourceStats({ projectId, taskIds: targetTaskIds })
      .then(({ imageCount, annotationCount, errorMessage }) => {
        if (sourceImageCountTokenRef.current !== token) return
        if (errorMessage) {
          setExportMessage(`统计失败：${errorMessage}`)
          return
        }
        setSourceStats((prev) => ({ ...prev, imageCount, annotationFileCount: annotationCount }))
        setExportMessage("图片与标注数量统计已更新")
      })
      .catch((error) => {
        if (sourceImageCountTokenRef.current !== token) return
        setExportMessage(error instanceof Error ? `统计失败：${error.message}` : "统计失败")
      })
      .finally(() => {
        if (sourceImageCountTokenRef.current !== token) return
        setSourceImageCounting(false)
      })
  }

  function handleRefreshSourceAnnotationCount() {
    if (!projectId || sourceAnnotationCounting) return
    const token = sourceAnnotationCountTokenRef.current + 1
    sourceAnnotationCountTokenRef.current = token
    setSourceAnnotationCounting(true)
    setExportMessage("正在重新统计标注文件数量…")
    const targetTaskIds = taskId ? [taskId] : projectTasks.map((item) => item.id)
    void countTaskSourceStats({ projectId, taskIds: targetTaskIds })
      .then(({ imageCount, annotationCount, errorMessage }) => {
        if (sourceAnnotationCountTokenRef.current !== token) return
        if (errorMessage) {
          setExportMessage(`统计失败：${errorMessage}`)
          return
        }
        setSourceStats((prev) => ({ ...prev, imageCount, annotationFileCount: annotationCount }))
        setExportMessage("图片与标注数量统计已更新")
      })
      .catch((error) => {
        if (sourceAnnotationCountTokenRef.current !== token) return
        setExportMessage(error instanceof Error ? `统计失败：${error.message}` : "统计失败")
      })
      .finally(() => {
        if (sourceAnnotationCountTokenRef.current !== token) return
        setSourceAnnotationCounting(false)
      })
  }

  function handleExport() {
    if (exporting || !activeVersion) return
    setExporting(true)
    setExportProgress(0)
    setExportLogLines([])
    setExportMessage("正在启动导出…")
    void startDatasetExport({
      projectId: projectId || "",
      taskId: taskId || "",
      exportFormat: activeVersion.exportFormat,
      keepProjectStructure: activeVersion.keepProjectStructureEnabled,
      compressToZip: activeVersion.compressToZip,
      trainBoundary: activeVersion.trainBoundary,
      valBoundary: activeVersion.valBoundary,
      versionName: activeVersion.name,
      taskNames: projectTasks.map((task) => ({ taskId: task.id, taskName: task.name })),
    }).then((result) => {
      if (result.canceled) {
        setExporting(false)
        if (result.errorMessage) setExportMessage(result.errorMessage)
        return
      }
      setActiveExportJobId(result.jobId)
      setExportMessage("导出任务已启动")
      updateActiveVersion({ status: "draft" })
    })
  }

  useEffect(() => {
    if (!activeExportJobId) return
    let alive = true
    const tick = () => {
      void listExportJobs().then((jobs) => {
        if (!alive) return
        const current = jobs.find((item) => item.id === activeExportJobId)
        if (!current) return
        const parsed = splitExportJobMessage(current.message || "")
        setExportProgress(Math.max(0, Math.min(100, current.progress)))
        setExportMessage(parsed.statusMessage || `导出进度 ${current.progress}%`)
        setExportLogLines(parsed.logLines)
        if (current.status === "success") {
          setExporting(false)
          setActiveExportJobId("")
          setExportProgress(100)
          setExportMessage("导出完成")
          updateActiveVersion({ status: "ready" })
          return
        }
        if (current.status === "failed") {
          setExporting(false)
          setActiveExportJobId("")
          setExportProgress(0)
          setExportMessage(current.message || "导出失败")
          return
        }
        window.setTimeout(tick, 500)
      })
    }
    tick()
    return () => {
      alive = false
    }
  }, [activeExportJobId])

  function handleTrainBoundaryChange(rawValue: number) {
    if (!activeVersion) return
    const maxAllowed = activeVersion.valBoundary
    const trainBoundary = Math.max(0, Math.min(rawValue, maxAllowed))
    updateActiveVersion({ trainBoundary })
  }

  function handleValBoundaryChange(rawValue: number) {
    if (!activeVersion) return
    const minAllowed = activeVersion.trainBoundary
    const valBoundary = Math.min(100, Math.max(rawValue, minAllowed))
    updateActiveVersion({ valBoundary })
  }

  function commitPreprocessStep() {
    if (!activeVersion) return
    const next: ExportPipelineStep = {
      id: createId("pre"),
      type: preprocessDraftType,
      config: preprocessDraftConfig.trim(),
    }
    updateActiveVersion({ preprocessSteps: [...activeVersion.preprocessSteps, next] })
    setPreprocessUi("closed")
    setPreprocessDraftConfig("")
  }

  function commitAugmentStep() {
    if (!activeVersion || !augmentDraft) return
    const next: ExportPipelineStep = {
      id: createId("aug"),
      type: `${augmentDraft.category} · ${augmentDraft.name}`,
      config: augmentDraftConfig.trim(),
    }
    updateActiveVersion({ augmentSteps: [...activeVersion.augmentSteps, next] })
    setAugmentUi("closed")
    setAugmentDraft(null)
    setAugmentDraftConfig("")
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-6 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="返回项目">
          <Link to={backHref}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
        </div>
      </div>

      <div className="space-y-4">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">Name</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                value={activeVersion?.name ?? ""}
                onChange={(e) => updateActiveVersion({ name: e.target.value })}
                placeholder="输入导出名称"
                disabled={!activeVersion}
                spellCheck={false}
              />
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-medium">Source</CardTitle>
                {taskId ? (
                  <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ListTodo className="h-4 w-4" aria-label="任务导出" />
                    <span className="max-w-40 truncate">{taskName || "未命名任务"}</span>
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <button
                type="button"
                className={cn(
                  "rounded-md border-2 border-border/70 bg-muted/20 px-3 py-2 text-left transition",
                  "hover:border-primary/60 hover:bg-muted/30",
                  sourceImageCounting ? "cursor-wait opacity-90" : "cursor-pointer",
                )}
                onClick={handleRefreshSourceImageCount}
                disabled={sourceImageCounting}
                aria-label="重新统计图片数量"
              >
                <p className="text-xs text-muted-foreground">图片数量</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{sourceStats.imageCount}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{sourceImageCounting ? "统计中..." : "点击重算"}</p>
              </button>
              <div className="rounded-md border-2 border-border/70 bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">类别数量</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{sourceStats.classCount}</p>
              </div>
              <button
                type="button"
                className={cn(
                  "rounded-md border-2 border-border/70 bg-muted/20 px-3 py-2 text-left transition",
                  "hover:border-primary/60 hover:bg-muted/30",
                  sourceAnnotationCounting ? "cursor-wait opacity-90" : "cursor-pointer",
                )}
                onClick={handleRefreshSourceAnnotationCount}
                disabled={sourceAnnotationCounting}
                aria-label="重新统计标注文件数量"
              >
                <p className="text-xs text-muted-foreground">标注文件数量</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{sourceStats.annotationFileCount}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{sourceAnnotationCounting ? "统计中..." : "点击重算"}</p>
              </button>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">数据集分割</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border-2 border-border/70 px-3 py-4">
                <div className="grid grid-cols-3 gap-2 text-sm text-foreground">
                  <div>Train: {trainRatio}%</div>
                  <div className="text-center">Val: {valRatio}%</div>
                  <div className="text-right">Test: {testRatio}%</div>
                </div>
                <div className="relative mt-4 h-10">
                  <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded bg-muted" />
                  <div
                    className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-primary"
                    style={{
                      left: `${activeVersion?.trainBoundary ?? 70}%`,
                      width: `${Math.max(0, (activeVersion?.valBoundary ?? 90) - (activeVersion?.trainBoundary ?? 70))}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={activeVersion?.trainBoundary ?? 70}
                    onChange={(e) => handleTrainBoundaryChange(Number(e.target.value))}
                    className={`${sliderInputClass} z-30`}
                    disabled={!activeVersion}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={activeVersion?.valBoundary ?? 90}
                    onChange={(e) => handleValBoundaryChange(Number(e.target.value))}
                    className={`${sliderInputClass} z-20`}
                    disabled={!activeVersion}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">预处理</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button type="button" variant="outline" onClick={() => setPreprocessUi("pick")} disabled={!activeVersion}>
                <Plus className="h-4 w-4" />
                添加预处理
              </Button>
              {activeVersion && activeVersion.preprocessSteps.length > 0 ? (
                <ul className="space-y-2">
                  {activeVersion.preprocessSteps.map((step, index) => (
                    <li key={step.id} className="rounded-md border-2 border-border/70 px-3 py-2 text-sm">
                      {index + 1}. {step.type}
                      {step.config ? ` · ${step.config}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">数据增强</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button type="button" variant="outline" onClick={() => setAugmentUi("pick")} disabled={!activeVersion}>
                <Plus className="h-4 w-4" />
                添加数据增强
              </Button>
              {activeVersion && activeVersion.augmentSteps.length > 0 ? (
                <ul className="space-y-2">
                  {activeVersion.augmentSteps.map((step, index) => (
                    <li key={step.id} className="rounded-md border-2 border-border/70 px-3 py-2 text-sm">
                      {index + 1}. {step.type}
                      {step.config ? ` · ${step.config}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">选择导出格式</CardTitle>
            </CardHeader>
            <CardContent>
              <select
                className="h-10 w-full rounded-md border-2 border-input bg-background px-3 text-sm"
                value={activeVersion?.exportFormat ?? "coco"}
                onChange={(e) => updateActiveVersion({ exportFormat: e.target.value as ExportVersionItem["exportFormat"] })}
                disabled={!activeVersion}
              >
                <option value="coco">COCO</option>
                <option value="yolo-detect">Yolo Detect</option>
                <option value="yolo-obb">Yolo Obb</option>
                <option value="yolo-segment">Yolo Segment</option>
                <option value="yolo-pose">Yolo Pose</option>
                <option value="voc">Pascal VOC</option>
                <option value="xanylabeling">XAnyLabeling (Internal)</option>
              </select>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={activeVersion?.compressToZip ?? false}
                      onChange={(e) => updateActiveVersion({ compressToZip: e.target.checked })}
                      aria-label="切换压缩为 ZIP"
                      disabled={!activeVersion}
                    />
                    <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-disabled:opacity-50" />
                    <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform peer-checked:translate-x-5" />
                  </label>
                  <span className="text-sm text-foreground">压缩为 ZIP</span>
                </div>
                {showKeepProjectStructureToggle ? (
                  <div className="flex items-center gap-2">
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={activeVersion?.keepProjectStructureEnabled ?? false}
                        onChange={(e) => updateActiveVersion({ keepProjectStructureEnabled: e.target.checked })}
                        aria-label="切换保持项目结构"
                        disabled={!activeVersion}
                      />
                      <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-disabled:opacity-50" />
                      <span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform peer-checked:translate-x-5" />
                    </label>
                    <span className="text-sm text-foreground">保持项目结构</span>
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={handleExport} disabled={exporting || !activeVersion}>
                  <Download className="h-4 w-4" />
                  {exporting ? "导出中..." : "导出"}
                </Button>
              </div>
              {exporting || exportMessage ? (
                <div className="w-full space-y-1.5">
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/90">
                    <div
                      className="h-full rounded-full bg-primary/90 transition-[width] duration-300"
                      style={{ width: `${exportProgress}%` }}
                      role="progressbar"
                      aria-valuenow={Math.round(exportProgress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="导出进度"
                    />
                  </div>
                  {exportMessage ? <p className="text-xs text-muted-foreground">{exportMessage}</p> : null}
                </div>
              ) : null}
              {exportLogLines.length > 0 ? (
                <div className="w-full rounded-md border-2 border-border/70 bg-muted/20 p-3">
                  <p className="mb-2 text-xs font-medium text-foreground">导出日志（逐图耗时）</p>
                  <div className="max-h-44 overflow-auto rounded bg-background px-2 py-1">
                    <pre className="whitespace-pre-wrap break-all text-[11px] leading-5 text-muted-foreground">
                      {exportLogLines.join("\n")}
                    </pre>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
      </div>

      {preprocessUi === "pick" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preprocess-picker-title"
        >
          <Card className="flex max-h-[85vh] w-full max-w-4xl flex-col border-border">
            <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle id="preprocess-picker-title" className="text-base">
                  选择预处理
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">点击一项进入参数设置（Roboflow 风格平铺）</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreprocessUi("closed")}>
                关闭
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {PREPROCESS_OPTIONS.map((option) => {
                  const Icon = PREPROCESS_ICONS[option]
                  return (
                    <button
                      key={option}
                      type="button"
                      className={cn(
                        "group flex flex-col items-stretch rounded-xl border-2 border-border bg-card p-3 text-left transition",
                        "hover:border-primary hover:bg-accent/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                      onClick={() => {
                        setPreprocessDraftType(option)
                        setPreprocessDraftConfig("")
                        setPreprocessUi("settings")
                      }}
                    >
                      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-lg border-2 border-border bg-muted/50 transition group-hover:border-primary/50 group-hover:bg-primary/10">
                        <Icon className="h-8 w-8 text-muted-foreground transition group-hover:text-primary" aria-hidden />
                      </div>
                      <p className="mt-2 text-center text-xs font-medium leading-snug text-foreground">{option}</p>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {preprocessUi === "settings" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preprocess-settings-title"
        >
          <Card className="w-full max-w-md border-border">
            <CardHeader className="space-y-1">
              <CardTitle id="preprocess-settings-title" className="text-base">
                预处理 · {preprocessDraftType}
              </CardTitle>
              <p className="text-xs text-muted-foreground">配置该项参数后添加到管线</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={preprocessDraftConfig}
                onChange={(e) => setPreprocessDraftConfig(e.target.value)}
                placeholder="参数（可选），如 scale=0.5 或 class_map={a:b}"
                spellCheck={false}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPreprocessUi("pick")}>
                  返回
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPreprocessUi("closed")
                    setPreprocessDraftConfig("")
                  }}
                >
                  取消
                </Button>
                <Button type="button" onClick={commitPreprocessStep} disabled={!activeVersion}>
                  添加到管线
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {augmentUi === "pick" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="augment-picker-title"
        >
          <Card className="flex max-h-[85vh] w-full max-w-4xl flex-col border-border">
            <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle id="augment-picker-title" className="text-base">
                  选择数据增强
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">按类别平铺；点击一项进入参数设置</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAugmentUi("closed")}>
                关闭
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0 pt-0">
              <div
                className={cn(
                  "max-h-[min(70vh,calc(85vh-7rem))] overflow-y-auto overscroll-y-contain px-6 pb-6 pt-2",
                  "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                )}
              >
                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 border-b-2 border-border/60 pb-2 text-sm font-semibold tracking-tight text-foreground">
                    <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    图像
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {AUGMENT_OPTIONS["图像"].map((name) => (
                      <button
                        key={`图像-${name}`}
                        type="button"
                        className={cn(
                          "group flex flex-col items-stretch rounded-xl border-2 border-border bg-card p-3 text-left transition",
                          "hover:border-primary hover:bg-accent/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        onClick={() => {
                          setAugmentDraft({ category: "图像", name })
                          setAugmentDraftConfig("")
                          setAugmentUi("settings")
                        }}
                      >
                        <div className="flex aspect-[4/3] w-full flex-col rounded-lg border-2 border-border bg-muted/30 transition group-hover:border-primary/60 group-hover:bg-muted/50">
                          <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg">
                            <AugmentTileArt name={name} />
                          </div>
                        </div>
                        <p className="mt-2 text-center text-xs font-medium leading-snug text-foreground">{name}</p>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="mt-8 space-y-3">
                  <h3 className="flex items-center gap-2 border-b-2 border-border/60 pb-2 text-sm font-semibold tracking-tight text-foreground">
                    <Box className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    标注框
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {AUGMENT_OPTIONS["标注框"].map((name) => (
                      <button
                        key={`标注框-${name}`}
                        type="button"
                        className={cn(
                          "group flex flex-col items-stretch rounded-xl border-2 border-border bg-card p-3 text-left transition",
                          "hover:border-primary hover:bg-accent/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                        onClick={() => {
                          setAugmentDraft({ category: "标注框", name })
                          setAugmentDraftConfig("")
                          setAugmentUi("settings")
                        }}
                      >
                        <div className="flex aspect-[4/3] w-full flex-col rounded-lg border-2 border-border bg-muted/30 transition group-hover:border-primary/60 group-hover:bg-muted/50">
                          <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg">
                            <AugmentTileArt name={name} />
                          </div>
                        </div>
                        <p className="mt-2 text-center text-xs font-medium leading-snug text-foreground">{name}</p>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {augmentUi === "settings" && augmentDraft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="augment-settings-title"
        >
          <Card className="w-full max-w-md border-border">
            <CardHeader className="space-y-1">
              <CardTitle id="augment-settings-title" className="text-base">
                数据增强 · {augmentDraft.category} · {augmentDraft.name}
              </CardTitle>
              <p className="text-xs text-muted-foreground">配置该项参数后添加到管线</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={augmentDraftConfig}
                onChange={(e) => setAugmentDraftConfig(e.target.value)}
                placeholder="参数（可选），如 angle=15 或 p=0.5"
                spellCheck={false}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAugmentUi("pick")}>
                  返回
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAugmentUi("closed")
                    setAugmentDraft(null)
                    setAugmentDraftConfig("")
                  }}
                >
                  取消
                </Button>
                <Button type="button" onClick={commitAugmentStep} disabled={!activeVersion}>
                  添加到管线
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

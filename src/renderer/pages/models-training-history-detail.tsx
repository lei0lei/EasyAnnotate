import { ConfirmDialog } from "@/components/confirm-dialog"
import { PageTabs, type PageTabItem } from "@/components/page-tabs"
import { TrainParamsPanel } from "@/components/train-params-panel"
import { TrainModelsDownloadList } from "@/components/train-models-download-list"
import { TrainResultsGallery } from "@/components/train-results-gallery"
import { Button } from "@/components/ui/button"
import {
  deleteYoloTrainingJob,
  fetchYoloTrainStatus,
  fetchYoloTrainingLogs,
  fetchYoloTrainingModelFiles,
  fetchYoloTrainingResultImages,
  probeBackendHealth,
  TRAINING_RUNNING_POLL_MS,
  YOLO_ACTIVE_JOB_STORAGE_KEY,
  type YoloTrainingModelFile,
  type YoloTrainingResultImage,
  type YoloWorkspaceSnapshot,
} from "@/lib/training-yolo-api"
import { useYoloTrainingMessages } from "@/lib/i18n"
import { buildTrainParamSections } from "@/lib/yolo-train-params-view"
import { formatYoloBackendEndpointLabel } from "@/lib/yolo-dataset-upload"
import { cn } from "@/lib/utils"
import { ArrowLeft, Loader2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

type DetailTabId = "logs" | "params" | "results" | "models"

export default function ModelsTrainingHistoryDetailPage() {
  const { m } = useYoloTrainingMessages()
  const { jobSlug = "" } = useParams<{ jobSlug: string }>()
  const navigate = useNavigate()
  const backendEndpoint = formatYoloBackendEndpointLabel()
  const [activeTab, setActiveTab] = useState<DetailTabId>("logs")
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [workspace, setWorkspace] = useState<YoloWorkspaceSnapshot | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [resultImages, setResultImages] = useState<YoloTrainingResultImage[]>([])
  const [resultsLoading, setResultsLoading] = useState(false)
  const [resultsError, setResultsError] = useState<string | null>(null)
  const [modelFiles, setModelFiles] = useState<YoloTrainingModelFile[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const refreshJobState = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!jobSlug) return
      if (!opts?.silent) {
        setWorkspaceLoading(true)
        setWorkspaceError(null)
      }
      void fetchYoloTrainStatus(jobSlug)
        .then(({ job, workspace: ws }) => {
          setWorkspace(ws)
          setDisplayName(ws.display_name?.trim() || jobSlug)
          setIsRunning(job.status === "running" && job.job_slug === jobSlug)
          if (!opts?.silent) setWorkspaceError(null)
        })
        .catch((e) => {
          setWorkspace(null)
          setDisplayName(jobSlug)
          setIsRunning(false)
          if (!opts?.silent) {
            const msg = e instanceof Error ? e.message : String(e)
            setWorkspaceError(m.historyDetail.requestFailed(msg))
          }
        })
        .finally(() => {
          if (!opts?.silent) setWorkspaceLoading(false)
        })
    },
    [jobSlug, m.historyDetail],
  )

  const loadLogs = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!jobSlug) return
      if (!opts?.silent) {
        setLoading(true)
        setError(null)
      }
      void fetchYoloTrainingLogs(jobSlug)
        .then((text) => {
          setLogs(text)
          if (!opts?.silent) setError(null)
        })
        .catch((e) => {
          if (!opts?.silent) {
            const msg = e instanceof Error ? e.message : String(e)
            setError(m.historyDetail.requestFailed(msg))
          }
        })
        .finally(() => {
          if (!opts?.silent) setLoading(false)
        })
    },
    [jobSlug, m.historyDetail],
  )

  useEffect(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  const resetDetailLoading = useCallback(() => {
    setLoading(false)
    setWorkspaceLoading(false)
    setResultsLoading(false)
    setModelsLoading(false)
  }, [])

  const detailTabs = useMemo(
    (): PageTabItem[] => [
      { id: "logs", label: m.historyDetail.tabLogs },
      { id: "params", label: m.historyDetail.tabParams },
      { id: "results", label: m.historyDetail.tabResults },
      { id: "models", label: m.historyDetail.tabModels },
    ],
    [m.historyDetail],
  )

  const loadResults = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!jobSlug) return
      if (!opts?.silent) {
        setResultsLoading(true)
        setResultsError(null)
      }
      void fetchYoloTrainingResultImages(jobSlug)
        .then((data) => {
          setResultImages(data.items ?? [])
          if (!opts?.silent) setResultsError(null)
        })
        .catch((e) => {
          if (!opts?.silent) {
            const msg = e instanceof Error ? e.message : String(e)
            setResultsError(
              msg.includes("404") || msg.includes("Not Found")
                ? m.historyDetail.resultsApiMissing
                : m.historyDetail.requestFailed(msg),
            )
          }
        })
        .finally(() => {
          if (!opts?.silent) setResultsLoading(false)
        })
    },
    [jobSlug, m.historyDetail],
  )

  const loadModels = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!jobSlug) return
      if (!opts?.silent) {
        setModelsLoading(true)
        setModelsError(null)
      }
      void fetchYoloTrainingModelFiles(jobSlug)
        .then((data) => {
          setModelFiles(data.items ?? [])
          if (!opts?.silent) setModelsError(null)
        })
        .catch((e) => {
          if (!opts?.silent) {
            const msg = e instanceof Error ? e.message : String(e)
            setModelsError(
              msg.includes("404") || msg.includes("Not Found")
                ? m.historyDetail.modelsApiMissing
                : m.historyDetail.requestFailed(msg),
            )
          }
        })
        .finally(() => {
          if (!opts?.silent) setModelsLoading(false)
        })
    },
    [jobSlug, m.historyDetail],
  )

  useEffect(() => {
    if (backendOk === null) return
    if (!backendOk) {
      resetDetailLoading()
      const disconnected = m.historyDetail.backendDisconnected
      setError(disconnected)
      setWorkspaceError(disconnected)
      setResultsError(disconnected)
      setModelsError(disconnected)
      return
    }
    setError(null)
    setWorkspaceError(null)
    setResultsError(null)
    setModelsError(null)
    refreshJobState()
    loadLogs()
    loadResults()
    loadModels()
  }, [backendOk, refreshJobState, loadLogs, loadResults, loadModels, resetDetailLoading, m.historyDetail])

  useEffect(() => {
    if (!backendOk || !jobSlug || !isRunning) return
    const t = window.setInterval(() => refreshJobState({ silent: true }), TRAINING_RUNNING_POLL_MS)
    return () => window.clearInterval(t)
  }, [backendOk, jobSlug, isRunning, refreshJobState])

  const pageTitle = useMemo(() => displayName || jobSlug || "训练任务", [displayName, jobSlug])

  const paramSections = useMemo(
    () => (workspace ? buildTrainParamSections(workspace) : []),
    [workspace],
  )

  const hasTrainParams = Boolean(
    workspace?.meta &&
      typeof workspace.meta.train_params === "object" &&
      workspace.meta.train_params !== null,
  )

  async function confirmDelete() {
    if (!jobSlug || isRunning || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deleteYoloTrainingJob(jobSlug)
      const active = sessionStorage.getItem(YOLO_ACTIVE_JOB_STORAGE_KEY)
      if (active === jobSlug) {
        sessionStorage.removeItem(YOLO_ACTIVE_JOB_STORAGE_KEY)
      }
      setDeleteDialogOpen(false)
      navigate("/models/training/history", { replace: true })
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col px-6 py-8 pb-12">
      <div className="flex shrink-0 flex-wrap items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回训练历史">
          <Link to="/models/training/history">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{jobSlug || "—"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {backendEndpoint.mode === "remote"
              ? m.backendModeRemote(backendEndpoint.label)
              : m.backendModeLocal}
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={!backendOk || !jobSlug || isRunning || deleteBusy}
          title={isRunning ? "训练进行中，无法删除" : undefined}
          onClick={() => {
            setDeleteError(null)
            setDeleteDialogOpen(true)
          }}
        >
          {deleteBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          删除任务
        </Button>
      </div>

      {backendOk === false ? (
        <p className="mt-4 shrink-0 text-sm text-destructive">
          后端未连接，无法读取日志。请先在设置中启动本地或连接远程后端。
        </p>
      ) : null}
      {isRunning ? (
        <p className="mt-2 shrink-0 text-sm text-primary">
          该任务正在训练中，完成后方可删除。进度约每分钟自动更新；日志与结果请手动重新加载。
        </p>
      ) : null}
      {deleteError ? <p className="mt-2 shrink-0 text-sm text-destructive">{deleteError}</p> : null}

      <ConfirmDialog
        open={deleteDialogOpen}
        title="删除训练任务"
        destructive
        busy={deleteBusy}
        confirmLabel="删除"
        onOpenChange={(open) => {
          if (!deleteBusy) setDeleteDialogOpen(open)
        }}
        onConfirm={() => void confirmDelete()}
        description={
          <>
            确定删除训练任务 <span className="font-mono text-foreground">{jobSlug}</span> 吗？
            <br />
            将永久删除 <code className="text-xs">external/temp</code> 下对应目录及全部日志与权重副本，且不可恢复。
          </>
        }
      />

      <PageTabs
        className="mt-6 shrink-0"
        tabs={detailTabs}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as DetailTabId)}
      />

      <div className="mt-4 min-h-0 flex-1">
        {activeTab === "logs" ? (
          <section
            id="tabpanel-logs"
            role="tabpanel"
            aria-labelledby="tab-logs"
            className="flex min-h-[min(70vh,640px)] flex-col"
          >
            <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
              {isRunning ? (
                <span className="mr-auto text-xs text-muted-foreground">训练中，请点击「重新加载」查看最新日志</span>
              ) : (
                <span className="mr-auto" />
              )}
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => loadLogs()}>
                重新加载
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {loading && !error && !logs ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {m.historyDetail.loadingLogs}
                </div>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <pre
                  className={cn(
                    "h-full max-h-[min(70vh,640px)] min-h-[320px] overflow-auto rounded-lg border border-border/60 bg-muted/20 p-4",
                    "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground",
                  )}
                >
                  {logs || (loading ? "" : "（暂无日志）")}
                </pre>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "params" ? (
          <section
            id="tabpanel-params"
            role="tabpanel"
            aria-labelledby="tab-params"
            className="min-h-[min(50vh,480px)]"
          >
            {workspaceLoading && !workspaceError && !workspace ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {m.historyDetail.loadingParams}
              </div>
            ) : workspaceError ? (
              <p className="text-sm text-destructive">{workspaceError}</p>
            ) : (
              <TrainParamsPanel
                sections={paramSections}
                emptyMessage={
                  hasTrainParams
                    ? "暂无参数记录"
                    : "尚未开始训练，无训练参数记录；开始训练后将显示本次使用的 epochs、batch、增强与优化器等配置。"
                }
              />
            )}
          </section>
        ) : null}

        {activeTab === "results" ? (
          <section
            id="tabpanel-results"
            role="tabpanel"
            aria-labelledby="tab-results"
            className="min-h-[min(50vh,480px)]"
          >
            <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
              {isRunning ? (
                <span className="mr-auto text-xs text-muted-foreground">训练中，请点击「重新加载」查看最新结果图</span>
              ) : (
                <span className="mr-auto" />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resultsLoading}
                onClick={() => loadResults()}
              >
                重新加载
              </Button>
            </div>
            {resultsLoading && !resultsError && resultImages.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {m.historyDetail.loadingResults}
              </div>
            ) : resultsError ? (
              <p className="text-sm text-destructive">{resultsError}</p>
            ) : (
              <TrainResultsGallery jobSlug={jobSlug} items={resultImages} />
            )}
          </section>
        ) : null}

        {activeTab === "models" ? (
          <section
            id="tabpanel-models"
            role="tabpanel"
            aria-labelledby="tab-models"
            className="min-h-[min(50vh,480px)]"
          >
            <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
              {isRunning ? (
                <span className="mr-auto text-xs text-muted-foreground">训练中，请点击「重新加载」查看最新模型</span>
              ) : (
                <span className="mr-auto" />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={modelsLoading}
                onClick={() => loadModels()}
              >
                重新加载
              </Button>
            </div>
            {modelsLoading && !modelsError && modelFiles.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {m.historyDetail.loadingModels}
              </div>
            ) : modelsError ? (
              <p className="text-sm text-destructive">{modelsError}</p>
            ) : (
              <TrainModelsDownloadList
                jobSlug={jobSlug}
                items={modelFiles}
                emptyMessage={m.historyDetail.modelsEmpty}
                downloadLabel={m.historyDetail.downloadModel}
                downloadingLabel={m.historyDetail.downloadingModel}
                savedTo={m.historyDetail.modelSavedTo}
                downloadFailed={m.historyDetail.modelDownloadFailed}
              />
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

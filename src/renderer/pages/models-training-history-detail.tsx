import { ConfirmDialog } from "@/components/confirm-dialog"
import { PageTabs, type PageTabItem } from "@/components/page-tabs"
import { TrainParamsPanel } from "@/components/train-params-panel"
import { TrainResultsGallery } from "@/components/train-results-gallery"
import { Button } from "@/components/ui/button"
import {
  deleteYoloTrainingJob,
  fetchYoloTrainStatus,
  fetchYoloTrainingLogs,
  fetchYoloTrainingResultImages,
  probeBackendHealth,
  YOLO_ACTIVE_JOB_STORAGE_KEY,
  type YoloTrainingResultImage,
  type YoloWorkspaceSnapshot,
} from "@/lib/training-yolo-api"
import { buildTrainParamSections } from "@/lib/yolo-train-params-view"
import { cn } from "@/lib/utils"
import { ArrowLeft, Loader2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

const DETAIL_TABS = [
  { id: "logs", label: "日志" },
  { id: "params", label: "参数" },
  { id: "results", label: "结果" },
] as const satisfies PageTabItem[]

type DetailTabId = (typeof DETAIL_TABS)[number]["id"]

export default function ModelsTrainingHistoryDetailPage() {
  const { jobSlug = "" } = useParams<{ jobSlug: string }>()
  const navigate = useNavigate()
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
            setWorkspaceError(e instanceof Error ? e.message : String(e))
          }
        })
        .finally(() => {
          if (!opts?.silent) setWorkspaceLoading(false)
        })
    },
    [jobSlug],
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
            setError(e instanceof Error ? e.message : String(e))
          }
        })
        .finally(() => {
          if (!opts?.silent) setLoading(false)
        })
    },
    [jobSlug],
  )

  useEffect(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

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
            setResultsError(e instanceof Error ? e.message : String(e))
          }
        })
        .finally(() => {
          if (!opts?.silent) setResultsLoading(false)
        })
    },
    [jobSlug],
  )

  useEffect(() => {
    refreshJobState()
    loadLogs()
    loadResults()
  }, [refreshJobState, loadLogs, loadResults])

  useEffect(() => {
    if (!jobSlug || !isRunning) return
    const t = window.setInterval(refreshJobState, 2000)
    return () => window.clearInterval(t)
  }, [jobSlug, isRunning, refreshJobState])

  useEffect(() => {
    if (!jobSlug || !isRunning || activeTab !== "logs") return
    const t = window.setInterval(() => loadLogs({ silent: true }), 3000)
    return () => window.clearInterval(t)
  }, [jobSlug, isRunning, activeTab, loadLogs])

  useEffect(() => {
    if (!jobSlug || !isRunning || activeTab !== "results") return
    const t = window.setInterval(() => loadResults({ silent: true }), 5000)
    return () => window.clearInterval(t)
  }, [jobSlug, isRunning, activeTab, loadResults])

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
        <p className="mt-2 shrink-0 text-sm text-primary">该任务正在训练中，完成后方可删除。</p>
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
        tabs={[...DETAIL_TABS]}
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
                <span className="mr-auto text-xs text-muted-foreground">训练中，日志将自动刷新</span>
              ) : (
                <span className="mr-auto" />
              )}
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => loadLogs()}>
                重新加载
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {loading && !logs ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取…
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
            {workspaceLoading && !workspace ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载参数…
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
                <span className="mr-auto text-xs text-muted-foreground">训练中，结果图将自动刷新</span>
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
            {resultsLoading && resultImages.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在扫描结果图…
              </div>
            ) : resultsError ? (
              <p className="text-sm text-destructive">{resultsError}</p>
            ) : (
              <TrainResultsGallery jobSlug={jobSlug} items={resultImages} />
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

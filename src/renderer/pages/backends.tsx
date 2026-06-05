import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Database,
  Layers,
  Rocket,
  Server,
  type LucideIcon,
} from "lucide-react"
import { Link, useParams } from "react-router-dom"

type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
type RouteItem = {
  method: RouteMethod
  path: string
}

type BackendRouteGroup = {
  id: string
  title: string
  desc: string
  icon: LucideIcon
  routes: RouteItem[]
}

const GROUPS: BackendRouteGroup[] = [
  { id: "health", title: "Health", desc: "服务健康检查", icon: Server, routes: [{ method: "GET", path: "/health" }] },
  {
    id: "models",
    title: "Models",
    desc: "模型推理与特征接口（含 upload）",
    icon: Box,
    routes: [
      { method: "GET", path: "/api/v1/models" },
      { method: "POST", path: "/api/v1/models/{model_id:path}/predict" },
      { method: "POST", path: "/api/v1/models/{model_id:path}/patch-features" },
      { method: "POST", path: "/api/v1/models/{model_id:path}/predict-upload" },
      { method: "POST", path: "/api/v1/models/{model_id:path}/patch-features-upload" },
    ],
  },
  {
    id: "sam-session",
    title: "SAM Session",
    desc: "SAM 服务端 encode/decode session（每客户端单 session）",
    icon: Box,
    routes: [
      { method: "POST", path: "/api/v1/sam/session/prepare" },
      { method: "POST", path: "/api/v1/sam/session/prepare-upload" },
      { method: "POST", path: "/api/v1/sam/session/decode" },
      { method: "DELETE", path: "/api/v1/sam/session" },
    ],
  },
  {
    id: "model-assets",
    title: "Model Assets",
    desc: "模型资源文件与下载",
    icon: Database,
    routes: [
      { method: "GET", path: "/api/v1/model-assets" },
      { method: "GET", path: "/api/v1/model-assets/{asset_id:path}/status" },
      { method: "POST", path: "/api/v1/model-assets/{asset_id:path}/ensure" },
    ],
  },
  {
    id: "model-runtime",
    title: "Model Runtime",
    desc: "模型运行时启停与状态",
    icon: Layers,
    routes: [
      { method: "GET", path: "/api/v1/model-runtime/catalog" },
      { method: "GET", path: "/api/v1/model-runtime/status" },
      { method: "POST", path: "/api/v1/model-runtime/{category_id}/start" },
      { method: "POST", path: "/api/v1/model-runtime/{category_id}/stop" },
    ],
  },
  {
    id: "training-yolo",
    title: "Training YOLO",
    desc: "YOLO 训练任务、数据与历史",
    icon: Rocket,
    routes: [
      { method: "GET", path: "/api/v1/training/yolo/catalog" },
      { method: "GET", path: "/api/v1/training/yolo/models" },
      { method: "GET", path: "/api/v1/training/yolo/history" },
      { method: "GET", path: "/api/v1/training/yolo/history/{job_slug}/results" },
      { method: "GET", path: "/api/v1/training/yolo/history/{job_slug}/results/image" },
      { method: "GET", path: "/api/v1/training/yolo/history/{job_slug}/models" },
      { method: "GET", path: "/api/v1/training/yolo/history/{job_slug}/models/download-info" },
      { method: "GET", path: "/api/v1/training/yolo/history/{job_slug}/models/file" },
      { method: "GET", path: "/api/v1/training/yolo/history/{job_slug}/logs" },
      { method: "DELETE", path: "/api/v1/training/yolo/history/{job_slug}" },
      { method: "POST", path: "/api/v1/training/yolo/jobs/prepare" },
      { method: "GET", path: "/api/v1/training/yolo/workspace" },
      { method: "GET", path: "/api/v1/training/yolo/devices" },
      { method: "GET", path: "/api/v1/training/yolo/status" },
      { method: "POST", path: "/api/v1/training/yolo/dataset/unpack" },
      { method: "POST", path: "/api/v1/training/yolo/dataset/upload/init" },
      { method: "PUT", path: "/api/v1/training/yolo/dataset/upload/chunk" },
      { method: "POST", path: "/api/v1/training/yolo/dataset/upload/complete" },
      { method: "POST", path: "/api/v1/training/yolo/dataset/upload" },
      { method: "POST", path: "/api/v1/training/yolo/base-model/select" },
      { method: "POST", path: "/api/v1/training/yolo/base-model/upload" },
      { method: "POST", path: "/api/v1/training/yolo/base-model/validate" },
      { method: "POST", path: "/api/v1/training/yolo/start" },
    ],
  },
  {
    id: "training-dinov2",
    title: "Training DINOv2",
    desc: "DINOv2 训练任务、数据与状态",
    icon: Rocket,
    routes: [
      { method: "GET", path: "/api/v1/training/dinov2/catalog" },
      { method: "GET", path: "/api/v1/training/dinov2/models" },
      { method: "GET", path: "/api/v1/training/dinov2/history" },
      { method: "POST", path: "/api/v1/training/dinov2/jobs/prepare" },
      { method: "GET", path: "/api/v1/training/dinov2/workspace" },
      { method: "GET", path: "/api/v1/training/dinov2/devices" },
      { method: "GET", path: "/api/v1/training/dinov2/status" },
      { method: "POST", path: "/api/v1/training/dinov2/dataset/unpack" },
      { method: "POST", path: "/api/v1/training/dinov2/dataset/upload" },
      { method: "POST", path: "/api/v1/training/dinov2/base-model/select" },
      { method: "POST", path: "/api/v1/training/dinov2/base-model/upload" },
      { method: "POST", path: "/api/v1/training/dinov2/start" },
    ],
  },
  {
    id: "yolo-batch",
    title: "YOLO Batch",
    desc: "批量标注模型管理与预测",
    icon: Layers,
    routes: [
      { method: "GET", path: "/api/v1/yolo-batch/catalog" },
      { method: "GET", path: "/api/v1/yolo-batch/models" },
      { method: "GET", path: "/api/v1/yolo-batch/status" },
      { method: "GET", path: "/api/v1/yolo-batch/models/{model_slug}" },
      { method: "POST", path: "/api/v1/yolo-batch/models/prepare" },
      { method: "PATCH", path: "/api/v1/yolo-batch/models/{model_slug}" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/data-yaml/upload/init" },
      { method: "PUT", path: "/api/v1/yolo-batch/models/{model_slug}/data-yaml/upload/chunk" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/data-yaml/upload/complete" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/weights/upload/init" },
      { method: "PUT", path: "/api/v1/yolo-batch/models/{model_slug}/weights/upload/chunk" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/weights/upload/complete" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/data-yaml/confirm" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/weights/confirm" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/data-yaml/upload" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/weights/upload" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/finalize" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/start" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/stop" },
      { method: "DELETE", path: "/api/v1/yolo-batch/models/{model_slug}" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/predict" },
      { method: "POST", path: "/api/v1/yolo-batch/models/{model_slug}/predict-upload" },
    ],
  },
]

function methodClassName(method: RouteMethod): string {
  switch (method) {
    case "GET":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    case "POST":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400"
    case "PUT":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400"
    case "PATCH":
      return "bg-violet-500/10 text-violet-600 dark:text-violet-400"
    case "DELETE":
      return "bg-rose-500/10 text-rose-600 dark:text-rose-400"
    default:
      return "bg-muted text-muted-foreground"
  }
}

export default function BackendsPage() {
  const { groupId } = useParams<{ groupId?: string }>()
  const activeGroup = GROUPS.find((group) => group.id === groupId)
  const inDetail = Boolean(activeGroup)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回">
          <Link to={inDetail ? "/backends" : "/"}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Server className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Backends</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            后端路由看板。每个大项是一个 board，点击进入可查看该分组下的详细路由。
          </p>
        </div>
      </div>

      {!inDetail ? (
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">后端路由分组</CardTitle>
            <CardDescription>按能力域分组展示，便于后续做状态探测与告警展示。</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {GROUPS.map((group) => {
                const Icon = group.icon
                return (
                  <li key={group.id}>
                    <Link to={`/backends/${group.id}`} className="group block rounded-lg">
                      <div className="rounded-lg border border-border/80 bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                              <Icon className="h-4 w-4" aria-hidden />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground">{group.title}</div>
                              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{group.desc}</div>
                            </div>
                          </div>
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                            aria-hidden
                          />
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">{group.routes.length} routes</div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{activeGroup.title}</CardTitle>
            <CardDescription>{activeGroup.desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeGroup.routes.map((route) => (
              <div
                key={`${route.method}:${route.path}`}
                className="flex flex-col gap-2 rounded-md border border-border/70 px-3 py-2 sm:flex-row sm:items-center"
              >
                <span
                  className={cn(
                    "inline-flex w-fit min-w-[64px] justify-center rounded px-2 py-1 text-xs font-semibold",
                    methodClassName(route.method),
                  )}
                >
                  {route.method}
                </span>
                <code className="text-xs text-foreground/90 sm:text-sm">{route.path}</code>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

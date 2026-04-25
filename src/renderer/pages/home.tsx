import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { mockProjects } from "@/lib/mock-projects"
import { cn } from "@/lib/utils"
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  FolderKanban,
  GitBranch,
  Layers,
  PlayCircle,
  Plus,
  Upload,
} from "lucide-react"
import { Link } from "react-router-dom"

const mockActivity = [
  { icon: Upload, text: "数据集「store-front-2024」已上传", time: "10 分钟前" },
  { icon: CheckCircle2, text: "训练任务 train-job-04 已完成", time: "1 小时前" },
  { icon: GitBranch, text: "Workflow「deploy-staging」已触发", time: "昨天" },
  { icon: FolderKanban, text: "项目「Retail Counter v2」配置已更新", time: "2 天前" },
] as const

export default function HomePage() {
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-6xl space-y-8 px-6 py-8 pb-12">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            工作台与团队概览（界面预览，操作尚未接入）
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className={cn("border-border/80 shadow-sm", "lg:col-span-2")}>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg font-semibold">工作台</CardTitle>
                  <CardDescription className="mt-1.5">
                    最近打开的项目与快捷操作
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="gap-1.5">
                    <PlayCircle className="h-4 w-4" aria-hidden />
                    继续标注
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="gap-1.5">
                    <Plus className="h-4 w-4" aria-hidden />
                    新建项目
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                最近打开
              </p>
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-muted/20">
                {mockProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/projects/${p.id}`}
                      className={cn(
                        "flex items-center justify-between gap-3 px-4 py-3 transition-colors",
                        "first:rounded-t-lg last:rounded-b-lg",
                        "hover:bg-accent/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate font-medium text-foreground">{p.name}</span>
                        </div>
                        <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">{p.path}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {p.updatedLabel}
                        <ArrowRight className="h-3.5 w-3.5 opacity-40" aria-hidden />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="space-y-6 lg:col-span-1">
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold">概览</CardTitle>
                <CardDescription>团队空间快照</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Layers className="h-4 w-4" aria-hidden />
                      <span className="text-xs font-medium">项目数</span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">12</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Activity className="h-4 w-4" aria-hidden />
                      <span className="text-xs font-medium">进行中任务</span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">5</p>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">任务进度</span>
                    <span className="tabular-nums text-foreground">68%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full w-[68%] rounded-full bg-primary transition-none"
                      role="presentation"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">本周标注批次完成度（示例）</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">最近活动</CardTitle>
                <CardDescription>团队动态</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-0">
                  {mockActivity.map((item, i) => (
                    <li key={i}>
                      {i > 0 ? <Separator className="my-3 bg-border/60" /> : null}
                      <div className="flex gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <item.icon className="h-4 w-4" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-snug text-foreground">{item.text}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.time}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

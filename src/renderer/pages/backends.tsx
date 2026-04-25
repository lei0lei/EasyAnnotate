import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  GitBranch,
  LineChart,
  Link2,
  Server,
  Sparkles,
  Wifi,
} from "lucide-react"
import type { ReactNode } from "react"

function StatusPill({ children, variant = "neutral" }: { children: ReactNode; variant?: "neutral" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variant === "warn"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          variant === "warn" ? "bg-amber-500" : "bg-muted-foreground/50",
        )}
        aria-hidden
      />
      {children}
    </span>
  )
}

export default function BackendsPage() {
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 pb-12">
        <header>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Server className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Backends</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                查看与后端（WebSocket / REST）连通性占位，以及自动标注、工作流与训练相关服务入口。当前仅为界面，不含真实连接与发现。
              </p>
            </div>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">连接与可用性</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Wifi className="h-4 w-4" aria-hidden />
                    </div>
                    <div>
                      <CardTitle className="text-base">WebSocket</CardTitle>
                      <CardDescription className="text-xs">实时推流、任务与日志（双工）</CardDescription>
                    </div>
                  </div>
                  <StatusPill>未检测</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground/80">端点（占位）</span>
                  <Input readOnly value="wss://api.example.com/v1/ws" className="font-mono text-xs" tabIndex={-1} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
                  <p className="text-xs text-muted-foreground">后续：握手、心跳与订阅能力探测</p>
                  <Button type="button" size="sm" variant="secondary" disabled>
                    检测连接
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Link2 className="h-4 w-4" aria-hidden />
                    </div>
                    <div>
                      <CardTitle className="text-base">RESTful API</CardTitle>
                      <CardDescription className="text-xs">模型、工作流与训练任务的 HTTP 接口</CardDescription>
                    </div>
                  </div>
                  <StatusPill>未检测</StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground/80">Base URL（占位）</span>
                  <Input readOnly value="https://api.example.com/v1" className="font-mono text-xs" tabIndex={-1} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
                  <p className="text-xs text-muted-foreground">后续：/health、OpenAPI 与凭据</p>
                  <Button type="button" size="sm" variant="secondary" disabled>
                    检测连接
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <Separator className="bg-border/60" />

        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">服务与能力（占位）</h2>
          <p className="text-xs text-muted-foreground">
            以下区块对应后端将暴露的：自动标注模型、工作流模型/编排、以及训练流程；列表与健康状态尚为静态示例。
          </p>
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" aria-hidden />
                </div>
                <CardTitle className="text-base">自动标注模型</CardTitle>
                <CardDescription className="text-xs">预标注、辅助框与类别建议等推理服务</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="text-xs text-muted-foreground">
                  <li>· 模型列表与版本</li>
                  <li>· 能力：检测 / 分割 / …</li>
                  <li>· 运行态：排队与 GPU</li>
                </ul>
                <div className="pt-1">
                  <StatusPill variant="warn">未接入</StatusPill>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <GitBranch className="h-5 w-5" aria-hidden />
                </div>
                <CardTitle className="text-base">工作流模型</CardTitle>
                <CardDescription className="text-xs">与客户端 Workflows 对应的编排与执行后端</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="text-xs text-muted-foreground">
                  <li>· 图定义与算子注册</li>
                  <li>· 一次运行与重放</li>
                  <li>· 与 WS 推送的衔接</li>
                </ul>
                <div className="pt-1">
                  <StatusPill variant="warn">未接入</StatusPill>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <LineChart className="h-5 w-5" aria-hidden />
                </div>
                <CardTitle className="text-base">训练流程</CardTitle>
                <CardDescription className="text-xs">任务创建、数据管道、训练日志与产物</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="text-xs text-muted-foreground">
                  <li>· 实验与超参</li>
                  <li>· 指标与 checkpoint</li>
                  <li>· 状态机：待运行 / 运行中 / 成功</li>
                </ul>
                <div className="pt-1">
                  <StatusPill variant="warn">未接入</StatusPill>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  )
}

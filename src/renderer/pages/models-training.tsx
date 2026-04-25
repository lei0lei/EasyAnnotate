import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, LineChart, Plus } from "lucide-react"
import { Link } from "react-router-dom"

const mockTrainingJobs = [
  { id: "t1", name: "retail-counter-v3", stage: "训练中", progress: 62 },
  { id: "t2", name: "parking-seg-finetune", stage: "排队中", progress: 0 },
  { id: "t3", name: "warehouse-inv-baseline", stage: "已完成", progress: 100 },
] as const

export default function ModelsTrainingPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Models">
            <Link to="/models">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LineChart className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">模型训练</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                查看训练任务、日志与导出 checkpoint（占位）
              </p>
            </div>
          </div>
        </div>
        <Button type="button" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden />
          新建训练
        </Button>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">训练任务</CardTitle>
          <CardDescription>示例任务与进度，后续对接训练后端</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {mockTrainingJobs.map((job) => (
            <div
              key={job.id}
              className="rounded-lg border border-border/60 bg-muted/15 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">{job.name}</p>
                <span className="text-xs text-muted-foreground">{job.stage}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-none"
                  style={{ width: `${job.progress}%` }}
                  role="presentation"
                />
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                进度 {job.progress}%
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

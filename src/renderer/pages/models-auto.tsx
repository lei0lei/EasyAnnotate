import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ArrowLeft, Plus, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

const mockAutoModels = [
  { id: "1", name: "YOLOv8n · 检测", version: "v1.2", backend: "ONNX Runtime", status: "就绪" },
  { id: "2", name: "SegFormer · 分割", version: "v0.9", backend: "TensorRT", status: "就绪" },
  { id: "3", name: "CLIP 辅助 · 分类", version: "draft", backend: "CPU", status: "未部署" },
] as const

export default function ModelsAutoPage() {
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
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">自动标注模型</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                管理用于预标注、辅助框选与类别推荐的推理模型（占位）
              </p>
            </div>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden />
          注册模型
        </Button>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">已注册模型</CardTitle>
          <CardDescription>示例列表，后续对接模型仓库与版本</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-muted/15">
            {mockAutoModels.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 first:rounded-t-lg last:rounded-b-lg"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{m.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.backend} · {m.version}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium",
                    m.status === "就绪"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  {m.status}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

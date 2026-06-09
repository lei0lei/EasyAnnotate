import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { probeBackendHealth } from "@/lib/training-yolo-api"
import { cn } from "@/lib/utils"
import { ArrowLeft, Box, ChevronRight, Cpu, History, LineChart } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

export default function ModelsTrainingPage() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  const refreshBackend = useCallback(() => {
    void probeBackendHealth().then(setBackendOk)
  }, [])

  useEffect(() => {
    refreshBackend()
    const t = window.setInterval(refreshBackend, 2500)
    return () => window.clearInterval(t)
  }, [refreshBackend])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Models">
          <Link to="/models">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">模型训练</h1>
          <p className="mt-1 text-sm text-muted-foreground">需先连接本地或远程后端 API</p>
        </div>
      </div>

      <Card className={cn("border-border/80", backendOk === false && "border-destructive/40")}>
        <CardContent className="flex items-center gap-2 py-4 text-sm">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              backendOk === null ? "bg-muted-foreground/50" : backendOk ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          {backendOk === null ? "正在检测后端…" : backendOk ? "后端已就绪，可进入训练面板" : "后端未连接，请先在设置中启动本地或连接远程后端"}
          <Button type="button" variant="outline" size="sm" className="ml-auto" asChild>
            <Link to="/settings">设置</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Box className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">DINOv2</CardTitle>
            <CardDescription>ViT 预训练权重：线性探针 / 微调 / 部分解冻</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="default" className="w-full" disabled={backendOk === false}>
              <Link to="/models/training/dinov2">进入 DINOv2 训练</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LineChart className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">YOLO</CardTitle>
            <CardDescription>Ultralytics：检测 / 分割 / 姿态 / OBB</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="default" className="w-full" disabled={backendOk === false}>
              <Link to="/models/training/yolo">进入 YOLO 训练</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm sm:col-span-2">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Cpu className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">TensorRT 模型转换</CardTitle>
            <CardDescription>将 ONNX 模型转换为 TensorRT engine（需配置 onnx2tensorRT 工具路径）</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="default" className="w-full">
              <Link to="/models/training/tensorrt">进入 TensorRT 转换</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Link
        to="/models/training/history"
        className={cn(
          "block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          backendOk === false && "pointer-events-none opacity-60",
        )}
        aria-disabled={backendOk === false}
        onClick={(e) => {
          if (backendOk === false) e.preventDefault()
        }}
      >
        <Card className="border-border/80 shadow-sm transition-colors hover:bg-muted/20">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-foreground">
              <History className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">训练历史</p>
              <p className="mt-0.5 text-sm text-muted-foreground">查看历次 YOLO 训练任务与日志</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    </div>
  )
}

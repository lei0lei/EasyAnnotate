import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"

export default function WelcomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">欢迎使用 EasyAnnotate</h1>
        <p className="mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
          使用顶部{" "}
          <span className="font-medium text-foreground">Project</span>、
          <span className="font-medium text-foreground">Models</span>、
          <span className="font-medium text-foreground">Settings</span>、
          <span className="font-medium text-foreground">Requests</span>{" "}
          菜单进入各模块；系统级菜单仍在窗口最外沿（文件 / 编辑 / 帮助）。
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" disabled className="min-w-[9rem]">
            开始标注
          </Button>
          <p className="w-full text-xs text-muted-foreground sm:w-auto">（后续版本启用）</p>
        </div>
      </div>
  )
}

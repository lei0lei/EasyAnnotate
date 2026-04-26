import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Import } from "lucide-react"
import { Link } from "react-router-dom"

export default function ProjectsImportPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Projects">
          <Link to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">导入项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">导入现有项目配置与数据（暂为占位页面）</p>
        </div>
      </div>

      <Card className="border-dashed border-border/80 bg-muted/10 shadow-none">
        <CardHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Import className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle className="text-base font-medium text-muted-foreground">导入配置</CardTitle>
          <CardDescription>后续可在此选择项目目录或导入描述文件。</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">占位区域 — 后续接导入流程与校验。</p>
        </CardContent>
      </Card>
    </div>
  )
}

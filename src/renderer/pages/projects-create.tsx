import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"

export default function ProjectsCreatePage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Projects">
          <Link to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">创建项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">表单与逻辑尚未接入</p>
        </div>
      </div>

      <Card className="border-dashed border-border/80 bg-muted/10 shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">项目信息</CardTitle>
          <CardDescription>此处将提供项目名称、路径、模板等字段</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">占位区域 — 后续接创建流程与校验。</p>
        </CardContent>
      </Card>
    </div>
  )
}

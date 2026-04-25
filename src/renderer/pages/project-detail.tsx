import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getMockProject } from "@/lib/mock-projects"
import { ArrowLeft } from "lucide-react"
import { Link, useParams } from "react-router-dom"

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const project = projectId ? getMockProject(projectId) : undefined

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回我的项目">
          <Link to="/projects/mine">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
            {project?.name ?? "项目"}
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {project ? `${project.path} · ${projectId}` : `未知项目 · ${projectId ?? "—"}`}
          </p>
        </div>
      </div>

      <Card className="border-dashed border-border/80 bg-muted/10 shadow-none">
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">项目工作台</CardTitle>
          <CardDescription>数据集、标注、导出等将在此展开</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">占位 — 后续接项目内导航与功能模块。</p>
        </CardContent>
      </Card>
    </div>
  )
}

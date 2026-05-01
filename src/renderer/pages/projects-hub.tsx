import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FolderKanban, Import, Plus } from "lucide-react"
import { Link } from "react-router-dom"

export default function ProjectsHubPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">创建新项目或管理已有项目（界面预览）</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plus className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">创建项目</CardTitle>
            <CardDescription>新建标注工程与目录结构</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-auto">
              <Link to="/projects/new">进入</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderKanban className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">我的项目</CardTitle>
            <CardDescription>查看并打开所有本地项目</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/projects/mine">进入</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Import className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">导入项目</CardTitle>
            <CardDescription>导入已有项目目录或配置文件</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/projects/import">进入</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

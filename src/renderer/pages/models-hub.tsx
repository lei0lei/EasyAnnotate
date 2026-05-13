import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LineChart, Server, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

export default function ModelsHubPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Models</h1>
        <p className="mt-1 text-sm text-muted-foreground">自动标注工具与模型训练（界面预览）</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Server className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">后端模型管理</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/models/backend">进入</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">自动标注工具</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/models/auto">进入</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LineChart className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg">模型训练</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/models/training">进入</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

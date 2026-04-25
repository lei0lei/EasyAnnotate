import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { mockProjects } from "@/lib/mock-projects"
import { ArrowLeft, ArrowRight, Clock, FolderKanban } from "lucide-react"
import { Link } from "react-router-dom"

export default function ProjectsMinePage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8 pb-12">
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Projects">
          <Link to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">我的项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">示例列表，点击进入项目页</p>
        </div>
      </div>

      <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-muted/20">
        {mockProjects.map((p) => (
          <li key={p.id}>
            <Link
              to={`/projects/${p.id}`}
              className={cn(
                "flex items-center justify-between gap-3 px-4 py-3 transition-colors",
                "hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-medium text-foreground">{p.name}</span>
                </div>
                <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">{p.path}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {p.updatedLabel}
                <ArrowRight className="h-3.5 w-3.5 opacity-40" aria-hidden />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

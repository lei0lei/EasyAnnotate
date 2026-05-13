import { Button } from "@/components/ui/button"
import { ArrowLeft, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"

export default function ModelsAutoPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label="返回 Models">
          <Link to="/models">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">自动标注工具</h1>
          </div>
        </div>
      </div>
    </div>
  )
}

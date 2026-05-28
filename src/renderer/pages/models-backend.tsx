import { BackendGlobalRuntimePanel } from "@/components/backend-global-runtime-panel"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ArrowLeft, Server } from "lucide-react"
import { Link } from "react-router-dom"

const PAGE_TITLE = "\u540e\u7aef\u6a21\u578b\u7ba1\u7406"
const PAGE_DESC =
  "\u5168\u5c40 SAM \u4e0e DINOv2 \u63a8\u7406\u5b9e\u4f8b\uff1b\u5404\u81ea\u52a8\u6807\u6ce8\u5de5\u5177\u5171\u7528\u6b64\u5904\u5df2\u542f\u52a8\u7684\u6a21\u578b\u3002"

export function GpuSwitch({
  id,
  checked,
  disabled,
  onCheckedChange,
  label,
}: {
  id: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (v: boolean) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span id={`${id}-label`} className="text-xs text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onCheckedChange(!checked)
        }}
        className={cn(
          "inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "justify-end border-primary bg-primary" : "justify-start border-border bg-muted",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        )}
      >
        <span
          className={cn(
            "pointer-events-none h-5 w-5 shrink-0 rounded-full bg-background shadow-md ring-1 ring-black/5 dark:ring-white/10",
          )}
          aria-hidden
        />
      </button>
    </div>
  )
}

export default function ModelsBackendPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label="返回 Models">
          <Link to="/models">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Server className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{PAGE_TITLE}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{PAGE_DESC}</p>
        </div>
      </div>
      <BackendGlobalRuntimePanel />
    </div>
  )
}

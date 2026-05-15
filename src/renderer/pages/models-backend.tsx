import { cn } from "@/lib/utils"
import { Server } from "lucide-react"

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
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8 pb-12">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Server className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">后端模型管理</h1>
        </div>
      </div>
    </div>
  )
}

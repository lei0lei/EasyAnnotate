import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { GpuSwitch } from "@/pages/models-backend"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"
import { useState, type ReactNode } from "react"

export function YoloAdvancedBoard({
  title,
  enabled,
  onEnabledChange,
  dimmed,
  children,
  switchOnLabel = "启用",
  switchOffLabel = "关闭",
}: {
  title: string
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  dimmed?: boolean
  children: ReactNode
  switchOnLabel?: string
  switchOffLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const switchId = `yolo-adv-${title.replace(/\s/g, "-")}`
  const panelId = `${switchId}-panel`

  return (
    <Card className={cn("border-border/80 shadow-sm", dimmed && "opacity-60")}>
      <CardContent className={cn("py-4", expanded && "space-y-4")}>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
            <span className="text-xs font-medium text-muted-foreground">{title}</span>
          </button>
          <GpuSwitch
            id={switchId}
            checked={enabled}
            onCheckedChange={onEnabledChange}
            label={enabled ? switchOnLabel : switchOffLabel}
          />
        </div>
        {expanded ? (
          <div
            id={panelId}
            className={cn("grid gap-4 sm:grid-cols-2", !enabled && "pointer-events-none opacity-45")}
          >
            {children}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function YoloParamField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground" title={hint}>
        {label}
      </span>
      {children}
    </label>
  )
}

export function YoloFloatInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number | string
  min?: number
  max?: number
  step?: number
  onChange: (n: number) => void
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step ?? (max !== undefined && max <= 1 ? 0.01 : 1)}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (!Number.isFinite(n)) return
        let v = n
        if (min !== undefined) v = Math.max(min, v)
        if (max !== undefined) v = Math.min(max, v)
        onChange(v)
      }}
    />
  )
}

export function YoloSelectInput({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <select
      className="h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export function YoloBoolSelect({
  value,
  onChange,
  noLabel = "否",
  yesLabel = "是",
}: {
  value: number | string
  onChange: (on: boolean) => void
  noLabel?: string
  yesLabel?: string
}) {
  const on = Number(value) !== 0
  return (
    <select
      className="h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={on ? "1" : "0"}
      onChange={(e) => onChange(e.target.value === "1")}
    >
      <option value="0">{noLabel}</option>
      <option value="1">{yesLabel}</option>
    </select>
  )
}

export function YoloTextInput({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <Input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

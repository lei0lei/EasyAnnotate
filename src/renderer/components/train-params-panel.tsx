import type { TrainParamSection } from "@/lib/yolo-train-params-view"
import { cn } from "@/lib/utils"

type TrainParamsPanelProps = {
  sections: TrainParamSection[]
  emptyMessage?: string
  className?: string
}

export function TrainParamsPanel({
  sections,
  emptyMessage = "尚未记录训练参数（任务创建后、开始训练前可能为空）",
  className,
}: TrainParamsPanelProps) {
  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <div className={cn("space-y-6", className)}>
      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="mb-3 text-sm font-medium text-foreground">{section.title}</h3>
          <dl className="divide-y divide-border/60 rounded-lg border border-border/60 bg-muted/15">
            {section.rows.map((row) => (
              <div
                key={`${section.title}-${row.label}`}
                className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(8rem,11rem)_1fr] sm:gap-4"
              >
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="break-words font-mono text-sm text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

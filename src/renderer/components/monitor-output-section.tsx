import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type OutputLevel = "info" | "success" | "warn" | "error"

type OutputLine = {
  id: string
  ts: string
  workflowName: string
  level: OutputLevel
  message: string
  detail?: string
}

const OUTPUT_LAYOUT_SAMPLES: OutputLine[] = [
  {
    id: "sample-1",
    ts: "2000-01-01T10:00:00.000Z",
    workflowName: "示例工作流",
    level: "info",
    message: "工作流开始执行（界面示例）",
  },
  {
    id: "sample-2",
    ts: "2000-01-01T10:00:01.000Z",
    workflowName: "示例工作流",
    level: "success",
    message: "运行结束（界面示例）",
    detail: JSON.stringify({ latencyMs: 0, note: "mock" }),
  },
]

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return iso
  }
}

function levelStyle(level: OutputLevel): string {
  switch (level) {
    case "success":
      return "text-emerald-600 dark:text-emerald-400"
    case "warn":
      return "text-amber-600 dark:text-amber-400"
    case "error":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}

/**
 * 运行输出区域（静态示例，后续接入工作流实际输出）
 */
export function MonitorOutputSection() {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">运行输出</CardTitle>
        <CardDescription className="mt-1">
          预留与工作流运行日志对齐的展示样式；下方为静态示例，接入后将由实际运行结果驱动。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "max-h-[min(520px,55vh)] overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3",
            "scrollbar-none font-mono text-xs leading-relaxed",
          )}
        >
          <ul className="space-y-3 opacity-90">
            {OUTPUT_LAYOUT_SAMPLES.map((line) => (
              <li key={line.id} className="border-b border-border/40 pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="tabular-nums text-[10px] text-muted-foreground">
                    {formatTs(line.ts)}
                  </span>
                  <span className={cn("text-[10px] font-semibold uppercase", levelStyle(line.level))}>
                    {line.level}
                  </span>
                  <span className="text-[11px] text-primary/90">[{line.workflowName}]</span>
                </div>
                <p className="mt-1 text-foreground">{line.message}</p>
                {line.detail ? (
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                    {line.detail}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

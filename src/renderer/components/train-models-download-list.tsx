import { Button } from "@/components/ui/button"
import {
  downloadYoloTrainingModelWithSaveDialog,
  type YoloTrainingModelFile,
} from "@/lib/training-yolo-api"
import { Download, Loader2 } from "lucide-react"
import { useCallback, useState } from "react"

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

type TrainModelsDownloadListProps = {
  jobSlug: string
  items: YoloTrainingModelFile[]
  emptyMessage: string
  downloadLabel: string
  downloadingLabel: string
  savedTo: (path: string) => string
  downloadFailed: (detail: string) => string
}

export function TrainModelsDownloadList({
  jobSlug,
  items,
  emptyMessage,
  downloadLabel,
  downloadingLabel,
  savedTo,
  downloadFailed,
}: TrainModelsDownloadListProps) {
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  const handleDownload = useCallback(
    async (item: YoloTrainingModelFile) => {
      setBusyPath(item.path)
      setStatus(null)
      try {
        const result = await downloadYoloTrainingModelWithSaveDialog(jobSlug, item)
        if (result.canceled) return
        if (result.errorMessage) {
          setStatus({ kind: "error", text: downloadFailed(result.errorMessage) })
          return
        }
        if (result.savedPath) {
          setStatus({ kind: "success", text: savedTo(result.savedPath) })
        }
      } finally {
        setBusyPath(null)
      }
    },
    [jobSlug, downloadFailed, savedTo],
  )

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <div className="space-y-3">
      {status ? (
        <p
          className={
            status.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {status.text}
        </p>
      ) : null}
      <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
        {items.map((item) => {
          const busy = busyPath === item.path
          return (
            <li
              key={item.path}
              className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{item.name}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{item.path}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.kind.toUpperCase()} · {formatFileSize(item.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled={busyPath != null}
                onClick={() => void handleDownload(item)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {busy ? downloadingLabel : downloadLabel}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

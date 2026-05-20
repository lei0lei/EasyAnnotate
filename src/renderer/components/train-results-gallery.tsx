import type { YoloTrainingResultImage } from "@/lib/training-yolo-api"
import { yoloTrainingResultImageUrl } from "@/lib/training-yolo-api"
import { cn } from "@/lib/utils"
import { useState } from "react"

type TrainResultsGalleryProps = {
  jobSlug: string
  items: YoloTrainingResultImage[]
  emptyMessage?: string
  className?: string
}

export function TrainResultsGallery({
  jobSlug,
  items,
  emptyMessage = "暂无训练结果图；训练开始后会出现在 runs/ 目录（如 results.png、验证批次预览等）。",
  className,
}: TrainResultsGalleryProps) {
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  const previewItem = items.find((i) => i.path === previewPath) ?? items[0]

  return (
    <div className={cn("space-y-4", className)}>
      <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/15">
        <div className="border-b border-border/60 bg-muted/25 px-3 py-2">
          <p className="truncate font-mono text-xs text-muted-foreground" title={previewItem.path}>
            {previewItem.path}
          </p>
        </div>
        <div className="flex min-h-[200px] items-center justify-center bg-background/50 p-3">
          <img
            key={`${previewItem.path}-${previewItem.mtime}`}
            src={yoloTrainingResultImageUrl(jobSlug, previewItem.path, previewItem.mtime)}
            alt={previewItem.name}
            className="max-h-[min(52vh,520px)] w-full object-contain"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => {
          const selected = item.path === previewItem.path
          return (
            <button
              key={item.path}
              type="button"
              className={cn(
                "group overflow-hidden rounded-lg border text-left transition-colors",
                selected
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border/60 hover:border-border hover:bg-muted/20",
              )}
              onClick={() => setPreviewPath(item.path)}
            >
              <div className="aspect-[4/3] bg-muted/30">
                <img
                  src={yoloTrainingResultImageUrl(jobSlug, item.path, item.mtime)}
                  alt={item.name}
                  loading="lazy"
                  className="h-full w-full object-contain p-1"
                />
              </div>
              <p
                className="truncate border-t border-border/50 px-2 py-1.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground"
                title={item.path}
              >
                {item.name}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

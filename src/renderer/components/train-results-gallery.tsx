import {
  fetchYoloTrainingResultImageObjectUrl,
  type YoloTrainingResultImage,
} from "@/lib/training-yolo-api"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

type TrainResultsGalleryProps = {
  jobSlug: string
  items: YoloTrainingResultImage[]
  emptyMessage?: string
  className?: string
}

type TrainResultImageProps = {
  jobSlug: string
  item: YoloTrainingResultImage
  alt: string
  className?: string
  loading?: "lazy" | "eager"
}

function TrainResultImage({ jobSlug, item, alt, className, loading }: TrainResultImageProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    setSrc(null)
    setFailed(false)
    void fetchYoloTrainingResultImageObjectUrl(jobSlug, item.path, item.mtime)
      .then((url) => {
        if (!alive) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [jobSlug, item.path, item.mtime])

  if (failed) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted/20 text-xs text-muted-foreground", className)}
        title="图片加载失败"
      >
        加载失败
      </div>
    )
  }

  if (!src) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/20 text-muted-foreground", className)}>
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    )
  }

  return <img src={src} alt={alt} loading={loading} className={className} />
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
          <TrainResultImage
            key={`${previewItem.path}-${previewItem.mtime}`}
            jobSlug={jobSlug}
            item={previewItem}
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
                <TrainResultImage
                  jobSlug={jobSlug}
                  item={item}
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

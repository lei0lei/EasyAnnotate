import { cn } from "@/lib/utils"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import type { ProjectItem } from "@/lib/projects-api"
import type { XAnyLabelShape } from "@/lib/xanylabeling-format"
import { normalizeTagColor } from "@/pages/project-task-detail/utils"
import { Button } from "@/components/ui/button"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { ArrowLeft, ChevronLeft, ChevronRight, Circle, Download, Eye, EyeOff, FileJson, MousePointer2, MoreHorizontal, PenLine, RotateCw, SlidersHorizontal, Square, Tag, Trash2, Type } from "lucide-react"
import { memo, type MouseEvent, type ReactNode } from "react"
import { Link } from "react-router-dom"
import type { LeftPanelMode, RenderedRectangle } from "@/pages/project-task-detail/types"

type RectangleOverlayItemProps = {
  item: RenderedRectangle
  drawingLayerActive: boolean
  isSelected: boolean
  isHovered: boolean
  onMouseEnter: (index: number) => void
  onMouseLeave: (index: number) => void
  onMouseDown: (index: number, event: MouseEvent<HTMLDivElement>) => void
  onClick: (index: number, event: MouseEvent<HTMLDivElement>) => void
}

export const RectangleOverlayItem = memo(
  function RectangleOverlayItem({
    item,
    drawingLayerActive,
    isSelected,
    isHovered,
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    onClick,
  }: RectangleOverlayItemProps) {
    return (
      <div
        className={cn(
          drawingLayerActive ? "pointer-events-none" : "pointer-events-auto",
          "absolute border-2",
        )}
        style={{
          left: item.left,
          top: item.top,
          width: item.width,
          height: item.height,
          borderColor: item.color,
          borderLeftWidth: item.clippedLeft ? 0 : 2,
          borderTopWidth: item.clippedTop ? 0 : 2,
          borderRightWidth: item.clippedRight ? 0 : 2,
          borderBottomWidth: item.clippedBottom ? 0 : 2,
          backgroundColor: isSelected || isHovered ? `${item.color}33` : "transparent",
        }}
        onMouseEnter={() => onMouseEnter(item.index)}
        onMouseLeave={() => onMouseLeave(item.index)}
        onMouseDown={(event) => onMouseDown(item.index, event)}
        onClick={(event) => onClick(item.index, event)}
        aria-label={`选择标注 ${item.label}`}
        role="button"
      >
        {null}
      </div>
    )
  },
  (prev, next) =>
    prev.onMouseEnter === next.onMouseEnter &&
    prev.onMouseLeave === next.onMouseLeave &&
    prev.onMouseDown === next.onMouseDown &&
    prev.onClick === next.onClick &&
    prev.drawingLayerActive === next.drawingLayerActive &&
    prev.isSelected === next.isSelected &&
    prev.isHovered === next.isHovered &&
    prev.item.index === next.item.index &&
    prev.item.label === next.item.label &&
    prev.item.color === next.item.color &&
    prev.item.left === next.item.left &&
    prev.item.top === next.item.top &&
    prev.item.width === next.item.width &&
    prev.item.height === next.item.height &&
    prev.item.clippedLeft === next.item.clippedLeft &&
    prev.item.clippedTop === next.item.clippedTop &&
    prev.item.clippedRight === next.item.clippedRight &&
    prev.item.clippedBottom === next.item.clippedBottom,
)

export const TaskLeftSidebarLayer = memo(function TaskLeftSidebarLayer({
  leftPanelMode,
  onPanelModeChange,
  children,
}: {
  leftPanelMode: LeftPanelMode
  onPanelModeChange: (mode: LeftPanelMode) => void
  children: ReactNode
}) {
  return (
    <>
      <div className="flex w-12 flex-col items-center gap-2 border-r border-border/70 py-3">
        <button
          type="button"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            leftPanelMode === "labels" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          aria-label="显示 labels 面板"
          onClick={() => onPanelModeChange("labels")}
        >
          <Tag className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            leftPanelMode === "attributes" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          aria-label="显示 attributes 面板"
          onClick={() => onPanelModeChange("attributes")}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            leftPanelMode === "raw" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          aria-label="显示 raw data 面板"
          onClick={() => onPanelModeChange("raw")}
        >
          <FileJson className="h-4 w-4" />
        </button>
      </div>
      <div className="flex w-72 flex-col border-r border-border/70 px-3 py-2">{children}</div>
    </>
  )
})

export const TaskCanvasLayer = memo(function TaskCanvasLayer({ children }: { children: ReactNode }) {
  return <div className="relative min-w-0 flex-1 bg-muted/15">{children}</div>
})

type TaskLeftPanelContentProps = {
  leftPanelMode: LeftPanelMode
  labelsTab: "layers" | "classes"
  onLabelsTabChange: (tab: "layers" | "classes") => void
  panelShapes: XAnyLabelShape[]
  selectedShapeIndex: number | null
  hoveredShapeIndex: number | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  labelColorMap: Map<string, string>
  project: ProjectItem | undefined
  rawHighlightCorner: { shapeIndex: number; cornerIndex: number } | null
  taskName: string
  activeImagePath: string
  imageNaturalSize: { width: number; height: number }
  imageFileInfo: {
    exists: boolean
    sizeBytes: number
    format: string
    channelCount: number
    extension: string
    errorMessage: string
  }
  formatBytes: (value: number) => string
  formatPosition: (point: number[] | undefined) => string
  renderPositionBox: (
    value: string,
    idx: number,
    shapeIndex: number,
    highlighted: boolean,
    onEnter?: () => void,
    onLeave?: () => void,
  ) => ReactNode
  onSetHoveredShapeIndex: (index: number | null | ((prev: number | null) => number | null)) => void
  onSetSelectedShapeIndex: (index: number | null) => void
  onDeleteShape: (shapeIndex: number) => void
  onToggleShapeVisibility: (shapeIndex: number) => void
  onToggleClassVisibility: (label: string) => void
  onReorderShapeLayer: (shapeIndex: number, mode: "forward" | "backward" | "front" | "back") => void
  onSetRawHighlightCorner: (
    value:
      | { shapeIndex: number; cornerIndex: number }
      | null
      | ((prev: { shapeIndex: number; cornerIndex: number } | null) => { shapeIndex: number; cornerIndex: number } | null),
  ) => void
}

export function TaskLeftPanelContent({
  leftPanelMode,
  labelsTab,
  onLabelsTabChange,
  panelShapes,
  selectedShapeIndex,
  hoveredShapeIndex,
  hiddenShapeIndexes,
  hiddenClassLabels,
  labelColorMap,
  project,
  rawHighlightCorner,
  taskName,
  activeImagePath,
  imageNaturalSize,
  imageFileInfo,
  formatBytes,
  formatPosition,
  renderPositionBox,
  onSetHoveredShapeIndex,
  onSetSelectedShapeIndex,
  onDeleteShape,
  onToggleShapeVisibility,
  onToggleClassVisibility,
  onReorderShapeLayer,
  onSetRawHighlightCorner,
}: TaskLeftPanelContentProps) {
  if (leftPanelMode === "raw") {
    return (
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        <div className="h-full space-y-2 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {panelShapes.length ? (
            panelShapes.map((shape, index) => (
              <div
                key={`${shape.label}-${index}`}
                className={cn(
                  "rounded border p-2 transition-colors",
                  selectedShapeIndex === index
                    ? "border-emerald-400 bg-emerald-500/10"
                    : hoveredShapeIndex === index
                      ? "border-emerald-300/80 bg-emerald-500/5"
                      : "border-border/60 bg-muted/20",
                )}
                onMouseEnter={() => onSetHoveredShapeIndex(index)}
                onMouseLeave={() => onSetHoveredShapeIndex((prev) => (prev === index ? null : prev))}
                onClick={() => onSetSelectedShapeIndex(index)}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
                    <span className="truncate">{shape.label}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="truncate text-muted-foreground">{shape.shape_type}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                      aria-label="删除标注"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteShape(index)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((posIndex) =>
                    renderPositionBox(
                      formatPosition(shape.points[posIndex]),
                      posIndex,
                      index,
                      rawHighlightCorner?.shapeIndex === index && rawHighlightCorner.cornerIndex === posIndex,
                      shape.shape_type === "rotation" ? () => onSetRawHighlightCorner({ shapeIndex: index, cornerIndex: posIndex }) : undefined,
                      shape.shape_type === "rotation"
                        ? () =>
                            onSetRawHighlightCorner((prev) =>
                              prev?.shapeIndex === index && prev.cornerIndex === posIndex ? null : prev,
                            )
                        : undefined,
                    ),
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">当前图片暂无标注。</p>
          )}
        </div>
      </div>
    )
  }

  if (leftPanelMode === "labels") {
    return (
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
        <div className="grid w-full grid-cols-2 rounded-md border border-border/70 bg-muted/40 p-0.5">
          <button
            type="button"
            className={cn(
              "w-full rounded px-2 py-1 text-xs transition-colors",
              labelsTab === "layers" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onLabelsTabChange("layers")}
          >
            layers
          </button>
          <button
            type="button"
            className={cn(
              "w-full rounded px-2 py-1 text-xs transition-colors",
              labelsTab === "classes" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onLabelsTabChange("classes")}
          >
            classes
          </button>
        </div>
        {labelsTab === "layers" ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {panelShapes.length ? (
              panelShapes.map((shape, index) => {
                const isHidden = hiddenShapeIndexes.includes(index)
                const isSelected = selectedShapeIndex === index
                const isHovered = hoveredShapeIndex === index
                const color = labelColorMap.get(shape.label) ?? "#f59e0b"
                const canBringForward = index < panelShapes.length - 1
                const canSendBackward = index > 0
                return (
                  <div
                    key={`layer-${index}`}
                    className={cn(
                      "flex items-center gap-2 rounded border px-2 py-1.5 transition-colors",
                      isSelected
                        ? "border-emerald-400 bg-emerald-500/10"
                        : isHovered
                          ? "border-emerald-300/80 bg-emerald-500/5"
                          : "border-border/60 bg-muted/20",
                      isHidden && "opacity-55",
                    )}
                    onMouseEnter={() => onSetHoveredShapeIndex(index)}
                    onMouseLeave={() => onSetHoveredShapeIndex((prev) => (prev === index ? null : prev))}
                    onClick={() => {
                      if (isHidden) return
                      onSetSelectedShapeIndex(index)
                    }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{shape.label || "-"}</span>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label={isHidden ? "显示标注" : "隐藏标注"}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleShapeVisibility(index)
                      }}
                    >
                      {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                      aria-label="删除标注"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteShape(index)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="图层顺序菜单"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="z-50 min-w-[11rem] overflow-hidden rounded-md border border-border bg-card p-1 text-sm text-card-foreground shadow-md"
                          sideOffset={6}
                          align="end"
                        >
                          <DropdownMenu.Item
                            disabled={!canBringForward}
                            className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                            onSelect={() => onReorderShapeLayer(index, "forward")}
                          >
                            Bring Forward
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            disabled={!canSendBackward}
                            className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                            onSelect={() => onReorderShapeLayer(index, "backward")}
                          >
                            Send Backward
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            disabled={!canBringForward}
                            className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                            onSelect={() => onReorderShapeLayer(index, "front")}
                          >
                            Bring to Front
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            disabled={!canSendBackward}
                            className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-disabled:opacity-40 data-highlighted:bg-accent"
                            onSelect={() => onReorderShapeLayer(index, "back")}
                          >
                            Send to Back
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">当前图片暂无标注。</p>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(project?.tags ?? []).length ? (
              (project?.tags ?? []).map((tag) => {
                const count = panelShapes.filter((shape) => shape.label === tag.name).length
                const classHidden = hiddenClassLabels.includes(tag.name)
                return (
                  <div
                    key={`class-${tag.name}`}
                    className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: normalizeTagColor(tag.color) }} />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{tag.name}</span>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label={classHidden ? "显示该类标注" : "隐藏该类标注"}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleClassVisibility(tag.name)
                      }}
                    >
                      {classHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-[11px] text-muted-foreground">{count}</span>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">当前项目暂无标签类别。</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
      <p className="border-b border-border/70 pb-2 text-sm font-medium text-foreground">Attributes</p>
      <div className="rounded border border-border/70 bg-background/70 p-2 text-xs text-muted-foreground">
        <p className="truncate">
          <span className="text-foreground">路径：</span>
          {activeImagePath || "-"}
        </p>
        <p className="truncate">
          <span className="text-foreground">项目：</span>
          {project?.name || "-"}
        </p>
        <p className="truncate">
          <span className="text-foreground">任务：</span>
          {taskName || "-"}
        </p>
      </div>
      <div className="min-h-0 flex-1 rounded border border-border/70 bg-background/70 p-2 text-xs">
        <div className="h-full space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <p className="text-muted-foreground">
            <span className="text-foreground">尺寸：</span>
            {imageNaturalSize.width > 0 && imageNaturalSize.height > 0 ? `${imageNaturalSize.width} x ${imageNaturalSize.height}` : "-"}
          </p>
          <p className="text-muted-foreground">
            <span className="text-foreground">通道：</span>
            {imageFileInfo.channelCount > 0 ? imageFileInfo.channelCount : "-"}
          </p>
          <p className="text-muted-foreground">
            <span className="text-foreground">格式：</span>
            {imageFileInfo.format || "-"}
          </p>
          <p className="text-muted-foreground">
            <span className="text-foreground">大小：</span>
            {formatBytes(imageFileInfo.sizeBytes)}
          </p>
          <p className="text-muted-foreground">
            <span className="text-foreground">存在：</span>
            {imageFileInfo.exists ? "是" : "否"}
          </p>
          {imageFileInfo.errorMessage ? <p className="text-destructive">读取失败：{imageFileInfo.errorMessage}</p> : null}
        </div>
      </div>
    </div>
  )
}

type TaskDetailHeaderProps = {
  projectId: string | undefined
  taskName: string
  currentFileName: string
  progressText: string
  canGoPrev: boolean
  canGoNext: boolean
  onPrev: () => void
  onNext: () => void
  onDownloadCurrentImage: () => void
  onDeleteCurrentAnnotation: () => void
  onDeleteCurrentImage: () => void
}

export function TaskDetailHeader({
  projectId,
  taskName,
  currentFileName,
  progressText,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  onDownloadCurrentImage,
  onDeleteCurrentAnnotation,
  onDeleteCurrentImage,
}: TaskDetailHeaderProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/80 bg-background px-3 py-2">
      <Button asChild variant="ghost" size="icon" aria-label="返回项目">
        <Link to={`/projects/${projectId}`}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">任务：{taskName}</p>
        <p className="truncate text-xs text-muted-foreground">文件：{currentFileName}</p>
      </div>
      <div className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-sm">
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          onClick={onPrev}
          disabled={!canGoPrev}
          aria-label="上一张"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4rem] text-center text-xs tabular-nums text-muted-foreground">{progressText}</span>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="下一张"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="图片操作"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-card p-1 text-sm text-card-foreground shadow-md"
            sideOffset={6}
            align="end"
          >
            <DropdownMenu.Item
              className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 outline-hidden data-highlighted:bg-accent"
              onSelect={onDownloadCurrentImage}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              下载图片
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-destructive outline-hidden data-highlighted:bg-destructive/10"
              onSelect={onDeleteCurrentAnnotation}
            >
              <FileJson className="h-3.5 w-3.5" aria-hidden />
              删除标注
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex cursor-default select-none items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-destructive outline-hidden data-highlighted:bg-destructive/10"
              onSelect={onDeleteCurrentImage}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              删除图片
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

type TaskToolPaletteProps = {
  rightToolMode: RightToolMode
  onSelectTool: () => void
  onRectTool: () => void
  onRotRectTool: () => void
  onCircleTool: () => void
  onPolygonTool: () => void
  onTextTool: () => void
}

export function TaskToolPalette({
  rightToolMode,
  onSelectTool,
  onRectTool,
  onRotRectTool,
  onCircleTool,
  onPolygonTool,
  onTextTool,
}: TaskToolPaletteProps) {
  return (
    <div className="absolute top-1/2 right-4 z-50 flex -translate-y-1/2 flex-col gap-2 rounded-md border border-border/70 bg-background/95 p-2 shadow-sm">
      <button
        type="button"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          rightToolMode === "select"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label="选中工具"
        onClick={onSelectTool}
        title="选中工具（缩放/移动）"
      >
        <MousePointer2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          rightToolMode === "rect"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label="矩形工具"
        onClick={onRectTool}
      >
        <Square className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          rightToolMode === "rotRect"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label="旋转矩形工具"
        onClick={onRotRectTool}
      >
        <RotateCw className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          rightToolMode === "circle"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label="圆形工具"
        onClick={onCircleTool}
      >
        <Circle className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          rightToolMode === "polygon"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label="多边形工具"
        onClick={onPolygonTool}
      >
        <PenLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md",
          rightToolMode === "text"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label="文本工具"
        onClick={onTextTool}
      >
        <Type className="h-4 w-4" />
      </button>
    </div>
  )
}

type TaskRectLabelPickerProps = {
  rectPickerOpen: boolean
  drawShapeType: "rectangle" | "rotation"
  rectPendingLabel: string
  annotationLabelOptions: string[]
  onRectPendingLabelChange: (nextLabel: string) => void
  onCancel: () => void
  onConfirm: () => void
}

export function TaskRectLabelPicker({
  rectPickerOpen,
  drawShapeType,
  rectPendingLabel,
  annotationLabelOptions,
  onRectPendingLabelChange,
  onCancel,
  onConfirm,
}: TaskRectLabelPickerProps) {
  if (!rectPickerOpen) return null
  return (
    <div className="absolute top-1/2 right-20 z-[60] w-52 -translate-y-1/2 rounded-md border border-border bg-background/95 p-3 shadow-md">
      <p className="mb-2 text-xs text-muted-foreground">{drawShapeType === "rotation" ? "旋转矩形标注标签" : "矩形标注标签"}</p>
      <select
        className="h-8 w-full rounded border border-border bg-background px-2 text-sm"
        value={rectPendingLabel}
        onChange={(event) => onRectPendingLabelChange(event.target.value)}
      >
        {annotationLabelOptions.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="inline-flex h-7 items-center rounded border border-border px-2 text-xs hover:bg-accent"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="inline-flex h-7 items-center rounded border border-emerald-500/40 px-2 text-xs text-emerald-600 hover:bg-emerald-500/10"
          onClick={onConfirm}
        >
          OK
        </button>
      </div>
    </div>
  )
}

type TaskDrawHintProps = {
  rightToolMode: RightToolMode
  drawShapeType: "rectangle" | "rotation"
  rectDrawingEnabled: boolean
  rectFirstPoint: Point | null
}

export function TaskDrawHint({ rightToolMode, drawShapeType, rectDrawingEnabled, rectFirstPoint }: TaskDrawHintProps) {
  if (rightToolMode !== "rect" && rightToolMode !== "rotRect") return null
  return (
    <div className="absolute right-4 bottom-4 z-50 rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
      {drawShapeType === "rotation"
        ? rectDrawingEnabled
          ? rectFirstPoint
            ? "旋转矩形：已记录第一点，点击第二点完成"
            : "旋转矩形：点击第一点开始绘制"
          : "旋转矩形：请选择标签并点击 OK"
        : rectDrawingEnabled
          ? rectFirstPoint
            ? "矩形：已记录第一点，点击第二点完成"
            : "矩形：点击第一点开始绘制"
          : "矩形：请选择标签并点击 OK"}
    </div>
  )
}

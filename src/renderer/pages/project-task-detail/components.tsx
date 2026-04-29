/**
 * 模块：project-task-detail/components
 * 职责：提供任务详情页基础展示组件（Header、左栏内容、提示、选择器、Overlay）。
 * 边界：仅关注 UI 表达与交互透传，不做数据持久化。
 */
import { cn } from "@/lib/utils"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import type { ProjectItem } from "@/lib/projects-api"
import type { XAnyLabelShape } from "@/lib/xanylabeling-format"
import { normalizeTagColor } from "@/pages/project-task-detail/utils"
import { getShapeStableId } from "@/pages/project-task-detail/shape-identity"
import { Button } from "@/components/ui/button"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import {
  ArrowLeft,
  Box,
  Brush,
  ChevronLeft,
  ChevronRight,
  Download,
  Dot,
  Eye,
  EyeOff,
  FileJson,
  MoreHorizontal,
  Pentagon,
  RectangleHorizontal,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
} from "lucide-react"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"
import type { LeftPanelMode, RenderedRectangle } from "@/pages/project-task-detail/types"

type RectangleOverlayItemProps = {
  item: RenderedRectangle
  drawingLayerActive: boolean
  isSelected: boolean
  isHovered: boolean
  onMouseEnter: (shapeId: string) => void
  onMouseLeave: (shapeId: string) => void
  onMouseDown: (shapeId: string, event: MouseEvent<HTMLDivElement>) => void
  onClick: (shapeId: string, event: MouseEvent<HTMLDivElement>) => void
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
        onMouseEnter={() => onMouseEnter(item.shapeId)}
        onMouseLeave={() => onMouseLeave(item.shapeId)}
        onMouseDown={(event) => onMouseDown(item.shapeId, event)}
        onClick={(event) => onClick(item.shapeId, event)}
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
    prev.item.shapeId === next.item.shapeId &&
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
      </div>
      <div className="flex w-72 flex-col border-r border-border/70 px-3 py-2">{children}</div>
    </>
  )
})

export const TaskCanvasLayer = memo(function TaskCanvasLayer({ children }: { children: ReactNode }) {
  return <div className="relative min-w-0 flex-1 bg-muted/15">{children}</div>
})

export type TaskLeftPanelContentProps = {
  leftPanelMode: LeftPanelMode
  labelsTab: "layers" | "classes"
  onLabelsTabChange: (tab: "layers" | "classes") => void
  panelShapes: XAnyLabelShape[]
  selectedShapeId: string | null
  hoveredShapeId: string | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  labelColorMap: Map<string, string>
  project: ProjectItem | undefined
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
  onSetHoveredShapeId: (shapeId: string | null | ((prev: string | null) => string | null)) => void
  onSetSelectedShapeId: (shapeId: string | null) => void
  onDeleteShape: (shapeIndex: number) => void
  onToggleShapeVisibility: (shapeIndex: number) => void
  onToggleClassVisibility: (label: string) => void
  onReorderShapeLayer: (shapeIndex: number, mode: "forward" | "backward" | "front" | "back") => void
}

export function TaskLeftPanelContent({
  leftPanelMode,
  labelsTab,
  onLabelsTabChange,
  panelShapes,
  selectedShapeId,
  hoveredShapeId,
  hiddenShapeIndexes,
  hiddenClassLabels,
  labelColorMap,
  project,
  taskName,
  activeImagePath,
  imageNaturalSize,
  imageFileInfo,
  formatBytes,
  onSetHoveredShapeId,
  onSetSelectedShapeId,
  onDeleteShape,
  onToggleShapeVisibility,
  onToggleClassVisibility,
  onReorderShapeLayer,
}: TaskLeftPanelContentProps) {
  const layersViewportRef = useRef<HTMLDivElement | null>(null)
  const [layersScrollTop, setLayersScrollTop] = useState(0)
  const [layersViewportHeight, setLayersViewportHeight] = useState(0)
  const layerRowHeight = 36
  const layerOverscan = 8
  const shouldVirtualizeLayers = panelShapes.length > 120
  const hiddenShapeSet = useMemo(() => new Set(hiddenShapeIndexes), [hiddenShapeIndexes])
  const hiddenClassSet = useMemo(() => new Set(hiddenClassLabels), [hiddenClassLabels])
  const classShapeCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const shape of panelShapes) {
      map.set(shape.label, (map.get(shape.label) ?? 0) + 1)
    }
    return map
  }, [panelShapes])

  const handleLayersScroll = useCallback((event: MouseEvent<HTMLDivElement>) => {
    setLayersScrollTop(event.currentTarget.scrollTop)
  }, [])

  useEffect(() => {
    if (!shouldVirtualizeLayers) return
    const target = layersViewportRef.current
    if (!target) return
    const updateHeight = () => setLayersViewportHeight(target.clientHeight)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(target)
    return () => observer.disconnect()
  }, [shouldVirtualizeLayers])

  const virtualLayerRange = useMemo(() => {
    if (!shouldVirtualizeLayers) {
      return {
        startIndex: 0,
        endIndex: panelShapes.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      }
    }
    const viewportHeight = layersViewportHeight || 0
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / layerRowHeight))
    const startIndex = Math.max(0, Math.floor(layersScrollTop / layerRowHeight) - layerOverscan)
    const endIndex = Math.min(panelShapes.length, startIndex + visibleCount + layerOverscan * 2)
    const topSpacerHeight = startIndex * layerRowHeight
    const bottomSpacerHeight = Math.max(0, (panelShapes.length - endIndex) * layerRowHeight)
    return { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight }
  }, [layerOverscan, layerRowHeight, layersScrollTop, layersViewportHeight, panelShapes.length, shouldVirtualizeLayers])

  const visibleLayerEntries = useMemo(
    () =>
      panelShapes
        .slice(virtualLayerRange.startIndex, virtualLayerRange.endIndex)
        .map((shape, offset) => ({ shape, index: virtualLayerRange.startIndex + offset })),
    [panelShapes, virtualLayerRange.endIndex, virtualLayerRange.startIndex],
  )

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
          <div
            ref={layersViewportRef}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={shouldVirtualizeLayers ? handleLayersScroll : undefined}
          >
            {panelShapes.length ? (
              <>
                {virtualLayerRange.topSpacerHeight > 0 ? (
                  <div style={{ height: virtualLayerRange.topSpacerHeight }} aria-hidden />
                ) : null}
                {visibleLayerEntries.map(({ shape, index }) => {
                const shapeId = getShapeStableId(shape, index)
                const isHidden = hiddenShapeSet.has(index)
                const isSelected = selectedShapeId === shapeId
                const isHovered = hoveredShapeId === shapeId
                const color = labelColorMap.get(shape.label) ?? "#f59e0b"
                const shapeTypeIcon =
                  shape.shape_type === "rotation" ? (
                    <RectangleHorizontal className="h-3.5 w-3.5 rotate-[20deg]" />
                  ) : shape.shape_type === "polygon" ? (
                    <Pentagon className="h-3.5 w-3.5" />
                  ) : shape.shape_type === "mask" ? (
                    <Brush className="h-3.5 w-3.5" />
                  ) : shape.shape_type === "point" ? (
                    <Dot className="h-3.5 w-3.5" />
                  ) : shape.shape_type === "cuboid2d" ? (
                    <Box className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )
                const canBringForward = index < panelShapes.length - 1
                const canSendBackward = index > 0
                return (
                  <div
                    key={`layer-${getShapeStableId(shape, index)}`}
                    className={cn(
                      "flex items-center gap-2 rounded border px-2 py-1.5 transition-colors",
                      isSelected
                        ? "border-emerald-400 bg-emerald-500/10"
                        : isHovered
                          ? "border-emerald-300/80 bg-emerald-500/5"
                          : "border-border/60 bg-muted/20",
                      isHidden && "opacity-55",
                    )}
                    onMouseEnter={() => onSetHoveredShapeId(shapeId)}
                    onMouseLeave={() => onSetHoveredShapeId((prev) => (prev === shapeId ? null : prev))}
                    onClick={() => {
                      if (isHidden) return
                      onSetSelectedShapeId(shapeId)
                    }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{shape.label || "-"}</span>
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/70 text-muted-foreground">
                      {shapeTypeIcon}
                    </span>
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
                })}
                {virtualLayerRange.bottomSpacerHeight > 0 ? (
                  <div style={{ height: virtualLayerRange.bottomSpacerHeight }} aria-hidden />
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">当前图片暂无标注。</p>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(project?.tags ?? []).length ? (
              (project?.tags ?? []).map((tag) => {
                const count = classShapeCountMap.get(tag.name) ?? 0
                const classHidden = hiddenClassSet.has(tag.name)
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

const RECT_PICKER_PANEL_WIDTH_PX = 208

function getFallbackLabelPickerFixedPos(): { top: number; left: number } {
  if (typeof window === "undefined") return { top: 0, left: 0 }
  return {
    top: window.innerHeight / 2,
    left: window.innerWidth - 8 - RECT_PICKER_PANEL_WIDTH_PX,
  }
}

function computeLabelPickerPosFromAnchorEl(el: HTMLElement): { top: number; left: number } {
  const w = RECT_PICKER_PANEL_WIDTH_PX
  const gap = 8
  const anchor = el.getBoundingClientRect()
  let left = anchor.left - gap - w
  if (left < 8) {
    left = anchor.right + gap
  }
  if (left + w > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - w - 8)
  }
  const top = anchor.top + anchor.height / 2
  return { top, left }
}

export type TaskRectLabelPickerProps = {
  rectPickerOpen: boolean
  drawShapeType: "rectangle" | "rotation" | "polygon" | "mask" | "keypoint" | "box3d" | "skeleton"
  rectPendingLabel: string
  annotationLabelOptions: string[]
  maskDrawMode: "brush" | "eraser"
  maskBrushSize: number
  onRectPendingLabelChange: (nextLabel: string) => void
  onMaskDrawModeChange: (nextMode: "brush" | "eraser") => void
  onMaskBrushSizeChange: (nextSize: number) => void
  onCancel: () => void
  onConfirm: () => void
  /** 提供当前工具按钮 DOM，用于在按钮旁定位弹出框；不传则回退为右侧栏固定位置 */
  getAnchor?: () => HTMLElement | null
}

export function TaskRectLabelPicker({
  rectPickerOpen,
  drawShapeType,
  rectPendingLabel,
  annotationLabelOptions,
  maskDrawMode,
  maskBrushSize,
  onRectPendingLabelChange,
  onMaskDrawModeChange,
  onMaskBrushSizeChange,
  onCancel,
  onConfirm,
  getAnchor,
}: TaskRectLabelPickerProps) {
  const [anchoredPos, setAnchoredPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!rectPickerOpen || !getAnchor) {
      setAnchoredPos(null)
      return
    }
    const run = () => {
      const el = getAnchor()
      if (el) {
        setAnchoredPos(computeLabelPickerPosFromAnchorEl(el))
      } else {
        setAnchoredPos(getFallbackLabelPickerFixedPos())
      }
    }
    run()
    const t0 = window.setTimeout(run, 0)
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => run())
    })
    window.addEventListener("resize", run)
    return () => {
      window.removeEventListener("resize", run)
      window.clearTimeout(t0)
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [rectPickerOpen, getAnchor, drawShapeType])

  if (!rectPickerOpen) return null
  const pickerTitle =
    drawShapeType === "rotation"
      ? "旋转矩形标注标签"
      : drawShapeType === "polygon"
        ? "多边形标注标签"
        : drawShapeType === "mask"
          ? "Mask 标注标签"
          : drawShapeType === "keypoint"
            ? "关键点标注标签"
            : drawShapeType === "box3d"
              ? "3D 框标注标签"
              : drawShapeType === "skeleton"
                ? "骨架标注标签"
                : "矩形标注标签"
  const usePortal = Boolean(getAnchor)
  /** 有祖先 transform 时 fixed 会错参考系，挂到 body 上才能与 getBoundingClientRect 一致；首帧用回退位避免空白 */
  const fixedPos = usePortal ? (anchoredPos ?? getFallbackLabelPickerFixedPos()) : null
  const positionClass = usePortal
    ? "fixed z-[200] w-52 rounded-md border border-border bg-background/95 p-3 shadow-md"
    : "absolute top-1/2 right-20 z-[60] w-52 -translate-y-1/2 rounded-md border border-border bg-background/95 p-3 shadow-md"
  const positionStyle: CSSProperties | undefined =
    usePortal && fixedPos
      ? { top: fixedPos.top, left: fixedPos.left, transform: "translateY(-50%)" }
      : undefined

  const panel = (
    <div className={positionClass} style={positionStyle}>
      <p className="mb-2 text-xs text-muted-foreground">{pickerTitle}</p>
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
      {drawShapeType === "mask" ? (
        <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center justify-center rounded border text-xs",
                maskDrawMode === "brush"
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
              onClick={() => onMaskDrawModeChange("brush")}
            >
              笔刷
            </button>
            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center justify-center rounded border text-xs",
                maskDrawMode === "eraser"
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
              onClick={() => onMaskDrawModeChange("eraser")}
            >
              橡皮擦
            </button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>笔刷大小</span>
              <span>{maskBrushSize}px</span>
            </div>
            <input
              type="range"
              min={4}
              max={96}
              step={1}
              value={maskBrushSize}
              className="w-full accent-emerald-500"
              onChange={(event) => onMaskBrushSizeChange(Number(event.target.value))}
            />
          </div>
        </div>
      ) : null}
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

  if (usePortal) {
    return createPortal(panel, document.body)
  }
  return panel
}

export type TaskDrawHintProps = {
  rightToolMode: RightToolMode
  drawShapeType: "rectangle" | "rotation" | "polygon" | "mask" | "keypoint" | "box3d" | "skeleton"
  rectDrawingEnabled: boolean
  rectFirstPoint: Point | null
  polygonDraftPointCount: number
  maskDrawMode: "brush" | "eraser"
  /** 3D 框：已点下前矩形第一角，等待第二角 */
  box3dAwaitingSecondClick?: boolean
}

export function TaskDrawHint({
  rightToolMode,
  drawShapeType,
  rectDrawingEnabled,
  rectFirstPoint,
  polygonDraftPointCount,
  maskDrawMode,
  box3dAwaitingSecondClick = false,
}: TaskDrawHintProps) {
  if (
    rightToolMode !== "rect" &&
    rightToolMode !== "rotRect" &&
    rightToolMode !== "polygon" &&
    rightToolMode !== "mask" &&
    rightToolMode !== "keypoint" &&
    rightToolMode !== "box3d" &&
    rightToolMode !== "skeleton"
  )
    return null
  if (drawShapeType === "skeleton" || rightToolMode === "skeleton") {
    return (
      <div className="absolute right-4 bottom-4 z-50 rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        {!rectDrawingEnabled ? "骨架：请选择标签并点击 OK" : "骨架：在图像上单击一次按模板落点，再拖关节微调"}
      </div>
    )
  }
  if (drawShapeType === "keypoint" || rightToolMode === "keypoint") {
    return (
      <div className="absolute right-4 bottom-4 z-50 rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        {!rectDrawingEnabled ? "关键点：请选择标签并点击 OK" : "关键点：在图像上单击一次即完成该点标注"}
      </div>
    )
  }
  if (drawShapeType === "box3d" || rightToolMode === "box3d") {
    const body = !rectDrawingEnabled
      ? "3D 框：请选择标签并点击 OK"
      : box3dAwaitingSecondClick
        ? "3D 框：移动预览，再点击确定前面矩形的另一对角"
        : "3D 框：第一次点击矩形一角，第二次点击另一对角完成前面并生成后面"
    return (
      <div className="absolute right-4 bottom-4 z-50 max-w-sm rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        {body}
      </div>
    )
  }
  if (drawShapeType === "mask") {
    return (
      <div className="absolute right-4 bottom-4 z-50 rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        {!rectDrawingEnabled
          ? "Mask：请选择标签并点击 OK"
          : maskDrawMode === "brush"
            ? "Mask：按住左键涂抹绘制"
            : "Mask：按住左键擦除已有 Mask"}
      </div>
    )
  }
  if (drawShapeType === "polygon") {
    return (
      <div className="absolute right-4 bottom-4 z-50 rounded border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        {!rectDrawingEnabled
          ? "多边形：请选择标签并点击 OK"
          : polygonDraftPointCount < 3
            ? `多边形：已添加 ${polygonDraftPointCount} 个点，继续点击添加顶点`
            : "多边形：双击完成，或点击起点闭合"}
      </div>
    )
  }
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

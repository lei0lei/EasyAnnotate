/**
 * 模块：project-task-detail/annotateTools/use-skeleton-tool
 * 职责：骨架：选标签后首次单击按项目模板摆好关节，可再拖点调整；数据为 `shape_type: "skeleton"`。
 */
import type { ProjectTag } from "@/lib/projects-api"
import { buildSkeletonInstanceAttributes, isSkeletonProjectTag, placeSkeletonImagePoints } from "@/lib/skeleton-template"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { CanvasShapeCreatedEvent } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import { roundPointToInt } from "@/pages/project-task-detail/utils"
import { useCallback, useMemo, type MouseEvent, type MutableRefObject } from "react"

type UseSkeletonToolParams = {
  rightToolMode: RightToolMode
  rectDrawingEnabled: boolean
  imageGeometry: ImageGeometry | null
  activeImagePath: string
  isImageLoading: boolean
  imageLoadError: boolean
  imageNaturalSize: { width: number; height: number }
  rectPendingLabel: string
  projectTags: ProjectTag[] | undefined
  stageRef: MutableRefObject<HTMLDivElement | null>
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageStrictWithGeometry: (point: Point, geometry: ImageGeometry) => Point | null
  createShape: (params: {
    imagePath: string
    imageWidth: number
    imageHeight: number
    shape: XAnyLabelFile["shapes"][number]
  }) => { shapeIndex: number; shapeId: string }
  onShapeCreated?: (event: CanvasShapeCreatedEvent) => void
  onSkeletonCommitted: () => void
}

function clientEventToImagePoint(
  event: MouseEvent<HTMLDivElement>,
  getGeometry: () => ImageGeometry | null,
  stageRef: MutableRefObject<HTMLDivElement | null>,
  toImage: (point: Point, geometry: ImageGeometry) => Point | null,
): Point | null {
  const geometry = getGeometry()
  const rect = stageRef.current?.getBoundingClientRect()
  if (!geometry || !rect) return null
  return toImage({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
}

function resolveSkeletonTemplateForLabel(tags: ProjectTag[] | undefined, label: string) {
  if (!tags?.length) return null
  const t = tags.find((x) => x.name === label)
  if (!t || !isSkeletonProjectTag(t)) return null
  if (t.skeletonTemplate.points.length < 1) return null
  return t.skeletonTemplate
}

export function useSkeletonTool(params: UseSkeletonToolParams) {
  const template = useMemo(
    () => resolveSkeletonTemplateForLabel(params.projectTags, params.rectPendingLabel),
    [params.projectTags, params.rectPendingLabel],
  )

  const canDrawSkeleton =
    params.rightToolMode === "skeleton" &&
    params.rectDrawingEnabled &&
    !!params.imageGeometry &&
    !!params.activeImagePath &&
    !params.isImageLoading &&
    !params.imageLoadError &&
    template != null

  const handleSkeletonDrawClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawSkeleton || !template) return
      const img = clientEventToImagePoint(
        event,
        params.getCurrentImageGeometry,
        params.stageRef,
        params.stageToImageStrictWithGeometry,
      )
      if (!img) return
      const click = roundPointToInt(img)
      const w = params.imageNaturalSize.width
      const h = params.imageNaturalSize.height
      const points = placeSkeletonImagePoints(template, click, w, h)
      if (points.length < 1) return
      const skAttrs = buildSkeletonInstanceAttributes(template)
      const created = params.createShape({
        imagePath: params.activeImagePath,
        imageWidth: w,
        imageHeight: h,
        shape: {
          label: params.rectPendingLabel,
          score: null,
          points,
          group_id: null,
          description: null,
          difficult: false,
          shape_type: "skeleton",
          flags: null,
          attributes: { skeleton: skAttrs.skeleton } as Record<string, unknown>,
          kie_linking: [],
        },
      })
      params.onShapeCreated?.({
        shapeId: created.shapeId,
        shapeType: "skeleton",
        source: "draw",
      })
      params.onSkeletonCommitted()
    },
    [
      canDrawSkeleton,
      template,
      params.activeImagePath,
      params.createShape,
      params.getCurrentImageGeometry,
      params.imageNaturalSize.height,
      params.imageNaturalSize.width,
      params.onShapeCreated,
      params.onSkeletonCommitted,
      params.rectPendingLabel,
      params.stageRef,
      params.stageToImageStrictWithGeometry,
    ],
  )

  return { canDrawSkeleton, handleSkeletonDrawClick }
}

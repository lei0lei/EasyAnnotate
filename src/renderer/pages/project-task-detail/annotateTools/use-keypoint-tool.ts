/**
 * 模块：project-task-detail/annotateTools/use-keypoint-tool
 * 职责：关键点：选标签后单击图像落点，单点即完成；数据为 X-Any `shape_type: "point"`。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { CanvasShapeCreatedEvent } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import { roundPointToInt } from "@/pages/project-task-detail/utils"
import { useCallback, type MouseEvent, type MutableRefObject } from "react"

type UseKeypointToolParams = {
  rightToolMode: RightToolMode
  rectDrawingEnabled: boolean
  imageGeometry: ImageGeometry | null
  activeImagePath: string
  isImageLoading: boolean
  imageLoadError: boolean
  imageNaturalSize: { width: number; height: number }
  rectPendingLabel: string
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
  onKeypointCommitted: () => void
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

export function useKeypointTool(params: UseKeypointToolParams) {
  const canDrawKeypoint =
    params.rightToolMode === "keypoint" &&
    params.rectDrawingEnabled &&
    !!params.imageGeometry &&
    !!params.activeImagePath &&
    !params.isImageLoading &&
    !params.imageLoadError

  const handleKeypointDrawClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawKeypoint) return
      const img = clientEventToImagePoint(
        event,
        params.getCurrentImageGeometry,
        params.stageRef,
        params.stageToImageStrictWithGeometry,
      )
      if (!img) return
      const p = roundPointToInt(img)
      const created = params.createShape({
        imagePath: params.activeImagePath,
        imageWidth: params.imageNaturalSize.width,
        imageHeight: params.imageNaturalSize.height,
        shape: {
          label: params.rectPendingLabel,
          score: null,
          points: [[p.x, p.y]],
          group_id: null,
          description: null,
          difficult: false,
          shape_type: "point",
          flags: null,
          attributes: {},
          kie_linking: [],
        },
      })
      params.onShapeCreated?.({
        shapeId: created.shapeId,
        shapeType: "point",
        source: "draw",
      })
      params.onKeypointCommitted()
    },
    [
      canDrawKeypoint,
      params.activeImagePath,
      params.createShape,
      params.getCurrentImageGeometry,
      params.imageNaturalSize.height,
      params.imageNaturalSize.width,
      params.onKeypointCommitted,
      params.onShapeCreated,
      params.rectPendingLabel,
      params.stageRef,
      params.stageToImageStrictWithGeometry,
    ],
  )

  return { canDrawKeypoint, handleKeypointDrawClick }
}

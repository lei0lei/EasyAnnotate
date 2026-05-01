/**
 * 模块：project-task-detail/annotateTools/use-box3d-tool
 * 职责：3D 框（cuboid2d）：确认 OK 后十字光标，两点击画前面轴对齐矩形，自动生成斜后方后面，提交为 quad_pair_8pt。
 * 边界：仅管理绘制态与预览；几何见同目录 cuboid2d-geometry，编辑交互见 interaction-ops / 画布引擎。
 */
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import {
  aabbRectCornersFromDiagonal,
  backFacePointsFromFront,
  CUBOID2D_MIN_FRONT_PX,
  parallelepiped8ImagePointsFromFront,
} from "@/pages/project-task-detail/annotateTools/cuboid2d-geometry"
import type { CanvasShapeCreatedEvent } from "@/pages/project-task-detail/use-task-canvas-engine"
import type { Point, RightToolMode } from "@/pages/project-task-detail/types"
import { roundPointToInt } from "@/pages/project-task-detail/utils"
import { useCallback, useEffect, useMemo, useState, type MutableRefObject, type MouseEvent } from "react"

type UseBox3dToolParams = {
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
  imageToStage: (point: Point) => Point | null
  createShape: (params: {
    imagePath: string
    imageWidth: number
    imageHeight: number
    shape: XAnyLabelFile["shapes"][number]
  }) => { shapeIndex: number; shapeId: string }
  onShapeCreated?: (event: CanvasShapeCreatedEvent) => void
  onDefaultCuboidPlaced?: (shapeId: string) => void
  onCuboidCommitted: () => void
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

export function useBox3dTool(params: UseBox3dToolParams) {
  const canDrawBox3d =
    params.rightToolMode === "box3d" &&
    params.rectDrawingEnabled &&
    !!params.imageGeometry &&
    !!params.activeImagePath &&
    !params.isImageLoading &&
    !params.imageLoadError

  const [firstCornerImage, setFirstCornerImage] = useState<Point | null>(null)
  const [hoverImage, setHoverImage] = useState<Point | null>(null)

  useEffect(() => {
    if (!params.rectDrawingEnabled || params.rightToolMode !== "box3d") {
      setFirstCornerImage(null)
      setHoverImage(null)
    }
  }, [params.rectDrawingEnabled, params.rightToolMode])

  const clearBox3dDraft = useCallback(() => {
    setFirstCornerImage(null)
    setHoverImage(null)
  }, [])

  const draftFrontImage = useMemo(() => {
    if (!canDrawBox3d || !firstCornerImage) return [] as Point[]
    const h = hoverImage ?? firstCornerImage
    return aabbRectCornersFromDiagonal(firstCornerImage, h)
  }, [canDrawBox3d, firstCornerImage, hoverImage])

  const box3dDraftBaseStagePoints = useMemo(() => {
    return draftFrontImage.map((p) => params.imageToStage(p)).filter((p): p is Point => !!p)
  }, [draftFrontImage, params.imageToStage])

  const box3dPreviewTopStagePoints = useMemo(() => {
    if (draftFrontImage.length < 4) return [] as Point[]
    return backFacePointsFromFront(draftFrontImage)
      .map((p) => params.imageToStage(p))
      .filter((p): p is Point => !!p)
  }, [draftFrontImage, params.imageToStage])

  const handleBox3dDrawMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawBox3d || !firstCornerImage) return
      const img = clientEventToImagePoint(event, params.getCurrentImageGeometry, params.stageRef, params.stageToImageStrictWithGeometry)
      if (!img) return
      setHoverImage(roundPointToInt(img))
    },
    [canDrawBox3d, firstCornerImage, params.getCurrentImageGeometry, params.stageRef, params.stageToImageStrictWithGeometry],
  )

  const handleBox3dDrawClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!canDrawBox3d) return
      const img = clientEventToImagePoint(event, params.getCurrentImageGeometry, params.stageRef, params.stageToImageStrictWithGeometry)
      if (!img) return
      const p = roundPointToInt(img)
      if (!firstCornerImage) {
        setFirstCornerImage(p)
        setHoverImage(p)
        return
      }
      const minX = Math.min(firstCornerImage.x, p.x)
      const maxX = Math.max(firstCornerImage.x, p.x)
      const minY = Math.min(firstCornerImage.y, p.y)
      const maxY = Math.max(firstCornerImage.y, p.y)
      if (maxX - minX < CUBOID2D_MIN_FRONT_PX || maxY - minY < CUBOID2D_MIN_FRONT_PX) {
        setFirstCornerImage(null)
        setHoverImage(null)
        return
      }
      const front = aabbRectCornersFromDiagonal(firstCornerImage, p)
      const pts = parallelepiped8ImagePointsFromFront(front)
      const created = params.createShape({
        imagePath: params.activeImagePath,
        imageWidth: params.imageNaturalSize.width,
        imageHeight: params.imageNaturalSize.height,
        shape: {
          label: params.rectPendingLabel,
          score: null,
          points: pts,
          group_id: null,
          description: null,
          difficult: false,
          shape_type: "cuboid2d",
          flags: null,
          attributes: { cuboid_format: "quad_pair_8pt" },
          kie_linking: [],
        },
      })
      params.onShapeCreated?.({
        shapeId: created.shapeId,
        shapeType: "cuboid2d",
        source: "draw",
      })
      params.onDefaultCuboidPlaced?.(created.shapeId)
      params.onCuboidCommitted()
      setFirstCornerImage(null)
      setHoverImage(null)
    },
    [
      canDrawBox3d,
      firstCornerImage,
      params.activeImagePath,
      params.createShape,
      params.getCurrentImageGeometry,
      params.imageNaturalSize.height,
      params.imageNaturalSize.width,
      params.onCuboidCommitted,
      params.onDefaultCuboidPlaced,
      params.onShapeCreated,
      params.rectPendingLabel,
      params.stageRef,
      params.stageToImageStrictWithGeometry,
    ],
  )

  return {
    canDrawBox3d,
    box3dAwaitingSecondClick: !!firstCornerImage,
    box3dDraftBaseStagePoints,
    box3dPreviewTopStagePoints,
    handleBox3dDrawMove,
    handleBox3dDrawClick,
    clearBox3dDraft,
  }
}

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react"
import { buildImageGeometry, imageToStagePoint, stageToImagePoint, stageToImagePointStrict } from "@/pages/project-task-detail/canvas-geometry"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { Point } from "@/pages/project-task-detail/types"
import type { ImageSize, StageElementRef } from "@/pages/project-task-detail/hook-shared"

type UseTaskCanvasGeometryStateParams = {
  imageNaturalSize: ImageSize
  stageSize: { width: number; height: number }
  stageRef: StageElementRef
  imageScale: number
  imageOffset: { x: number; y: number }
  imageObjectUrl: string
  isImageLoading: boolean
  imageLoadError: boolean
  setImageOffset: (value: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void
  setImageScale: (updater: (prev: number) => number) => void
  setIsPanning: (value: boolean) => void
  panStartRef: MutableRefObject<{ x: number; y: number; originX: number; originY: number } | null>
}

export function useTaskCanvasGeometryState(params: UseTaskCanvasGeometryStateParams) {
  const {
    imageNaturalSize,
    stageSize,
    stageRef,
    imageScale,
    imageOffset,
    imageObjectUrl,
    isImageLoading,
    imageLoadError,
    setImageOffset,
    setImageScale,
    setIsPanning,
    panStartRef,
  } = params

  const imageGeometry = useMemo(() => buildImageGeometry(imageNaturalSize, stageSize), [imageNaturalSize, stageSize])
  const previousImageGeometryRef = useRef<ImageGeometry | null>(null)
  const previousStageSizeRef = useRef<{ width: number; height: number } | null>(null)

  const getCurrentImageGeometry = useCallback(() => {
    const stageRect = stageRef.current?.getBoundingClientRect()
    const stageW = stageRect?.width ?? stageSize.width
    const stageH = stageRect?.height ?? stageSize.height
    return buildImageGeometry(imageNaturalSize, { width: stageW, height: stageH })
  }, [imageNaturalSize, stageRef, stageSize.height, stageSize.width])

  const stageToImageWithGeometry = useCallback(
    (stagePoint: Point, geometry: ImageGeometry): Point =>
      stageToImagePoint(stagePoint, geometry, { scale: imageScale, offset: imageOffset }, imageNaturalSize),
    [imageNaturalSize, imageOffset, imageScale],
  )

  const stageToImageStrictWithGeometry = useCallback(
    (stagePoint: Point, geometry: ImageGeometry): Point | null =>
      stageToImagePointStrict(stagePoint, geometry, { scale: imageScale, offset: imageOffset }, imageNaturalSize),
    [imageNaturalSize, imageOffset, imageScale],
  )

  const imageToStage = useCallback(
    (point: Point): Point | null => {
      if (!imageGeometry) return null
      return imageToStagePoint(point, imageGeometry, { scale: imageScale, offset: imageOffset })
    },
    [imageGeometry, imageOffset, imageScale],
  )

  /** 仅含 object-fit 适配，不含用户缩放/平移；与画布外层 CSS transform 组合后与 imageToStage 一致 */
  const imageToStageBase = useCallback(
    (point: Point): Point | null => {
      if (!imageGeometry) return null
      return imageToStagePoint(point, imageGeometry, { scale: 1, offset: { x: 0, y: 0 } })
    },
    [imageGeometry],
  )

  useEffect(() => {
    const next = imageGeometry
    const prev = previousImageGeometryRef.current
    if (!next) {
      previousImageGeometryRef.current = null
      return
    }
    if (!prev) {
      previousImageGeometryRef.current = next
      return
    }
    if (prev.stageWidth === next.stageWidth && prev.stageHeight === next.stageHeight) {
      previousImageGeometryRef.current = next
      return
    }
    const prevCenterX = prev.baseLeft + prev.baseWidth / 2
    const prevCenterY = prev.baseTop + prev.baseHeight / 2
    const nextCenterX = next.baseLeft + next.baseWidth / 2
    const nextCenterY = next.baseTop + next.baseHeight / 2
    const deltaX = prevCenterX - nextCenterX
    const deltaY = prevCenterY - nextCenterY
    setImageOffset((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }))
    previousImageGeometryRef.current = next
  }, [imageGeometry, setImageOffset])

  useEffect(() => {
    const prev = previousStageSizeRef.current
    previousStageSizeRef.current = stageSize
    if (!prev) return
    if (prev.width === stageSize.width && prev.height === stageSize.height) return
    if (!imageObjectUrl || isImageLoading || imageLoadError) return
    setImageScale(() => 1)
    setImageOffset({ x: 0, y: 0 })
    setIsPanning(false)
    panStartRef.current = null
  }, [imageLoadError, imageObjectUrl, isImageLoading, panStartRef, setImageOffset, setImageScale, setIsPanning, stageSize])

  return {
    imageGeometry,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    stageToImageStrictWithGeometry,
    imageToStage,
    imageToStageBase,
  }
}

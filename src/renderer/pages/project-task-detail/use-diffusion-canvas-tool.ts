/**
 * 扩散式标注：种子矩形框拖拽（全图坐标）。
 */
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { Point } from "@/pages/project-task-detail/types"
import { roundPointToInt } from "@/pages/project-task-detail/utils"
import type { DiffusionSeedBbox } from "@/lib/diffusion-annotation-runtime"
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type MutableRefObject } from "react"

type PreviewRect = {
  left: number
  top: number
  width: number
  height: number
  clippedLeft: boolean
  clippedTop: boolean
  clippedRight: boolean
  clippedBottom: boolean
}

function clientToImage(
  event: MouseEvent<Element>,
  stageRef: MutableRefObject<HTMLDivElement | null>,
  getGeometry: () => ImageGeometry | null,
  toImage: (p: Point, g: ImageGeometry) => Point | null,
): Point | null {
  const geometry = getGeometry()
  const rect = stageRef.current?.getBoundingClientRect()
  if (!geometry || !rect) return null
  return toImage({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
}

function imageBboxToPreviewRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  imageGeometry: ImageGeometry,
  imageToStage: (point: Point) => Point | null,
): PreviewRect | null {
  const p1 = imageToStage({ x: x1, y: y1 })
  const p2 = imageToStage({ x: x2, y: y2 })
  if (!p1 || !p2) return null
  const left = Math.min(p1.x, p2.x)
  const top = Math.min(p1.y, p2.y)
  const width = Math.abs(p1.x - p2.x)
  const height = Math.abs(p1.y - p2.y)
  const stageW = imageGeometry.stageWidth ?? 0
  const stageH = imageGeometry.stageHeight ?? 0
  const right = left + width
  const bottom = top + height
  const clippedLeft = stageW > 0 ? Math.max(0, left) : left
  const clippedTop = stageH > 0 ? Math.max(0, top) : top
  const clippedRight = stageW > 0 ? Math.min(stageW, right) : right
  const clippedBottom = stageH > 0 ? Math.min(stageH, bottom) : bottom
  return {
    left: clippedLeft,
    top: clippedTop,
    width: Math.max(0, clippedRight - clippedLeft),
    height: Math.max(0, clippedBottom - clippedTop),
    clippedLeft: clippedLeft > left,
    clippedTop: clippedTop > top,
    clippedRight: clippedRight < right,
    clippedBottom: clippedBottom < bottom,
  }
}

export type UseDiffusionCanvasToolParams = {
  diffusionAnnotatingActive: boolean
  diffusionPhase: "seed" | "searching" | "preview"
  activeImagePath: string
  imageReady: boolean
  imageGeometry: ImageGeometry | null
  stageRef: MutableRefObject<HTMLDivElement | null>
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageStrictWithGeometry: (p: Point, g: ImageGeometry) => Point | null
  imageToStageForBbox: (point: Point) => Point | null
  labelColor: string
  sessionNonce: number
  committedSeedBbox: DiffusionSeedBbox | null
  onCommittedSeedBboxChange: (bbox: DiffusionSeedBbox | null) => void
}

export function useDiffusionCanvasTool(params: UseDiffusionCanvasToolParams) {
  const {
    diffusionAnnotatingActive,
    diffusionPhase,
    activeImagePath,
    imageReady,
    imageGeometry,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStageForBbox,
    labelColor,
    sessionNonce,
    committedSeedBbox,
    onCommittedSeedBboxChange,
  } = params

  const [rectAnchor, setRectAnchor] = useState<Point | null>(null)
  const [rectHover, setRectHover] = useState<Point | null>(null)

  useEffect(() => {
    setRectAnchor(null)
    setRectHover(null)
  }, [activeImagePath, sessionNonce, diffusionAnnotatingActive])

  /** 仅 seed 阶段可拖拽画框 */
  const diffusionOverlayActive = diffusionAnnotatingActive && imageReady && diffusionPhase === "seed"

  /** 手动种子框：画完后直至新建标注或退出工具前一直显示（含 searching / preview） */
  const diffusionSeedRect = useMemo((): PreviewRect | null => {
    if (!diffusionAnnotatingActive || !imageReady || !imageGeometry) return null
    if (diffusionPhase === "seed" && rectAnchor && rectHover) {
      const x1 = Math.min(rectAnchor.x, rectHover.x)
      const x2 = Math.max(rectAnchor.x, rectHover.x)
      const y1 = Math.min(rectAnchor.y, rectHover.y)
      const y2 = Math.max(rectAnchor.y, rectHover.y)
      return imageBboxToPreviewRect(x1, y1, x2, y2, imageGeometry, imageToStageForBbox)
    }
    if (committedSeedBbox) {
      return imageBboxToPreviewRect(
        committedSeedBbox.x1,
        committedSeedBbox.y1,
        committedSeedBbox.x2,
        committedSeedBbox.y2,
        imageGeometry,
        imageToStageForBbox,
      )
    }
    return null
  }, [
    committedSeedBbox,
    diffusionAnnotatingActive,
    diffusionPhase,
    imageGeometry,
    imageReady,
    imageToStageForBbox,
    rectAnchor,
    rectHover,
  ])

  const diffusionSeedRectCommitted = committedSeedBbox != null && !(diffusionPhase === "seed" && rectAnchor != null)

  const hasSeedBbox = committedSeedBbox != null

  const handleDiffusionOverlayClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!diffusionOverlayActive || diffusionPhase !== "seed" || !imageReady || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const img = clientToImage(event, stageRef, getCurrentImageGeometry, stageToImageStrictWithGeometry)
      if (!img) return
      const p = roundPointToInt(img)

      if (!rectAnchor) {
        onCommittedSeedBboxChange(null)
        setRectAnchor(p)
        return
      }
      const minX = Math.min(rectAnchor.x, p.x)
      const maxX = Math.max(rectAnchor.x, p.x)
      const minY = Math.min(rectAnchor.y, p.y)
      const maxY = Math.max(rectAnchor.y, p.y)
      if (maxX - minX < 2 || maxY - minY < 2) {
        setRectAnchor(null)
        setRectHover(null)
        return
      }
      onCommittedSeedBboxChange({ x1: minX, y1: minY, x2: maxX, y2: maxY })
      setRectAnchor(null)
      setRectHover(null)
    },
    [
      diffusionOverlayActive,
      diffusionPhase,
      getCurrentImageGeometry,
      imageReady,
      onCommittedSeedBboxChange,
      rectAnchor,
      stageRef,
      stageToImageStrictWithGeometry,
    ],
  )

  const handleDiffusionOverlayMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!diffusionOverlayActive || diffusionPhase !== "seed" || !imageReady) return
      const img = clientToImage(event, stageRef, getCurrentImageGeometry, stageToImageStrictWithGeometry)
      if (!img) return
      if (rectAnchor) setRectHover(roundPointToInt(img))
    },
    [diffusionOverlayActive, diffusionPhase, getCurrentImageGeometry, imageReady, rectAnchor, stageRef, stageToImageStrictWithGeometry],
  )

  const handleDiffusionOverlayMouseLeave = useCallback(() => {
    if (rectAnchor) setRectHover(null)
  }, [rectAnchor])

  return {
    diffusionOverlayActive,
    diffusionSeedRect,
    diffusionSeedRectCommitted,
    diffusionSeedColor: labelColor,
    hasSeedBbox,
    handleDiffusionOverlayClick,
    handleDiffusionOverlayMouseMove,
    handleDiffusionOverlayMouseLeave,
  }
}

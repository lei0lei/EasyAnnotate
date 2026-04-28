import { useEffect } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { computeRectangleDragPoints, computeRotationDragPoints, computeRotationTransformPoints } from "@/pages/project-task-detail/interaction-ops"
import type { Point, RotationDragAction, RotationTransformAction, ShapeDragAction } from "@/pages/project-task-detail/types"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { AnnotationDocRef, ImageSize, RawHighlightCorner, StageElementRef } from "@/pages/project-task-detail/hook-shared"

type UseDragSessionsParams = {
  shapeDragAction: ShapeDragAction | null
  rotationDragAction: RotationDragAction | null
  rotationTransformAction: RotationTransformAction | null
  imageNaturalSize: ImageSize
  annotationDocRef: AnnotationDocRef
  stageRef: StageElementRef
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageWithGeometry: (stagePoint: Point, geometry: ImageGeometry) => Point
  updateShapePoints: (shapeIndex: number, points: number[][], shouldPersist: boolean) => void
  persistAnnotation: (nextDoc: XAnyLabelFile) => void
  setShapeDragAction: (value: ShapeDragAction | null) => void
  setRotationDragAction: (value: RotationDragAction | null) => void
  setRotationTransformAction: (value: RotationTransformAction | null) => void
  setRawHighlightCorner: (value: RawHighlightCorner) => void
}

export function useDragSessions(params: UseDragSessionsParams) {
  const {
    shapeDragAction,
    rotationDragAction,
    rotationTransformAction,
    imageNaturalSize,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    updateShapePoints,
    persistAnnotation,
    setShapeDragAction,
    setRotationDragAction,
    setRotationTransformAction,
    setRawHighlightCorner,
  } = params

  useEffect(() => {
    if (!shapeDragAction) return
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const processDragFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const point = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const nextPoints = computeRectangleDragPoints(shapeDragAction, point, imageNaturalSize)
      if (!nextPoints) return
      updateShapePoints(shapeDragAction.shapeIndex, nextPoints, false)
    }

    const onMouseMove = (event: MouseEvent) => {
      latestPointer = { clientX: event.clientX, clientY: event.clientY }
      if (rafId === 0) rafId = window.requestAnimationFrame(processDragFrame)
    }
    const onMouseUp = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      const doc = annotationDocRef.current
      if (!doc) {
        setShapeDragAction(null)
        return
      }
      persistAnnotation(doc)
      setShapeDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [annotationDocRef, getCurrentImageGeometry, imageNaturalSize, persistAnnotation, setShapeDragAction, shapeDragAction, stageRef, stageToImageWithGeometry, updateShapePoints])

  useEffect(() => {
    if (!rotationDragAction) return
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const processRotateFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const pt = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const nextPoints = computeRotationDragPoints(rotationDragAction, pt)
      updateShapePoints(rotationDragAction.shapeIndex, nextPoints, false)
    }

    const onMouseMove = (event: MouseEvent) => {
      latestPointer = { clientX: event.clientX, clientY: event.clientY }
      if (rafId === 0) rafId = window.requestAnimationFrame(processRotateFrame)
    }
    const onMouseUp = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      const doc = annotationDocRef.current
      if (doc) persistAnnotation(doc)
      setRotationDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [annotationDocRef, getCurrentImageGeometry, persistAnnotation, rotationDragAction, setRotationDragAction, stageRef, stageToImageWithGeometry, updateShapePoints])

  useEffect(() => {
    if (!rotationTransformAction) return
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const processFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const pt = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const nextPoints = computeRotationTransformPoints(rotationTransformAction, pt)
      updateShapePoints(rotationTransformAction.shapeIndex, nextPoints, false)
    }

    const onMouseMove = (event: MouseEvent) => {
      latestPointer = { clientX: event.clientX, clientY: event.clientY }
      if (rafId === 0) rafId = window.requestAnimationFrame(processFrame)
    }
    const onMouseUp = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      const doc = annotationDocRef.current
      if (doc) persistAnnotation(doc)
      setRotationTransformAction(null)
      setRawHighlightCorner(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [annotationDocRef, getCurrentImageGeometry, persistAnnotation, rotationTransformAction, setRawHighlightCorner, setRotationTransformAction, stageRef, stageToImageWithGeometry, updateShapePoints])
}

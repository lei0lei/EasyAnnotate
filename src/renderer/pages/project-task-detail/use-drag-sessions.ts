/**
 * 模块：project-task-detail/use-drag-sessions
 * 职责：管理拖拽会话生命周期，执行过程更新并在结束时提交。
 * 边界：专注拖拽会话，不负责工具切换与面板状态。
 */
import { useEffect } from "react"
import {
  computeCuboidHandleDragPoints,
  computePolygonDragPoints,
  computePolygonVertexDragPoints,
  computeRectangleDragPoints,
  computeRotationDragPoints,
  computeRotationTransformPoints,
  computeSkeletonGroupDragPoints,
  computeSkeletonVertexDragPoints,
} from "@/pages/project-task-detail/interaction-ops"
import type {
  Point,
} from "@/pages/project-task-detail/types"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { AnnotationDocRef, ImageSize, RawHighlightCorner, StageElementRef } from "@/pages/project-task-detail/hook-shared"
import type { DragSessionController } from "@/pages/project-task-detail/use-task-canvas-engine"

type UseDragSessionsParams = {
  dragSession: DragSessionController
  imageNaturalSize: ImageSize
  annotationDocRef: AnnotationDocRef
  stageRef: StageElementRef
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageWithGeometry: (stagePoint: Point, geometry: ImageGeometry) => Point
  updateShapePoints: (shapeIndex: number, points: number[][], shouldPersist: boolean) => void
  setRawHighlightCorner: (value: RawHighlightCorner) => void
}

export function useDragSessions(params: UseDragSessionsParams) {
  const {
    dragSession,
    imageNaturalSize,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    updateShapePoints,
    setRawHighlightCorner,
  } = params

  useEffect(() => {
    const shapeDragAction = dragSession.shapeDragAction
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
      dragSession.setShapeDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [dragSession, getCurrentImageGeometry, imageNaturalSize, stageRef, stageToImageWithGeometry, updateShapePoints])

  useEffect(() => {
    const polygonDragAction = dragSession.polygonDragAction
    if (!polygonDragAction) return
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
      const point = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[polygonDragAction.shapeIndex]
      const nextPoints =
        shape?.shape_type === "skeleton"
          ? computeSkeletonGroupDragPoints(polygonDragAction, point, imageNaturalSize)
          : computePolygonDragPoints(polygonDragAction, point, imageNaturalSize)
      if (!nextPoints) return
      updateShapePoints(polygonDragAction.shapeIndex, nextPoints, false)
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
      dragSession.setPolygonDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [
    annotationDocRef,
    getCurrentImageGeometry,
    imageNaturalSize,
    dragSession,
    stageRef,
    stageToImageWithGeometry,
    updateShapePoints,
  ])

  useEffect(() => {
    const rotationDragAction = dragSession.rotationDragAction
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
      dragSession.setRotationDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [dragSession, getCurrentImageGeometry, stageRef, stageToImageWithGeometry, updateShapePoints])

  useEffect(() => {
    const polygonVertexDragAction = dragSession.polygonVertexDragAction
    if (!polygonVertexDragAction) return
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
      const point = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const currentDoc = annotationDocRef.current
      const shape = currentDoc?.shapes[polygonVertexDragAction.shapeIndex]
      if (!shape) return
      let nextPoints: number[][] | null = null
      if (shape.shape_type === "polygon") {
        nextPoints = computePolygonVertexDragPoints(polygonVertexDragAction, point, shape.points, imageNaturalSize)
      } else if (shape.shape_type === "skeleton") {
        nextPoints = computeSkeletonVertexDragPoints(polygonVertexDragAction, point, shape.points, imageNaturalSize)
      } else if (shape.shape_type === "cuboid2d" && shape.points.length >= 8) {
        const basis =
          polygonVertexDragAction.cuboidVertexStartSnapshot ??
          shape.points.map((p) => [Number(p[0] ?? 0), Number(p[1] ?? 0)])
        nextPoints = computeCuboidHandleDragPoints(polygonVertexDragAction, point, basis, imageNaturalSize)
      }
      if (!nextPoints) return
      updateShapePoints(polygonVertexDragAction.shapeIndex, nextPoints, false)
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
      dragSession.setPolygonVertexDragAction(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [
    getCurrentImageGeometry,
    imageNaturalSize,
    dragSession,
    stageRef,
    stageToImageWithGeometry,
    updateShapePoints,
  ])

  useEffect(() => {
    const rotationTransformAction = dragSession.rotationTransformAction
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
      dragSession.setRotationTransformAction(null)
      setRawHighlightCorner(null)
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [dragSession, annotationDocRef, getCurrentImageGeometry, setRawHighlightCorner, stageRef, stageToImageWithGeometry, updateShapePoints])
}

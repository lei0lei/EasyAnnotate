/**
 * 模块：project-task-detail/use-drag-sessions
 * 职责：管理拖拽会话生命周期，执行过程更新并在结束时提交。
 * 边界：专注拖拽会话，不负责工具切换与面板状态。
 */
import { useEffect, useRef } from "react"
import {
  decodeRowMajorRleToBinary,
  encodeBinaryToRowMajorRle,
  foregroundBBoxInclusive,
  readMaskRle,
  translateBinaryMask,
} from "@/lib/mask-raster-rle"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { isDragSessionActive } from "@/pages/project-task-detail/drag-session-utils"
import type { DragStageNudge } from "@/pages/project-task-detail/page-sections"
import { getShapeStableId } from "@/pages/project-task-detail/shape-identity"
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
import type { DragLiveMaskRleOverride, DragLivePointsOverride, DragVertexLiveOverride } from "@/pages/project-task-detail/rendered-shapes"
import type { Point } from "@/pages/project-task-detail/types"
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
  updateMaskRle: (
    shapeIndex: number,
    payload: { counts: number[]; w: number; h: number; brushSize: number },
    shouldPersist: boolean,
  ) => void
  setRawHighlightCorner: (value: RawHighlightCorner) => void
  setDragLivePoints: (value: DragLivePointsOverride | null) => void
  setDragCuboidLivePoints: (value: DragLivePointsOverride | null) => void
  setDragVertexLive: (value: DragVertexLiveOverride | null) => void
  setDragLiveMaskRle: (value: DragLiveMaskRleOverride | null) => void
  setDragStageNudge: (value: DragStageNudge | null) => void
  /** 图像坐标系下的平移向量 → stage 像素位移（用于 CSS/SVG translate，避免每帧重建 rendered*） */
  projectImageDeltaToStage: (dix: number, diy: number) => { dx: number; dy: number }
}

type MaskRleDragSnap = {
  shapeIndex: number
  startX: number
  startY: number
  data: Uint8Array
  w: number
  h: number
  brushSize: number
}

type PendingDragFlush =
  | { kind: "points"; shapeIndex: number; points: number[][] }
  | { kind: "mask"; shapeIndex: number; counts: number[]; w: number; h: number; brushSize: number }

function shapeStableIdFromDoc(doc: XAnyLabelFile | null | undefined, index: number): string | null {
  const s = doc?.shapes[index]
  return s ? getShapeStableId(s, index) : null
}

function dragCuboidLiveCacheKey(override: DragLivePointsOverride): string {
  return `${override.shapeIndex}:${override.points.map((r) => `${r[0]},${r[1]}`).join("|")}`
}

export function useDragSessions(params: UseDragSessionsParams) {
  /** 避免 effect 因 doc/callback 依赖反复执行时从「已平移后的图」重新解码，再用全量 dx 平移导致位移叠加 */
  const maskRleDragSnapshotRef = useRef<MaskRleDragSnap | null>(null)
  const pendingDragFlushRef = useRef<PendingDragFlush | null>(null)
  /** 与上一帧 cuboid 预览相同则跳过 setState，减少 React 提交 */
  const dragCuboidLiveKeyRef = useRef<string | null>(null)
  const {
    dragSession,
    imageNaturalSize,
    annotationDocRef,
    stageRef,
    getCurrentImageGeometry,
    stageToImageWithGeometry,
    updateShapePoints,
    updateMaskRle,
    setRawHighlightCorner,
    setDragLivePoints,
    setDragCuboidLivePoints,
    setDragVertexLive,
    setDragLiveMaskRle,
    setDragStageNudge,
    projectImageDeltaToStage,
  } = params

  const {
    shapeDragAction,
    setShapeDragAction,
    polygonDragAction,
    setPolygonDragAction,
    polygonVertexDragAction,
    setPolygonVertexDragAction,
    rotationDragAction,
    setRotationDragAction,
    rotationTransformAction,
    setRotationTransformAction,
  } = dragSession

  useEffect(() => {
    if (
      !isDragSessionActive({
        shapeDragAction,
        polygonDragAction,
        polygonVertexDragAction,
        rotationDragAction,
        rotationTransformAction,
      })
    ) {
      pendingDragFlushRef.current = null
      dragCuboidLiveKeyRef.current = null
      setDragLivePoints(null)
      setDragCuboidLivePoints(null)
      setDragVertexLive(null)
      setDragLiveMaskRle(null)
      setDragStageNudge(null)
    }
  }, [
    polygonDragAction,
    polygonVertexDragAction,
    rotationDragAction,
    rotationTransformAction,
    setDragLiveMaskRle,
    setDragCuboidLivePoints,
    setDragLivePoints,
    setDragVertexLive,
    setDragStageNudge,
    shapeDragAction,
  ])

  useEffect(() => {
    if (!shapeDragAction) {
      maskRleDragSnapshotRef.current = null
      return
    }
    pendingDragFlushRef.current = null
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const shape0 = annotationDocRef.current?.shapes[shapeDragAction.shapeIndex]
    if (shapeDragAction.kind === "move" && shape0?.shape_type === "mask") {
      const rle = readMaskRle(shape0.attributes)
      if (rle && rle.w === imageNaturalSize.width && rle.h === imageNaturalSize.height) {
        const cur = maskRleDragSnapshotRef.current
        const needInit =
          !cur ||
          cur.shapeIndex !== shapeDragAction.shapeIndex ||
          cur.startX !== shapeDragAction.start.x ||
          cur.startY !== shapeDragAction.start.y
        if (needInit) {
          const data = decodeRowMajorRleToBinary(rle.counts, rle.w * rle.h)
          const brushSize =
            typeof shape0.attributes?.brushSize === "number"
              ? Math.max(1, Number(shape0.attributes.brushSize))
              : typeof shape0.attributes?.maskBrushSize === "number"
                ? Math.max(1, Number(shape0.attributes.maskBrushSize))
                : 16
          maskRleDragSnapshotRef.current = {
            shapeIndex: shapeDragAction.shapeIndex,
            startX: shapeDragAction.start.x,
            startY: shapeDragAction.start.y,
            data,
            w: rle.w,
            h: rle.h,
            brushSize,
          }
        }
      } else {
        maskRleDragSnapshotRef.current = null
      }
    } else {
      maskRleDragSnapshotRef.current = null
    }

    const applyShapeDragAtPointer = (pointer: { clientX: number; clientY: number }) => {
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const point = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const snap = maskRleDragSnapshotRef.current
      if (snap && shapeDragAction.kind === "move" && snap.shapeIndex === shapeDragAction.shapeIndex) {
        const dx = Math.round(point.x - shapeDragAction.start.x)
        const dy = Math.round(point.y - shapeDragAction.start.y)
        const bbox = foregroundBBoxInclusive(snap.data, snap.w, snap.h)
        if (!bbox) return
        const clampedDx = Math.max(-bbox.minX, Math.min(imageNaturalSize.width - 1 - bbox.maxX, dx))
        const clampedDy = Math.max(-bbox.minY, Math.min(imageNaturalSize.height - 1 - bbox.maxY, dy))
        const moved = translateBinaryMask(snap.data, snap.w, snap.h, clampedDx, clampedDy)
        const counts = encodeBinaryToRowMajorRle(moved)
        pendingDragFlushRef.current = {
          kind: "mask",
          shapeIndex: shapeDragAction.shapeIndex,
          counts,
          w: snap.w,
          h: snap.h,
          brushSize: snap.brushSize,
        }
        const sid = shapeStableIdFromDoc(annotationDocRef.current, shapeDragAction.shapeIndex)
        const { dx: stageDx, dy: stageDy } = projectImageDeltaToStage(clampedDx, clampedDy)
        if (sid) setDragStageNudge({ shapeId: sid, dx: stageDx, dy: stageDy })
        else setDragStageNudge(null)
        setDragLiveMaskRle(null)
        setDragLivePoints(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
        return
      }
      const nextPoints = computeRectangleDragPoints(shapeDragAction, point, imageNaturalSize)
      if (!nextPoints) return
      pendingDragFlushRef.current = { kind: "points", shapeIndex: shapeDragAction.shapeIndex, points: nextPoints }
      if (shapeDragAction.kind === "move") {
        const sid = shapeStableIdFromDoc(annotationDocRef.current, shapeDragAction.shapeIndex)
        const orig = shapeDragAction.originalPoints
        if (sid && orig.length > 0 && nextPoints.length > 0) {
          const o0 = orig[0]!
          const n0 = nextPoints[0]!
          const { dx, dy } = projectImageDeltaToStage(n0[0]! - o0[0]!, n0[1]! - o0[1]!)
          setDragStageNudge({ shapeId: sid, dx, dy })
        } else setDragStageNudge(null)
        setDragLivePoints(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
        setDragLiveMaskRle(null)
      } else {
        setDragStageNudge(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
        setDragLivePoints({ shapeIndex: shapeDragAction.shapeIndex, points: nextPoints })
        setDragLiveMaskRle(null)
      }
    }

    const processDragFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      applyShapeDragAtPointer(pointer)
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
      if (latestPointer) {
        applyShapeDragAtPointer(latestPointer)
        latestPointer = null
      }
      const pending = pendingDragFlushRef.current
      pendingDragFlushRef.current = null
      if (pending?.kind === "mask") {
        updateMaskRle(pending.shapeIndex, { counts: pending.counts, w: pending.w, h: pending.h, brushSize: pending.brushSize }, false)
      } else if (pending?.kind === "points") {
        updateShapePoints(pending.shapeIndex, pending.points, false)
      }
      setDragLivePoints(null)
      dragCuboidLiveKeyRef.current = null
      setDragCuboidLivePoints(null)
      setDragLiveMaskRle(null)
      setDragStageNudge(null)
      setShapeDragAction(null)
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
    projectImageDeltaToStage,
    setDragCuboidLivePoints,
    setDragLiveMaskRle,
    setDragLivePoints,
    setDragStageNudge,
    setShapeDragAction,
    shapeDragAction,
    stageRef,
    stageToImageWithGeometry,
    updateMaskRle,
    updateShapePoints,
  ])

  useEffect(() => {
    if (!polygonDragAction) return
    pendingDragFlushRef.current = null
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const applyAtPointer = (pointer: { clientX: number; clientY: number }) => {
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
      pendingDragFlushRef.current = { kind: "points", shapeIndex: polygonDragAction.shapeIndex, points: nextPoints }
      const sid = shapeStableIdFromDoc(annotationDocRef.current, polygonDragAction.shapeIndex)
      const orig = polygonDragAction.originalPoints
      const cuboidBackOnly =
        shape?.shape_type === "cuboid2d" &&
        polygonDragAction.cuboidDragSubset === "back" &&
        nextPoints.length >= 8
      if (cuboidBackOnly) {
        setDragStageNudge(null)
        setDragLivePoints(null)
        const cuboidOverride: DragLivePointsOverride = {
          shapeIndex: polygonDragAction.shapeIndex,
          points: nextPoints,
        }
        const ck = dragCuboidLiveCacheKey(cuboidOverride)
        if (dragCuboidLiveKeyRef.current !== ck) {
          dragCuboidLiveKeyRef.current = ck
          setDragCuboidLivePoints(cuboidOverride)
        }
      } else if (sid && orig.length > 0 && nextPoints.length > 0) {
        const o0 = orig[0]!
        const n0 = nextPoints[0]!
        const { dx, dy } = projectImageDeltaToStage(n0[0]! - o0[0]!, n0[1]! - o0[1]!)
        setDragStageNudge({ shapeId: sid, dx, dy })
        setDragLivePoints(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
      } else {
        setDragStageNudge(null)
        setDragLivePoints(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
      }
      setDragLiveMaskRle(null)
    }

    const processFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      applyAtPointer(pointer)
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
      if (latestPointer) {
        applyAtPointer(latestPointer)
        latestPointer = null
      }
      const pending = pendingDragFlushRef.current
      pendingDragFlushRef.current = null
      if (pending?.kind === "points") {
        updateShapePoints(pending.shapeIndex, pending.points, false)
      }
      setDragLivePoints(null)
      dragCuboidLiveKeyRef.current = null
      setDragCuboidLivePoints(null)
      setDragLiveMaskRle(null)
      setDragStageNudge(null)
      setPolygonDragAction(null)
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
    polygonDragAction,
    projectImageDeltaToStage,
    setDragCuboidLivePoints,
    setDragLiveMaskRle,
    setDragLivePoints,
    setDragStageNudge,
    setPolygonDragAction,
    stageRef,
    stageToImageWithGeometry,
    updateShapePoints,
  ])

  useEffect(() => {
    if (!rotationDragAction) return
    pendingDragFlushRef.current = null
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const applyAtPointer = (pointer: { clientX: number; clientY: number }) => {
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const pt = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const nextPoints = computeRotationDragPoints(rotationDragAction, pt)
      pendingDragFlushRef.current = { kind: "points", shapeIndex: rotationDragAction.shapeIndex, points: nextPoints }
      setDragStageNudge(null)
      dragCuboidLiveKeyRef.current = null
      setDragCuboidLivePoints(null)
      setDragLivePoints({ shapeIndex: rotationDragAction.shapeIndex, points: nextPoints })
      setDragLiveMaskRle(null)
    }

    const processRotateFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      applyAtPointer(pointer)
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
      if (latestPointer) {
        applyAtPointer(latestPointer)
        latestPointer = null
      }
      const pending = pendingDragFlushRef.current
      pendingDragFlushRef.current = null
      if (pending?.kind === "points") {
        updateShapePoints(pending.shapeIndex, pending.points, false)
      }
      setDragLivePoints(null)
      dragCuboidLiveKeyRef.current = null
      setDragCuboidLivePoints(null)
      setDragLiveMaskRle(null)
      setDragStageNudge(null)
      setRotationDragAction(null)
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
    rotationDragAction,
    setDragCuboidLivePoints,
    setDragLiveMaskRle,
    setDragLivePoints,
    setDragStageNudge,
    setRotationDragAction,
    stageRef,
    stageToImageWithGeometry,
    updateShapePoints,
  ])

  useEffect(() => {
    if (!polygonVertexDragAction) return
    pendingDragFlushRef.current = null
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const applyAtPointer = (pointer: { clientX: number; clientY: number }) => {
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
      pendingDragFlushRef.current = { kind: "points", shapeIndex: polygonVertexDragAction.shapeIndex, points: nextPoints }
      setDragStageNudge(null)
      if (shape.shape_type === "cuboid2d" && shape.points.length >= 8) {
        setDragVertexLive(null)
        setDragLivePoints(null)
        const cuboidOverride: DragLivePointsOverride = {
          shapeIndex: polygonVertexDragAction.shapeIndex,
          points: nextPoints,
        }
        const ck = dragCuboidLiveCacheKey(cuboidOverride)
        if (dragCuboidLiveKeyRef.current !== ck) {
          dragCuboidLiveKeyRef.current = ck
          setDragCuboidLivePoints(cuboidOverride)
        }
      } else {
        setDragLivePoints(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
        const vi = polygonVertexDragAction.vertexIndex
        const row = nextPoints[vi]
        if (row) {
          setDragVertexLive({
            shapeIndex: polygonVertexDragAction.shapeIndex,
            vertexIndex: vi,
            imageX: Number(row[0] ?? 0),
            imageY: Number(row[1] ?? 0),
          })
        } else setDragVertexLive(null)
      }
      setDragLiveMaskRle(null)
    }

    const processFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      applyAtPointer(pointer)
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
      if (latestPointer) {
        applyAtPointer(latestPointer)
        latestPointer = null
      }
      const pending = pendingDragFlushRef.current
      pendingDragFlushRef.current = null
      if (pending?.kind === "points") {
        updateShapePoints(pending.shapeIndex, pending.points, false)
      }
      setDragLivePoints(null)
      dragCuboidLiveKeyRef.current = null
      setDragCuboidLivePoints(null)
      setDragVertexLive(null)
      setDragLiveMaskRle(null)
      setDragStageNudge(null)
      setPolygonVertexDragAction(null)
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
    polygonVertexDragAction,
    setDragCuboidLivePoints,
    setDragLiveMaskRle,
    setDragLivePoints,
    setDragVertexLive,
    setDragStageNudge,
    setPolygonVertexDragAction,
    stageRef,
    stageToImageWithGeometry,
    updateShapePoints,
  ])

  useEffect(() => {
    if (!rotationTransformAction) return
    pendingDragFlushRef.current = null
    let rafId = 0
    let latestPointer: { clientX: number; clientY: number } | null = null

    const applyAtPointer = (pointer: { clientX: number; clientY: number }) => {
      const geometry = getCurrentImageGeometry()
      const rect = stageRef.current?.getBoundingClientRect()
      if (!geometry || !rect) return
      const pt = stageToImageWithGeometry({ x: pointer.clientX - rect.left, y: pointer.clientY - rect.top }, geometry)
      const nextPoints = computeRotationTransformPoints(rotationTransformAction, pt)
      pendingDragFlushRef.current = { kind: "points", shapeIndex: rotationTransformAction.shapeIndex, points: nextPoints }
      if (rotationTransformAction.kind === "move") {
        const sid = shapeStableIdFromDoc(annotationDocRef.current, rotationTransformAction.shapeIndex)
        const orig = rotationTransformAction.originalPoints
        if (sid && orig.length > 0 && nextPoints.length > 0) {
          const o0 = orig[0]!
          const n0 = nextPoints[0]!
          const { dx, dy } = projectImageDeltaToStage(n0[0]! - o0[0]!, n0[1]! - o0[1]!)
          setDragStageNudge({ shapeId: sid, dx, dy })
        } else setDragStageNudge(null)
        setDragLivePoints(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
        setDragLiveMaskRle(null)
      } else {
        setDragStageNudge(null)
        dragCuboidLiveKeyRef.current = null
        setDragCuboidLivePoints(null)
        setDragLivePoints({ shapeIndex: rotationTransformAction.shapeIndex, points: nextPoints })
        setDragLiveMaskRle(null)
      }
    }

    const processFrame = () => {
      rafId = 0
      if (!latestPointer) return
      const pointer = latestPointer
      latestPointer = null
      applyAtPointer(pointer)
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
      if (latestPointer) {
        applyAtPointer(latestPointer)
        latestPointer = null
      }
      const pending = pendingDragFlushRef.current
      pendingDragFlushRef.current = null
      if (pending?.kind === "points") {
        updateShapePoints(pending.shapeIndex, pending.points, false)
      }
      setDragLivePoints(null)
      dragCuboidLiveKeyRef.current = null
      setDragCuboidLivePoints(null)
      setDragLiveMaskRle(null)
      setDragStageNudge(null)
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
  }, [
    annotationDocRef,
    getCurrentImageGeometry,
    projectImageDeltaToStage,
    rotationTransformAction,
    setDragCuboidLivePoints,
    setDragLiveMaskRle,
    setDragLivePoints,
    setDragStageNudge,
    setRawHighlightCorner,
    setRotationTransformAction,
    stageRef,
    stageToImageWithGeometry,
    updateShapePoints,
  ])
}

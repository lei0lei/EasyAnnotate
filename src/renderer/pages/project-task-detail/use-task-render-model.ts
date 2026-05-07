/**
 * 模块：project-task-detail/use-task-render-model
 * 职责：集中计算画布渲染与侧栏消费的派生模型（rendered shapes / selected shape / panel shapes）。
 * 边界：只读输入状态并返回派生结果，不处理交互与持久化。
 */
import { useMemo } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import {
  buildRenderedCuboids2d,
  buildRenderedMasks,
  buildRenderedPoints,
  buildRenderedPolygons,
  buildRenderedRectangles,
  buildRenderedRotationRects,
  buildRenderedSkeletons,
  type DragLiveMaskRleOverride,
  type DragLivePointsOverride,
  type DragVertexLiveOverride,
} from "@/pages/project-task-detail/rendered-shapes"
import type { ProjectTag } from "@/lib/projects-api"
import type { Point } from "@/pages/project-task-detail/types"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"

type UseTaskRenderModelParams = {
  annotationDoc: XAnyLabelFile | null
  panelDoc: XAnyLabelFile | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  selectedShapeId: string | null
  labelColorMap: Map<string, string>
  projectTags?: ProjectTag[]
  imageGeometry: ImageGeometry | null
  /** 与画布 view 层一致：仅 fit，用户平移/缩放在 page-sections 外层 transform */
  imageToStageBase: (point: Point) => Point | null
  dragLivePoints: DragLivePointsOverride | null
  /** cuboid2d 八点预览：与 dragLivePoints 分离，避免每帧重算矩形/多边形/mask 等 */
  dragCuboidLivePoints: DragLivePointsOverride | null
  /** 单顶点拖拽：与 dragLivePoints 互斥使用，且仅驱动 polygon / skeleton / cuboid 的 memo */
  dragVertexLive: DragVertexLiveOverride | null
  dragLiveMaskRle: DragLiveMaskRleOverride | null
}

export function useTaskRenderModel(params: UseTaskRenderModelParams) {
  const {
    annotationDoc,
    panelDoc,
    hiddenShapeIndexes,
    hiddenClassLabels,
    selectedShapeId,
    labelColorMap,
    projectTags,
    imageGeometry,
    imageToStageBase,
    dragLivePoints,
    dragCuboidLivePoints,
    dragVertexLive,
    dragLiveMaskRle,
  } = params

  const renderedRectangles = useMemo(() => {
    return buildRenderedRectangles({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStageBase(point),
      stageWidth: imageGeometry?.stageWidth ?? 0,
      stageHeight: imageGeometry?.stageHeight ?? 0,
      dragLivePoints,
    })
  }, [annotationDoc, dragLivePoints, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageToStageBase, labelColorMap])

  const renderedRotationRects = useMemo(() => {
    return buildRenderedRotationRects({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStageBase(point),
      dragLivePoints,
    })
  }, [annotationDoc, dragLivePoints, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageToStageBase, labelColorMap])

  const renderedPolygons = useMemo(() => {
    return buildRenderedPolygons({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStageBase(point),
      dragLivePoints,
      dragVertexLive,
    })
  }, [annotationDoc, dragLivePoints, dragVertexLive, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageToStageBase, labelColorMap])

  const renderedMasks = useMemo(() => {
    return buildRenderedMasks({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      stageScale: 1,
      imageToStage: (point) => imageToStageBase(point),
      dragLiveMaskRle,
      dragLivePoints,
    })
  }, [annotationDoc, dragLiveMaskRle, dragLivePoints, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageToStageBase, labelColorMap])

  const renderedCuboids2d = useMemo(() => {
    return buildRenderedCuboids2d({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStageBase(point),
      dragLivePoints,
      dragCuboidLivePoints,
      dragVertexLive,
    })
  }, [
    annotationDoc,
    dragCuboidLivePoints,
    dragLivePoints,
    dragVertexLive,
    hiddenClassLabels,
    hiddenShapeIndexes,
    imageGeometry,
    imageToStageBase,
    labelColorMap,
  ])

  const renderedPoints = useMemo(() => {
    return buildRenderedPoints({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStageBase(point),
      dragLivePoints,
    })
  }, [annotationDoc, dragLivePoints, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageToStageBase, labelColorMap])

  const renderedSkeletons = useMemo(() => {
    return buildRenderedSkeletons({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      projectTags,
      imageToStage: (point) => imageToStageBase(point),
      dragLivePoints,
      dragVertexLive,
    })
  }, [annotationDoc, dragLivePoints, dragVertexLive, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageToStageBase, labelColorMap, projectTags])

  const selectedRect = selectedShapeId === null ? null : renderedRectangles.find((item) => item.shapeId === selectedShapeId) ?? null
  const selectedRotationRect =
    selectedShapeId === null ? null : renderedRotationRects.find((item) => item.shapeId === selectedShapeId) ?? null
  const selectedPolygon = selectedShapeId === null ? null : renderedPolygons.find((item) => item.shapeId === selectedShapeId) ?? null
  const selectedCuboid2d = selectedShapeId === null ? null : renderedCuboids2d.find((item) => item.shapeId === selectedShapeId) ?? null
  const selectedPoint = selectedShapeId === null ? null : renderedPoints.find((item) => item.shapeId === selectedShapeId) ?? null
  const panelShapes = panelDoc?.shapes ?? []

  return {
    renderedRectangles,
    renderedRotationRects,
    renderedPolygons,
    renderedMasks,
    renderedCuboids2d,
    renderedPoints,
    renderedSkeletons,
    selectedRect,
    selectedRotationRect,
    selectedPolygon,
    selectedCuboid2d,
    selectedPoint,
    panelShapes,
  }
}

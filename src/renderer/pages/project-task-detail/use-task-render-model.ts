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
} from "@/pages/project-task-detail/rendered-shapes"
import type { Point } from "@/pages/project-task-detail/types"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"

type UseTaskRenderModelParams = {
  annotationDoc: XAnyLabelFile | null
  panelDoc: XAnyLabelFile | null
  hiddenShapeIndexes: number[]
  hiddenClassLabels: string[]
  selectedShapeId: string | null
  labelColorMap: Map<string, string>
  imageGeometry: ImageGeometry | null
  imageOffset: { x: number; y: number }
  imageScale: number
  imageToStage: (point: Point) => Point | null
}

export function useTaskRenderModel(params: UseTaskRenderModelParams) {
  const {
    annotationDoc,
    panelDoc,
    hiddenShapeIndexes,
    hiddenClassLabels,
    selectedShapeId,
    labelColorMap,
    imageGeometry,
    imageOffset,
    imageScale,
    imageToStage,
  } = params

  const renderedRectangles = useMemo(() => {
    return buildRenderedRectangles({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
      stageWidth: imageGeometry?.stageWidth ?? 0,
      stageHeight: imageGeometry?.stageHeight ?? 0,
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, labelColorMap])

  const renderedRotationRects = useMemo(() => {
    return buildRenderedRotationRects({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, labelColorMap])

  const renderedPolygons = useMemo(() => {
    return buildRenderedPolygons({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, labelColorMap])

  const renderedMasks = useMemo(() => {
    return buildRenderedMasks({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      stageScale: imageScale,
      imageToStage: (point) => imageToStage(point),
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, labelColorMap])

  const renderedCuboids2d = useMemo(() => {
    return buildRenderedCuboids2d({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, labelColorMap])

  const renderedPoints = useMemo(() => {
    return buildRenderedPoints({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, labelColorMap])

  const renderedSkeletons = useMemo(() => {
    return buildRenderedSkeletons({
      annotationDoc,
      hiddenShapeIndexes,
      hiddenClassLabels,
      labelColorMap,
      imageToStage: (point) => imageToStage(point),
    })
  }, [annotationDoc, hiddenClassLabels, hiddenShapeIndexes, imageGeometry, imageOffset.x, imageOffset.y, imageScale, imageToStage, labelColorMap])

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

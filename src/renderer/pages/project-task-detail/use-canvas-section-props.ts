import { useMemo } from "react"
import type { ProjectTaskCanvasSectionProps } from "@/pages/project-task-detail/page-sections"

type CanvasSectionBaseProps = Omit<ProjectTaskCanvasSectionProps, "toolPaletteProps" | "drawHintProps">

type UseCanvasSectionPropsParams = {
  stageRef: CanvasSectionBaseProps["stageRef"]
  handleImageWheel: CanvasSectionBaseProps["onStageWheel"]
  handleImageMouseDown: CanvasSectionBaseProps["onStageMouseDown"]
  handleImageMouseMove: CanvasSectionBaseProps["onStageMouseMove"]
  endImagePan: () => void
  handleImageDoubleClick: CanvasSectionBaseProps["onStageDoubleClick"]
  handleStageClick: CanvasSectionBaseProps["onStageClick"]
  setImageLoadError: (value: boolean) => void
  handleImageElementLoad: CanvasSectionBaseProps["onImageLoad"]
  setRawHighlightCorner: CanvasSectionBaseProps["onSetRawHighlightCorner"]
  setSelectedShape: CanvasSectionBaseProps["onSetSelectedShapeId"]
  handleRectangleMouseEnter: CanvasSectionBaseProps["onHandleRectangleMouseEnter"]
  handleRectangleMouseLeave: CanvasSectionBaseProps["onHandleRectangleMouseLeave"]
  handleRectangleMouseDown: CanvasSectionBaseProps["onHandleRectangleMouseDown"]
  handleRectangleClick: CanvasSectionBaseProps["onHandleRectangleClick"]
  handleMaskMouseDown: CanvasSectionBaseProps["onHandleMaskMouseDown"]
  handlePointMouseDown: CanvasSectionBaseProps["onHandlePointMouseDown"]
  handlePolygonMouseDown: CanvasSectionBaseProps["onHandlePolygonMouseDown"]
  handleCuboidFaceMouseDown: CanvasSectionBaseProps["onHandleCuboidFaceMouseDown"]
  handleRotationPolygonMouseDown: CanvasSectionBaseProps["onHandleRotationPolygonMouseDown"]
  handleRotationHandleMouseDown: CanvasSectionBaseProps["onHandleRotationHandleMouseDown"]
  handleRotationCornerMouseDown: CanvasSectionBaseProps["onHandleRotationCornerMouseDown"]
  handlePolygonVertexMouseDown: CanvasSectionBaseProps["onHandlePolygonVertexMouseDown"]
  handleRectResizeMouseDown: CanvasSectionBaseProps["onHandleRectResizeMouseDown"]
  previewRect: CanvasSectionBaseProps["previewRect"]
  polygonDraftStagePoints: CanvasSectionBaseProps["polygonDraftStagePoints"]
  hoveredDraftVertexIndex: CanvasSectionBaseProps["hoveredDraftVertexIndex"]
  maskDraftStagePoints: CanvasSectionBaseProps["maskDraftStagePoints"]
  maskCursorStagePoint: CanvasSectionBaseProps["maskCursorStagePoint"]
  maskBrushSize: CanvasSectionBaseProps["maskBrushSize"]
  maskDrawMode: "brush" | "eraser"
  createMaskDraft: CanvasSectionBaseProps["onCreateMaskDraft"]
  appendMaskDraftPoint: CanvasSectionBaseProps["onAppendMaskDraftPoint"]
  commitMaskStroke: CanvasSectionBaseProps["onCommitMaskStroke"]
  clearMaskTransientState: CanvasSectionBaseProps["onClearMaskTransientState"]
  handlePolygonDrawMove: CanvasSectionBaseProps["onHandlePolygonDrawMove"]
  handlePolygonDrawClick: CanvasSectionBaseProps["onHandlePolygonDrawClick"]
  handlePolygonDrawDoubleClick: CanvasSectionBaseProps["onHandlePolygonDrawDoubleClick"]
  handleRectDrawMove: CanvasSectionBaseProps["onHandleRectDrawMove"]
  handleRectDrawClick: CanvasSectionBaseProps["onHandleRectDrawClick"]
  handleBox3dDrawMove: CanvasSectionBaseProps["onHandleBox3dDrawMove"]
  handleBox3dDrawClick: CanvasSectionBaseProps["onHandleBox3dDrawClick"]
  handleKeypointDrawClick: CanvasSectionBaseProps["onHandleKeypointDrawClick"]
  handleSkeletonDrawClick: CanvasSectionBaseProps["onHandleSkeletonDrawClick"]
  box3dDraftBaseStagePoints: CanvasSectionBaseProps["box3dDraftBaseStagePoints"]
  box3dPreviewTopStagePoints: CanvasSectionBaseProps["box3dPreviewTopStagePoints"]
  error: CanvasSectionBaseProps["error"]
  filesLength: CanvasSectionBaseProps["filesLength"]
  isImageLoading: CanvasSectionBaseProps["isImageLoading"]
  imageObjectUrl: CanvasSectionBaseProps["imageObjectUrl"]
  imageLoadError: CanvasSectionBaseProps["imageLoadError"]
  currentFileName: CanvasSectionBaseProps["currentFileName"]
  canPanAndZoom: CanvasSectionBaseProps["canPanAndZoom"]
  isPanning: CanvasSectionBaseProps["isPanning"]
  canDrawMask: CanvasSectionBaseProps["canDrawMask"]
  canDrawRectangle: CanvasSectionBaseProps["canDrawRectangle"]
  canDrawPolygon: CanvasSectionBaseProps["canDrawPolygon"]
  canDrawBox3d: CanvasSectionBaseProps["canDrawBox3d"]
  canDrawKeypoint: CanvasSectionBaseProps["canDrawKeypoint"]
  canDrawSkeleton: CanvasSectionBaseProps["canDrawSkeleton"]
  imageOffset: CanvasSectionBaseProps["imageOffset"]
  imageScale: CanvasSectionBaseProps["imageScale"]
  drawingLayerActive: CanvasSectionBaseProps["drawingLayerActive"]
  renderedMasks: CanvasSectionBaseProps["renderedMasks"]
  renderedPolygons: CanvasSectionBaseProps["renderedPolygons"]
  renderedRotationRects: CanvasSectionBaseProps["renderedRotationRects"]
  renderedRectangles: CanvasSectionBaseProps["renderedRectangles"]
  renderedCuboids2d: CanvasSectionBaseProps["renderedCuboids2d"]
  renderedPoints: CanvasSectionBaseProps["renderedPoints"]
  renderedSkeletons: CanvasSectionBaseProps["renderedSkeletons"]
  selectedShapeIndex: CanvasSectionBaseProps["selectedShapeIndex"]
  hoveredShapeIndex: CanvasSectionBaseProps["hoveredShapeIndex"]
  pendingRectColor: CanvasSectionBaseProps["pendingRectColor"]
  selectedRotationRect: CanvasSectionBaseProps["selectedRotationRect"]
  selectedPolygon: CanvasSectionBaseProps["selectedPolygon"]
  selectedCuboid2d: CanvasSectionBaseProps["selectedCuboid2d"]
  selectedRect: CanvasSectionBaseProps["selectedRect"]
  rawHighlightCorner: CanvasSectionBaseProps["rawHighlightCorner"]
}

export function useCanvasSectionProps(params: UseCanvasSectionPropsParams) {
  const canvasSectionHandlerProps = useMemo(
    () => ({
      stageRef: params.stageRef,
      onStageWheel: params.handleImageWheel,
      onStageMouseDown: params.handleImageMouseDown,
      onStageMouseMove: params.handleImageMouseMove,
      onStageMouseUp: params.endImagePan,
      onStageMouseLeave: params.endImagePan,
      onStageDoubleClick: params.handleImageDoubleClick,
      onStageClick: params.handleStageClick,
      onImageError: () => params.setImageLoadError(true),
      onImageLoad: params.handleImageElementLoad,
      onSetRawHighlightCorner: params.setRawHighlightCorner,
      onSetSelectedShapeId: params.setSelectedShape,
      onHandleRectangleMouseEnter: params.handleRectangleMouseEnter,
      onHandleRectangleMouseLeave: params.handleRectangleMouseLeave,
      onHandleRectangleMouseDown: params.handleRectangleMouseDown,
      onHandleRectangleClick: params.handleRectangleClick,
      onHandleMaskMouseDown: params.handleMaskMouseDown,
      onHandlePointMouseDown: params.handlePointMouseDown,
      onHandlePolygonMouseDown: params.handlePolygonMouseDown,
      onHandleCuboidFaceMouseDown: params.handleCuboidFaceMouseDown,
      onHandleRotationPolygonMouseDown: params.handleRotationPolygonMouseDown,
      onHandleRotationHandleMouseDown: params.handleRotationHandleMouseDown,
      onHandleRotationCornerMouseDown: params.handleRotationCornerMouseDown,
      onHandlePolygonVertexMouseDown: params.handlePolygonVertexMouseDown,
      onHandleRectResizeMouseDown: params.handleRectResizeMouseDown,
      previewRect: params.previewRect,
      polygonDraftStagePoints: params.polygonDraftStagePoints,
      hoveredDraftVertexIndex: params.hoveredDraftVertexIndex,
      maskDraftStagePoints: params.maskDraftStagePoints,
      maskCursorStagePoint: params.maskCursorStagePoint,
      maskBrushSize: params.maskBrushSize,
      maskDrawMode: params.maskDrawMode,
      onCreateMaskDraft: params.createMaskDraft,
      onAppendMaskDraftPoint: params.appendMaskDraftPoint,
      onCommitMaskStroke: params.commitMaskStroke,
      onClearMaskTransientState: params.clearMaskTransientState,
      onHandlePolygonDrawMove: params.handlePolygonDrawMove,
      onHandlePolygonDrawClick: params.handlePolygonDrawClick,
      onHandlePolygonDrawDoubleClick: params.handlePolygonDrawDoubleClick,
      onHandleRectDrawMove: params.handleRectDrawMove,
      onHandleRectDrawClick: params.handleRectDrawClick,
      onHandleBox3dDrawMove: params.handleBox3dDrawMove,
      onHandleBox3dDrawClick: params.handleBox3dDrawClick,
      onHandleKeypointDrawClick: params.handleKeypointDrawClick,
      onHandleSkeletonDrawClick: params.handleSkeletonDrawClick,
      box3dDraftBaseStagePoints: params.box3dDraftBaseStagePoints,
      box3dPreviewTopStagePoints: params.box3dPreviewTopStagePoints,
    }),
    [params],
  )

  const canvasSectionRenderProps = useMemo(
    () => ({
      error: params.error,
      filesLength: params.filesLength,
      isImageLoading: params.isImageLoading,
      imageObjectUrl: params.imageObjectUrl,
      imageLoadError: params.imageLoadError,
      currentFileName: params.currentFileName,
      canPanAndZoom: params.canPanAndZoom,
      isPanning: params.isPanning,
      canDrawMask: params.canDrawMask,
      canDrawRectangle: params.canDrawRectangle,
      canDrawPolygon: params.canDrawPolygon,
      canDrawBox3d: params.canDrawBox3d,
      canDrawKeypoint: params.canDrawKeypoint,
      canDrawSkeleton: params.canDrawSkeleton,
      imageOffset: params.imageOffset,
      imageScale: params.imageScale,
      drawingLayerActive: params.drawingLayerActive,
      renderedMasks: params.renderedMasks,
      renderedPolygons: params.renderedPolygons,
      renderedRotationRects: params.renderedRotationRects,
      renderedRectangles: params.renderedRectangles,
      renderedCuboids2d: params.renderedCuboids2d,
      renderedPoints: params.renderedPoints,
      renderedSkeletons: params.renderedSkeletons,
      selectedShapeIndex: params.selectedShapeIndex,
      hoveredShapeIndex: params.hoveredShapeIndex,
      pendingRectColor: params.pendingRectColor,
      selectedRotationRect: params.selectedRotationRect,
      selectedPolygon: params.selectedPolygon,
      selectedCuboid2d: params.selectedCuboid2d,
      selectedRect: params.selectedRect,
      rawHighlightCorner: params.rawHighlightCorner,
      previewRect: params.previewRect,
      polygonDraftStagePoints: params.polygonDraftStagePoints,
      hoveredDraftVertexIndex: params.hoveredDraftVertexIndex,
      maskDraftStagePoints: params.maskDraftStagePoints,
      maskCursorStagePoint: params.maskCursorStagePoint,
      maskBrushSize: params.maskBrushSize,
      maskDrawMode: params.maskDrawMode,
    }),
    [params],
  )

  return useMemo<CanvasSectionBaseProps>(
    () => ({
      ...canvasSectionHandlerProps,
      ...canvasSectionRenderProps,
    }),
    [canvasSectionHandlerProps, canvasSectionRenderProps],
  )
}

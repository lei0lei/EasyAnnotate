import { useMemo } from "react"
import type { ProjectTaskCanvasSectionProps } from "@/pages/project-task-detail/page-sections"

type CanvasSectionBaseProps = Omit<ProjectTaskCanvasSectionProps, "toolPaletteProps" | "drawHintProps" | "aiToolPaletteProps">

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
  canDrawRectangle: CanvasSectionBaseProps["canDrawRectangle"]
  canDrawPolygon: CanvasSectionBaseProps["canDrawPolygon"]
  canDrawBox3d: CanvasSectionBaseProps["canDrawBox3d"]
  canDrawKeypoint: CanvasSectionBaseProps["canDrawKeypoint"]
  canDrawSkeleton: CanvasSectionBaseProps["canDrawSkeleton"]
  imageOffset: CanvasSectionBaseProps["imageOffset"]
  imageScale: CanvasSectionBaseProps["imageScale"]
  annotationLineWidthScale: CanvasSectionBaseProps["annotationLineWidthScale"]
  annotationPointSizeScale: CanvasSectionBaseProps["annotationPointSizeScale"]
  imageFitScale: CanvasSectionBaseProps["imageFitScale"]
  drawingLayerActive: CanvasSectionBaseProps["drawingLayerActive"]
  renderedRasterPreviews: CanvasSectionBaseProps["renderedRasterPreviews"]
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
  dragStageNudge: CanvasSectionBaseProps["dragStageNudge"]
  sam2OverlayActive: CanvasSectionBaseProps["sam2OverlayActive"]
  sam2StagePoints: CanvasSectionBaseProps["sam2StagePoints"]
  sam2PointPositiveColor: CanvasSectionBaseProps["sam2PointPositiveColor"]
  sam2PointNegativeColor: CanvasSectionBaseProps["sam2PointNegativeColor"]
  sam2PreviewRect: CanvasSectionBaseProps["sam2PreviewRect"]
  sam2AutoPreviewRect: CanvasSectionBaseProps["sam2AutoPreviewRect"]
  onSam2OverlayClick: CanvasSectionBaseProps["onSam2OverlayClick"]
  onSam2OverlayContextMenu: CanvasSectionBaseProps["onSam2OverlayContextMenu"]
  onSam2OverlayMouseMove: CanvasSectionBaseProps["onSam2OverlayMouseMove"]
  onSam2OverlayMouseLeave: CanvasSectionBaseProps["onSam2OverlayMouseLeave"]
  sam2Toast: CanvasSectionBaseProps["sam2Toast"]
  onSam2ToastDismiss: CanvasSectionBaseProps["onSam2ToastDismiss"]
  diffusionOverlayActive: CanvasSectionBaseProps["diffusionOverlayActive"]
  diffusionSeedRect: CanvasSectionBaseProps["diffusionSeedRect"]
  diffusionSeedRectCommitted: CanvasSectionBaseProps["diffusionSeedRectCommitted"]
  diffusionSeedColor: CanvasSectionBaseProps["diffusionSeedColor"]
  onDiffusionOverlayClick: CanvasSectionBaseProps["onDiffusionOverlayClick"]
  onDiffusionOverlayMouseMove: CanvasSectionBaseProps["onDiffusionOverlayMouseMove"]
  onDiffusionOverlayMouseLeave: CanvasSectionBaseProps["onDiffusionOverlayMouseLeave"]
  diffusionProcessRects: CanvasSectionBaseProps["diffusionProcessRects"]
}

export function useCanvasSectionProps(params: UseCanvasSectionPropsParams) {
  const {
    stageRef,
    handleImageWheel,
    handleImageMouseDown,
    handleImageMouseMove,
    endImagePan,
    handleImageDoubleClick,
    handleStageClick,
    setImageLoadError,
    handleImageElementLoad,
    setRawHighlightCorner,
    setSelectedShape,
    handleRectangleMouseEnter,
    handleRectangleMouseLeave,
    handleRectangleMouseDown,
    handleRectangleClick,
    handlePointMouseDown,
    handlePolygonMouseDown,
    handleCuboidFaceMouseDown,
    handleRotationPolygonMouseDown,
    handleRotationHandleMouseDown,
    handleRotationCornerMouseDown,
    handlePolygonVertexMouseDown,
    handleRectResizeMouseDown,
    previewRect,
    polygonDraftStagePoints,
    hoveredDraftVertexIndex,
    handlePolygonDrawMove,
    handlePolygonDrawClick,
    handlePolygonDrawDoubleClick,
    handleRectDrawMove,
    handleRectDrawClick,
    handleBox3dDrawMove,
    handleBox3dDrawClick,
    handleKeypointDrawClick,
    handleSkeletonDrawClick,
    box3dDraftBaseStagePoints,
    box3dPreviewTopStagePoints,
    error,
    filesLength,
    isImageLoading,
    imageObjectUrl,
    imageLoadError,
    currentFileName,
    canPanAndZoom,
    isPanning,
    canDrawRectangle,
    canDrawPolygon,
    canDrawBox3d,
    canDrawKeypoint,
    canDrawSkeleton,
    imageOffset,
    imageScale,
    annotationLineWidthScale,
    annotationPointSizeScale,
    imageFitScale,
    drawingLayerActive,
    renderedRasterPreviews,
    renderedPolygons,
    renderedRotationRects,
    renderedRectangles,
    renderedCuboids2d,
    renderedPoints,
    renderedSkeletons,
    selectedShapeIndex,
    hoveredShapeIndex,
    pendingRectColor,
    selectedRotationRect,
    selectedPolygon,
    selectedCuboid2d,
    selectedRect,
    rawHighlightCorner,
    dragStageNudge,
    sam2OverlayActive,
    sam2StagePoints,
    sam2PointPositiveColor,
    sam2PointNegativeColor,
    sam2PreviewRect,
    sam2AutoPreviewRect,
    onSam2OverlayClick,
    onSam2OverlayContextMenu,
    onSam2OverlayMouseMove,
    onSam2OverlayMouseLeave,
    sam2Toast,
    onSam2ToastDismiss,
    diffusionOverlayActive,
    diffusionSeedRect,
    diffusionSeedRectCommitted,
    diffusionSeedColor,
    onDiffusionOverlayClick,
    onDiffusionOverlayMouseMove,
    onDiffusionOverlayMouseLeave,
    diffusionProcessRects,
  } = params

  const canvasSectionHandlerProps = useMemo(
    () => ({
      stageRef,
      onStageWheel: handleImageWheel,
      onStageMouseDown: handleImageMouseDown,
      onStageMouseMove: handleImageMouseMove,
      onStageMouseUp: endImagePan,
      onStageMouseLeave: endImagePan,
      onStageDoubleClick: handleImageDoubleClick,
      onStageClick: handleStageClick,
      onImageError: () => setImageLoadError(true),
      onImageLoad: handleImageElementLoad,
      onSetRawHighlightCorner: setRawHighlightCorner,
      onSetSelectedShapeId: setSelectedShape,
      onHandleRectangleMouseEnter: handleRectangleMouseEnter,
      onHandleRectangleMouseLeave: handleRectangleMouseLeave,
      onHandleRectangleMouseDown: handleRectangleMouseDown,
      onHandleRectangleClick: handleRectangleClick,
      onHandlePointMouseDown: handlePointMouseDown,
      onHandlePolygonMouseDown: handlePolygonMouseDown,
      onHandleCuboidFaceMouseDown: handleCuboidFaceMouseDown,
      onHandleRotationPolygonMouseDown: handleRotationPolygonMouseDown,
      onHandleRotationHandleMouseDown: handleRotationHandleMouseDown,
      onHandleRotationCornerMouseDown: handleRotationCornerMouseDown,
      onHandlePolygonVertexMouseDown: handlePolygonVertexMouseDown,
      onHandleRectResizeMouseDown: handleRectResizeMouseDown,
      previewRect,
      polygonDraftStagePoints,
      hoveredDraftVertexIndex,
      onHandlePolygonDrawMove: handlePolygonDrawMove,
      onHandlePolygonDrawClick: handlePolygonDrawClick,
      onHandlePolygonDrawDoubleClick: handlePolygonDrawDoubleClick,
      onHandleRectDrawMove: handleRectDrawMove,
      onHandleRectDrawClick: handleRectDrawClick,
      onHandleBox3dDrawMove: handleBox3dDrawMove,
      onHandleBox3dDrawClick: handleBox3dDrawClick,
      onHandleKeypointDrawClick: handleKeypointDrawClick,
      onHandleSkeletonDrawClick: handleSkeletonDrawClick,
      box3dDraftBaseStagePoints,
      box3dPreviewTopStagePoints,
      onSam2OverlayClick,
      onSam2OverlayContextMenu,
      onSam2OverlayMouseMove,
      onSam2OverlayMouseLeave,
      onDiffusionOverlayClick,
      onDiffusionOverlayMouseMove,
      onDiffusionOverlayMouseLeave,
      sam2Toast,
      onSam2ToastDismiss,
    }),
    [
      box3dDraftBaseStagePoints,
      box3dPreviewTopStagePoints,
      endImagePan,
      handleBox3dDrawClick,
      handleBox3dDrawMove,
      handleCuboidFaceMouseDown,
      handleImageDoubleClick,
      handleImageElementLoad,
      handleImageMouseDown,
      handleImageMouseMove,
      handleImageWheel,
      handleKeypointDrawClick,
      handlePointMouseDown,
      handlePolygonDrawClick,
      handlePolygonDrawDoubleClick,
      handlePolygonDrawMove,
      handlePolygonMouseDown,
      handlePolygonVertexMouseDown,
      handleRectDrawClick,
      handleRectDrawMove,
      handleRectResizeMouseDown,
      handleRectangleClick,
      handleRectangleMouseDown,
      handleRectangleMouseEnter,
      handleRectangleMouseLeave,
      handleRotationCornerMouseDown,
      handleRotationHandleMouseDown,
      handleRotationPolygonMouseDown,
      handleSkeletonDrawClick,
      handleStageClick,
      hoveredDraftVertexIndex,
      polygonDraftStagePoints,
      previewRect,
      setImageLoadError,
      setRawHighlightCorner,
      setSelectedShape,
      stageRef,
      onSam2OverlayClick,
      onSam2OverlayContextMenu,
      onSam2OverlayMouseMove,
      onSam2OverlayMouseLeave,
      onDiffusionOverlayClick,
      onDiffusionOverlayMouseMove,
      onDiffusionOverlayMouseLeave,
      sam2Toast,
      onSam2ToastDismiss,
    ],
  )

  const canvasSectionRenderProps = useMemo(
    () => ({
      error,
      filesLength,
      isImageLoading,
      imageObjectUrl,
      imageLoadError,
      currentFileName,
      canPanAndZoom,
      isPanning,
      canDrawRectangle,
      canDrawPolygon,
      canDrawBox3d,
      canDrawKeypoint,
      canDrawSkeleton,
      imageOffset,
      imageScale,
      annotationLineWidthScale,
      annotationPointSizeScale,
      imageFitScale,
      drawingLayerActive,
      renderedRasterPreviews,
      renderedPolygons,
      renderedRotationRects,
      renderedRectangles,
      renderedCuboids2d,
      renderedPoints,
      renderedSkeletons,
      selectedShapeIndex,
      hoveredShapeIndex,
      pendingRectColor,
      selectedRotationRect,
      selectedPolygon,
      selectedCuboid2d,
      selectedRect,
      rawHighlightCorner,
      dragStageNudge,
      previewRect,
      polygonDraftStagePoints,
      hoveredDraftVertexIndex,
      sam2OverlayActive,
      sam2StagePoints,
      sam2PointPositiveColor,
      sam2PointNegativeColor,
      sam2PreviewRect,
      sam2AutoPreviewRect,
      sam2Toast,
      diffusionOverlayActive,
      diffusionSeedRect,
      diffusionSeedRectCommitted,
      diffusionSeedColor,
      diffusionProcessRects,
    }),
    [
      canDrawBox3d,
      canDrawKeypoint,
      canDrawPolygon,
      canDrawRectangle,
      canDrawSkeleton,
      canPanAndZoom,
      currentFileName,
      dragStageNudge,
      drawingLayerActive,
      error,
      filesLength,
      hoveredDraftVertexIndex,
      hoveredShapeIndex,
      imageFitScale,
      annotationLineWidthScale,
      annotationPointSizeScale,
      imageLoadError,
      imageObjectUrl,
      imageOffset,
      imageScale,
      annotationLineWidthScale,
      annotationPointSizeScale,
      isImageLoading,
      isPanning,
      pendingRectColor,
      polygonDraftStagePoints,
      previewRect,
      rawHighlightCorner,
      renderedCuboids2d,
      renderedRasterPreviews,
      renderedPoints,
      renderedPolygons,
      renderedRectangles,
      renderedRotationRects,
      renderedSkeletons,
      selectedCuboid2d,
      selectedPolygon,
      selectedRect,
      selectedRotationRect,
      selectedShapeIndex,
      sam2AutoPreviewRect,
      sam2OverlayActive,
      sam2PointNegativeColor,
      sam2PointPositiveColor,
      sam2PreviewRect,
      sam2StagePoints,
      sam2Toast,
      diffusionOverlayActive,
      diffusionSeedRect,
      diffusionSeedRectCommitted,
      diffusionSeedColor,
      diffusionProcessRects,
    ],
  )

  return useMemo<CanvasSectionBaseProps>(
    () => ({
      ...canvasSectionHandlerProps,
      ...canvasSectionRenderProps,
    }),
    [canvasSectionHandlerProps, canvasSectionRenderProps],
  )
}

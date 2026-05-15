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
  imageFitScale: CanvasSectionBaseProps["imageFitScale"]
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
    handleMaskMouseDown,
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
    maskDraftStagePoints,
    maskCursorStagePoint,
    maskBrushSize,
    maskDrawMode,
    createMaskDraft,
    appendMaskDraftPoint,
    commitMaskStroke,
    clearMaskTransientState,
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
    canDrawMask,
    canDrawRectangle,
    canDrawPolygon,
    canDrawBox3d,
    canDrawKeypoint,
    canDrawSkeleton,
    imageOffset,
    imageScale,
    imageFitScale,
    drawingLayerActive,
    renderedMasks,
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
      onHandleMaskMouseDown: handleMaskMouseDown,
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
      maskDraftStagePoints,
      maskCursorStagePoint,
      maskBrushSize,
      maskDrawMode,
      onCreateMaskDraft: createMaskDraft,
      onAppendMaskDraftPoint: appendMaskDraftPoint,
      onCommitMaskStroke: commitMaskStroke,
      onClearMaskTransientState: clearMaskTransientState,
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
      sam2Toast,
      onSam2ToastDismiss,
    }),
    [
      appendMaskDraftPoint,
      box3dDraftBaseStagePoints,
      box3dPreviewTopStagePoints,
      clearMaskTransientState,
      commitMaskStroke,
      createMaskDraft,
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
      handleMaskMouseDown,
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
      maskBrushSize,
      maskCursorStagePoint,
      maskDraftStagePoints,
      maskDrawMode,
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
      canDrawMask,
      canDrawRectangle,
      canDrawPolygon,
      canDrawBox3d,
      canDrawKeypoint,
      canDrawSkeleton,
      imageOffset,
      imageScale,
      imageFitScale,
      drawingLayerActive,
      renderedMasks,
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
      maskDraftStagePoints,
      maskCursorStagePoint,
      maskBrushSize,
      maskDrawMode,
      sam2OverlayActive,
      sam2StagePoints,
      sam2PointPositiveColor,
      sam2PointNegativeColor,
      sam2PreviewRect,
      sam2AutoPreviewRect,
      sam2Toast,
    }),
    [
      canDrawBox3d,
      canDrawKeypoint,
      canDrawMask,
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
      imageLoadError,
      imageObjectUrl,
      imageOffset,
      imageScale,
      isImageLoading,
      isPanning,
      maskBrushSize,
      maskCursorStagePoint,
      maskDraftStagePoints,
      maskDrawMode,
      pendingRectColor,
      polygonDraftStagePoints,
      previewRect,
      rawHighlightCorner,
      renderedCuboids2d,
      renderedMasks,
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

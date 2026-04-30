/**
 * 模块：project-task-detail/page-sections
 * 职责：封装任务详情页左右分区 section（Sidebar / Canvas）的结构组件。
 * 边界：负责布局与 props 组合，不管理页面状态源。
 */
import { RectangleOverlayItem, TaskCanvasLayer, TaskDrawHint, TaskLeftPanelContent, TaskLeftSidebarLayer } from "@/pages/project-task-detail/components"
import { TaskToolPalette } from "@/pages/project-task-detail/annotateTools"
import type {
  RenderedCuboid2d,
  RenderedMask,
  RenderedPoint,
  RenderedPolygon,
  RenderedRectangle,
  RenderedRotationRect,
  RenderedSkeleton,
} from "@/pages/project-task-detail/types"
import type { LeftPanelMode, Point } from "@/pages/project-task-detail/types"
import type { TaskToolPaletteProps } from "@/pages/project-task-detail/annotateTools/types"
import {
  cuboidBackVerticalEdgeHandleMarkers,
  cuboidFrontEdgeMidMarkers,
  cuboidWireframeEdgeSegmentsLayered,
} from "@/pages/project-task-detail/cuboid2d-geometry"
import type { TaskDrawHintProps, TaskLeftPanelContentProps } from "@/pages/project-task-detail/components"
import type { MouseEvent as ReactMouseEvent, MutableRefObject, SyntheticEvent, WheelEventHandler, MouseEventHandler } from "react"

type ProjectTaskSidebarSectionProps = {
  leftPanelMode: LeftPanelMode
  onPanelModeChange: (mode: LeftPanelMode) => void
  panelProps: TaskLeftPanelContentProps
}

export function ProjectTaskSidebarSection({ leftPanelMode, onPanelModeChange, panelProps }: ProjectTaskSidebarSectionProps) {
  return (
    <TaskLeftSidebarLayer leftPanelMode={leftPanelMode} onPanelModeChange={onPanelModeChange}>
      <TaskLeftPanelContent {...panelProps} />
    </TaskLeftSidebarLayer>
  )
}

export type ProjectTaskCanvasSectionProps = {
  error: string | null
  filesLength: number
  stageRef: MutableRefObject<HTMLDivElement | null>
  onStageWheel: WheelEventHandler<HTMLDivElement>
  onStageMouseDown: MouseEventHandler<HTMLDivElement>
  onStageMouseMove: MouseEventHandler<HTMLDivElement>
  onStageMouseUp: () => void
  onStageMouseLeave: () => void
  onStageDoubleClick: MouseEventHandler<HTMLDivElement>
  onStageClick: MouseEventHandler<HTMLDivElement>
  isImageLoading: boolean
  imageObjectUrl: string
  imageLoadError: boolean
  currentFileName: string
  canPanAndZoom: boolean
  isPanning: boolean
  canDrawMask: boolean
  canDrawRectangle: boolean
  canDrawPolygon: boolean
  canDrawBox3d: boolean
  canDrawKeypoint: boolean
  canDrawSkeleton: boolean
  imageOffset: { x: number; y: number }
  imageScale: number
  onImageError: () => void
  onImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  drawingLayerActive: boolean
  renderedMasks: RenderedMask[]
  renderedPolygons: RenderedPolygon[]
  renderedRotationRects: RenderedRotationRect[]
  renderedRectangles: RenderedRectangle[]
  renderedCuboids2d: RenderedCuboid2d[]
  renderedPoints: RenderedPoint[]
  renderedSkeletons: RenderedSkeleton[]
  selectedShapeIndex: number | null
  hoveredShapeIndex: number | null
  pendingRectColor: string
  selectedRotationRect: RenderedRotationRect | null
  selectedPolygon: RenderedPolygon | null
  selectedCuboid2d: RenderedCuboid2d | null
  selectedRect: RenderedRectangle | null
  rawHighlightCorner: { shapeId: string; cornerIndex: number } | null
  onSetRawHighlightCorner: (
    value:
      | { shapeId: string; cornerIndex: number }
      | null
      | ((prev: { shapeId: string; cornerIndex: number } | null) => { shapeId: string; cornerIndex: number } | null),
  ) => void
  onSetSelectedShapeId: (shapeId: string | null) => void
  onHandleRectangleMouseEnter: (shapeId: string) => void
  onHandleRectangleMouseLeave: (shapeId: string) => void
  onHandleRectangleMouseDown: (shapeId: string, event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleRectangleClick: (shapeId: string, event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleMaskMouseDown: (shapeId: string, event: ReactMouseEvent<HTMLElement>) => void
  onHandlePointMouseDown: (shapeId: string, event: ReactMouseEvent<Element>) => void
  onHandlePolygonMouseDown: (shapeId: string, event: ReactMouseEvent<SVGGraphicsElement>) => void
  onHandleCuboidFaceMouseDown: (shapeId: string, face: "front" | "back", event: ReactMouseEvent<SVGPolygonElement>) => void
  onHandleRotationPolygonMouseDown: (shapeId: string, event: ReactMouseEvent<SVGPolygonElement>) => void
  onHandleRotationHandleMouseDown: (event: ReactMouseEvent<SVGCircleElement>) => void
  onHandleRotationCornerMouseDown: (cornerIndex: number, event: ReactMouseEvent<SVGCircleElement>) => void
  onHandlePolygonVertexMouseDown: (shapeId: string, vertexIndex: number, event: ReactMouseEvent<SVGCircleElement>) => void
  onHandleRectResizeMouseDown: (handle: "nw" | "ne" | "se" | "sw", event: ReactMouseEvent<HTMLButtonElement>) => void
  previewRect: {
    left: number
    top: number
    width: number
    height: number
    clippedLeft: boolean
    clippedTop: boolean
    clippedRight: boolean
    clippedBottom: boolean
  } | null
  polygonDraftStagePoints: Point[]
  hoveredDraftVertexIndex: number | null
  maskDraftStagePoints: Point[]
  maskCursorStagePoint: Point | null
  maskBrushSize: number
  maskDrawMode: "brush" | "eraser"
  onCreateMaskDraft: (event: ReactMouseEvent<HTMLDivElement>) => void
  onAppendMaskDraftPoint: (event: ReactMouseEvent<HTMLDivElement>) => void
  onCommitMaskStroke: () => void
  onClearMaskTransientState: () => void
  onHandlePolygonDrawMove: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandlePolygonDrawClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandlePolygonDrawDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleRectDrawMove: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleRectDrawClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleBox3dDrawMove: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleBox3dDrawClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleKeypointDrawClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  onHandleSkeletonDrawClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  box3dDraftBaseStagePoints: Point[]
  box3dPreviewTopStagePoints: Point[]
  toolPaletteProps: TaskToolPaletteProps
  drawHintProps: TaskDrawHintProps
}

export function ProjectTaskCanvasSection(props: ProjectTaskCanvasSectionProps) {
  return (
    <TaskCanvasLayer>
      {props.error ? <p className="text-sm text-destructive">读取失败：{props.error}</p> : null}
      {!props.error && props.filesLength === 0 ? (
        <div className="flex h-full items-center justify-center border border-border/70 bg-background text-sm text-muted-foreground">
          当前任务暂无文件记录。
        </div>
      ) : (
        <div
          ref={props.stageRef}
          className="relative h-full overflow-hidden border border-border/70 bg-background"
          onWheel={props.onStageWheel}
          onMouseDown={props.onStageMouseDown}
          onMouseMove={props.onStageMouseMove}
          onMouseUp={props.onStageMouseUp}
          onMouseLeave={props.onStageMouseLeave}
          onDoubleClick={props.onStageDoubleClick}
          onClick={props.onStageClick}
        >
          {props.isImageLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">图片加载中...</div>
          ) : props.imageObjectUrl && !props.imageLoadError ? (
            <div
              className="flex h-full w-full items-center justify-center overflow-hidden"
              style={{
                cursor: props.canPanAndZoom
                  ? props.isPanning
                    ? "grabbing"
                    : "grab"
                  : props.canDrawMask
                    ? "none"
                    : props.canDrawRectangle ||
                        props.canDrawPolygon ||
                        props.canDrawBox3d ||
                        props.canDrawKeypoint ||
                        props.canDrawSkeleton
                      ? "crosshair"
                      : "default",
              }}
            >
              <img
                src={props.imageObjectUrl}
                alt={props.currentFileName}
                className="max-h-full max-w-full object-contain select-none"
                style={{
                  transform: `translate(${props.imageOffset.x}px, ${props.imageOffset.y}px) scale(${props.imageScale})`,
                  transformOrigin: "center center",
                }}
                onError={props.onImageError}
                onLoad={props.onImageLoad}
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0">
                <svg className="absolute inset-0 h-full w-full overflow-visible">
                  {props.renderedMasks.map((item) => {
                    const isSelected = props.selectedShapeIndex === item.index
                    const isHovered = props.hoveredShapeIndex === item.index
                    const stageBrushSize = Math.max(1, item.brushSize * props.imageScale)
                    if (item.stagePoints.length === 1 && item.stageSegments.length <= 1) {
                      const center = item.stagePoints[0]
                      if (!center) return null
                      return (
                        <circle
                          key={`mask-dot-${item.shapeId}`}
                          cx={center.x}
                          cy={center.y}
                          r={Math.max(1, stageBrushSize / 2)}
                          fill={isSelected || isHovered ? `${item.color}99` : `${item.color}66`}
                          stroke={item.color}
                          strokeWidth={isSelected ? 1.5 : 1}
                          className="pointer-events-none"
                        />
                      )
                    }
                    return (
                      <g key={`mask-segments-${item.shapeId}`}>
                        {item.stageSegments.map((segment, segmentIndex) => {
                          if (segment.length === 1) {
                            const center = segment[0]
                            if (!center) return null
                            return (
                              <circle
                                key={`mask-segment-dot-${item.shapeId}-${segmentIndex}`}
                                cx={center.x}
                                cy={center.y}
                                r={Math.max(1, stageBrushSize / 2)}
                                fill={isSelected || isHovered ? `${item.color}99` : `${item.color}66`}
                                stroke={item.color}
                                strokeWidth={isSelected ? 1.5 : 1}
                                className="pointer-events-none"
                              />
                            )
                          }
                          return (
                            <polyline
                              key={`mask-${item.shapeId}-${segmentIndex}`}
                              points={segment.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                              fill="none"
                              stroke={item.color}
                              strokeWidth={Math.max(1, stageBrushSize + (isSelected ? 1.5 : isHovered ? 0.8 : 0))}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              opacity={isSelected || isHovered ? 0.85 : 0.6}
                              className="pointer-events-none"
                            />
                          )
                        })}
                      </g>
                    )
                  })}
                  {props.renderedPolygons.map((item) => {
                    const polygonPoints = item.stagePoints.map((pt) => `${pt.x},${pt.y}`).join(" ")
                    const isSelected = props.selectedShapeIndex === item.index
                    const isHovered = props.hoveredShapeIndex === item.index
                    return (
                      <polygon
                        key={`polygon-${item.shapeId}`}
                        points={polygonPoints}
                        fill={isSelected || isHovered ? `${item.color}33` : "transparent"}
                        stroke={item.color}
                        strokeWidth={2}
                        className={props.drawingLayerActive ? "pointer-events-none" : "pointer-events-auto"}
                        onMouseEnter={() => props.onHandleRectangleMouseEnter(item.shapeId)}
                        onMouseLeave={() => props.onHandleRectangleMouseLeave(item.shapeId)}
                        onMouseDown={(event) => props.onHandlePolygonMouseDown(item.shapeId, event)}
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onSetSelectedShapeId(item.shapeId)
                        }}
                      />
                    )
                  })}
                  {props.renderedCuboids2d.map((item) => {
                    const b = item.baseStagePoints
                    const t = item.topStagePoints
                    if (b.length < 4 || t.length < 4) return null
                    const basePointsStr = b.map((pt) => `${pt.x},${pt.y}`).join(" ")
                    const topPointsStr = t.map((pt) => `${pt.x},${pt.y}`).join(" ")
                    const isSelected = props.selectedShapeIndex === item.index
                    const isHovered = props.hoveredShapeIndex === item.index
                    const faceFill = isSelected || isHovered ? `${item.color}28` : `${item.color}12`
                    const { behind: behindEdges, front: frontEdges } = cuboidWireframeEdgeSegmentsLayered(b, t)
                    const facePolyClass = props.drawingLayerActive
                      ? "pointer-events-none"
                      : "pointer-events-auto cursor-move"
                    const uses8 = item.usesExplicitQuadPair
                    // 3D 框 8 点：points[0..3] 为绘制的正面、points[4..7] 为背面。
                    // SVG 后绘制的面在上层参与命中。须先画背面、再画正面，重叠区域由正面承接「整体平移 8 点」，
                    // 未与正面重叠的背面区域才命中「只平移后四点」。
                    return (
                      <g key={`cuboid2d-${item.shapeId}`}>
                        <polygon
                          points={topPointsStr}
                          fill={faceFill}
                          stroke="none"
                          className={facePolyClass}
                          onMouseEnter={() => props.onHandleRectangleMouseEnter(item.shapeId)}
                          onMouseLeave={() => props.onHandleRectangleMouseLeave(item.shapeId)}
                          onMouseDown={(event) =>
                            uses8
                              ? props.onHandleCuboidFaceMouseDown(item.shapeId, "back", event)
                              : props.onHandlePolygonMouseDown(item.shapeId, event)
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            props.onSetSelectedShapeId(item.shapeId)
                          }}
                        />
                        <polygon
                          points={basePointsStr}
                          fill={faceFill}
                          stroke="none"
                          className={facePolyClass}
                          onMouseEnter={() => props.onHandleRectangleMouseEnter(item.shapeId)}
                          onMouseLeave={() => props.onHandleRectangleMouseLeave(item.shapeId)}
                          onMouseDown={(event) =>
                            uses8
                              ? props.onHandleCuboidFaceMouseDown(item.shapeId, "front", event)
                              : props.onHandlePolygonMouseDown(item.shapeId, event)
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            props.onSetSelectedShapeId(item.shapeId)
                          }}
                        />
                        {behindEdges.map(([p1, p2], j) => (
                          <line
                            key={`cuboid2d-edge-behind-${item.shapeId}-${j}`}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={item.color}
                            strokeWidth={isSelected ? 2.25 : isHovered ? 2 : 1.5}
                            className="pointer-events-none"
                          />
                        ))}
                        {frontEdges.map(([p1, p2], j) => (
                          <line
                            key={`cuboid2d-edge-front-${item.shapeId}-${j}`}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke="#ffffff"
                            strokeWidth={isSelected ? 3.75 : isHovered ? 3.25 : 3}
                            className="pointer-events-none"
                          />
                        ))}
                      </g>
                    )
                  })}
                  {props.renderedRotationRects.map((item) => {
                    const polygonPoints = item.stagePoints.map((pt) => `${pt.x},${pt.y}`).join(" ")
                    const isSelected = props.selectedShapeIndex === item.index
                    const isHovered = props.hoveredShapeIndex === item.index
                    return (
                      <polygon
                        key={`rotation-${item.shapeId}`}
                        points={polygonPoints}
                        fill={isSelected || isHovered ? `${item.color}33` : "transparent"}
                        stroke={item.color}
                        strokeWidth={2}
                        className={props.drawingLayerActive ? "pointer-events-none" : "pointer-events-auto"}
                        onMouseEnter={() => props.onHandleRectangleMouseEnter(item.shapeId)}
                        onMouseLeave={() => props.onHandleRectangleMouseLeave(item.shapeId)}
                        onMouseDown={(event) => props.onHandleRotationPolygonMouseDown(item.shapeId, event)}
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onSetSelectedShapeId(item.shapeId)
                        }}
                      />
                    )
                  })}
                  {props.renderedPoints.map((item) => {
                    const { x, y } = item.stagePoint
                    const isSelected = props.selectedShapeIndex === item.index
                    const isHovered = props.hoveredShapeIndex === item.index
                    const rVisual = isSelected || isHovered ? 6.5 : 4.5
                    const hitR = 14
                    return (
                      <g key={`point-${item.shapeId}`}>
                        <circle
                          cx={x}
                          cy={y}
                          r={hitR}
                          fill="transparent"
                          className={props.drawingLayerActive ? "pointer-events-none" : "pointer-events-auto cursor-move"}
                          onMouseEnter={() => props.onHandleRectangleMouseEnter(item.shapeId)}
                          onMouseLeave={() => props.onHandleRectangleMouseLeave(item.shapeId)}
                          onMouseDown={(event) => props.onHandlePointMouseDown(item.shapeId, event)}
                          onClick={(event) => {
                            event.stopPropagation()
                            props.onSetSelectedShapeId(item.shapeId)
                          }}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r={rVisual}
                          fill={item.color}
                          stroke={isSelected ? "#ffffff" : isHovered ? "#ffffff" : `${item.color}cc`}
                          strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1}
                          className="pointer-events-none"
                          style={{
                            filter: isHovered || isSelected ? "drop-shadow(0 0 3px rgba(255,255,255,0.9))" : undefined,
                          }}
                        />
                      </g>
                    )
                  })}
                  {props.renderedSkeletons.map((item) => {
                    const isSelected = props.selectedShapeIndex === item.index
                    const isHovered = props.hoveredShapeIndex === item.index
                    const xs = item.stagePoints.map((p) => p.x)
                    const ys = item.stagePoints.map((p) => p.y)
                    let minX = Math.min(...xs)
                    let maxX = Math.max(...xs)
                    let minY = Math.min(...ys)
                    let maxY = Math.max(...ys)
                    const minSpan = 10
                    if (maxX - minX < minSpan) {
                      const c = (minX + maxX) / 2
                      minX = c - minSpan / 2
                      maxX = c + minSpan / 2
                    }
                    if (maxY - minY < minSpan) {
                      const c = (minY + maxY) / 2
                      minY = c - minSpan / 2
                      maxY = c + minSpan / 2
                    }
                    const jointHitR = 12
                    const jointVisR = isSelected ? 5 : 3.5
                    return (
                      <g key={`skeleton-${item.shapeId}`}>
                        {item.edgeIndexPairs.map(([a, b], edgeI) => {
                          const p1 = item.stagePoints[a]
                          const p2 = item.stagePoints[b]
                          if (!p1 || !p2) return null
                          return (
                            <line
                              key={`sk-edge-${item.shapeId}-${edgeI}`}
                              x1={p1.x}
                              y1={p1.y}
                              x2={p2.x}
                              y2={p2.y}
                              stroke={item.color}
                              strokeWidth={isSelected || isHovered ? 2.5 : 2}
                              className="pointer-events-none"
                            />
                          )
                        })}
                        <rect
                          x={minX}
                          y={minY}
                          width={maxX - minX}
                          height={maxY - minY}
                          fill={isSelected ? `${item.color}12` : "transparent"}
                          stroke={item.color}
                          strokeWidth={isSelected ? 2 : 1.5}
                          strokeDasharray={isSelected ? undefined : "5 4"}
                          className={props.drawingLayerActive ? "pointer-events-none" : "pointer-events-auto cursor-move"}
                          onMouseEnter={() => props.onHandleRectangleMouseEnter(item.shapeId)}
                          onMouseLeave={() => props.onHandleRectangleMouseLeave(item.shapeId)}
                          onMouseDown={(event) => props.onHandlePolygonMouseDown(item.shapeId, event)}
                          onClick={(event) => {
                            event.stopPropagation()
                            props.onSetSelectedShapeId(item.shapeId)
                          }}
                        />
                        {item.stagePoints.map((pt, j) => (
                          <g key={`sk-joint-${item.shapeId}-${j}`}>
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r={jointHitR}
                              fill="transparent"
                              className={props.drawingLayerActive ? "pointer-events-none" : "pointer-events-auto cursor-move"}
                              onMouseEnter={() => {
                                props.onHandleRectangleMouseEnter(item.shapeId)
                                props.onSetRawHighlightCorner({ shapeId: item.shapeId, cornerIndex: j })
                              }}
                              onMouseLeave={() => {
                                props.onHandleRectangleMouseLeave(item.shapeId)
                                props.onSetRawHighlightCorner((prev) =>
                                  prev?.shapeId === item.shapeId && prev.cornerIndex === j ? null : prev,
                                )
                              }}
                              onMouseDown={(event) => props.onHandlePolygonVertexMouseDown(item.shapeId, j, event)}
                              onClick={(event) => {
                                event.stopPropagation()
                                props.onSetSelectedShapeId(item.shapeId)
                              }}
                            />
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r={jointVisR}
                              fill={
                                props.rawHighlightCorner?.shapeId === item.shapeId &&
                                props.rawHighlightCorner.cornerIndex === j
                                  ? "#34d399"
                                  : item.color
                              }
                              stroke="#ffffff"
                              strokeWidth={1}
                              className="pointer-events-none"
                            />
                          </g>
                        ))}
                      </g>
                    )
                  })}
                  {props.selectedRotationRect && !props.drawingLayerActive ? (
                    (() => {
                      const selectedRotationRect = props.selectedRotationRect
                      return (
                        <>
                      <line
                        x1={selectedRotationRect.topMid.x}
                        y1={selectedRotationRect.topMid.y}
                        x2={selectedRotationRect.rotateHandle.x}
                        y2={selectedRotationRect.rotateHandle.y}
                        stroke={selectedRotationRect.color}
                        strokeWidth={2}
                      />
                      <circle
                        cx={selectedRotationRect.rotateHandle.x}
                        cy={selectedRotationRect.rotateHandle.y}
                        r={5}
                        fill={selectedRotationRect.color}
                        className="pointer-events-auto cursor-grab"
                        onMouseDown={props.onHandleRotationHandleMouseDown}
                      />
                      {selectedRotationRect.stagePoints.map((corner, cornerIndex) => (
                        <circle
                          key={`rotation-corner-${cornerIndex}`}
                          cx={corner.x}
                          cy={corner.y}
                          r={4.5}
                          fill={
                            props.rawHighlightCorner?.shapeId === selectedRotationRect.shapeId &&
                            props.rawHighlightCorner.cornerIndex === cornerIndex
                              ? "#34d399"
                              : selectedRotationRect.color
                          }
                          className="pointer-events-auto cursor-nwse-resize"
                          onMouseEnter={() => props.onSetRawHighlightCorner({ shapeId: selectedRotationRect.shapeId, cornerIndex })}
                          onMouseLeave={() =>
                            props.onSetRawHighlightCorner((prev) =>
                              prev?.shapeId === selectedRotationRect.shapeId && prev.cornerIndex === cornerIndex ? null : prev,
                            )
                          }
                          onMouseDown={(event) => props.onHandleRotationCornerMouseDown(cornerIndex, event)}
                        />
                      ))}
                        </>
                      )
                    })()
                  ) : null}
                  {props.selectedPolygon && !props.drawingLayerActive ? (
                    (() => {
                      const selectedPolygon = props.selectedPolygon
                      return (
                        <>
                      {selectedPolygon.stagePoints.map((point, vertexIndex) => (
                        <circle
                          key={`polygon-vertex-${selectedPolygon.index}-${vertexIndex}`}
                          cx={point.x}
                          cy={point.y}
                          r={4.5}
                          fill={
                            props.rawHighlightCorner?.shapeId === selectedPolygon.shapeId &&
                            props.rawHighlightCorner.cornerIndex === vertexIndex
                              ? "#34d399"
                              : selectedPolygon.color
                          }
                          stroke="#ffffff"
                          strokeWidth={1}
                          className="pointer-events-auto cursor-move"
                          onMouseEnter={() => props.onSetRawHighlightCorner({ shapeId: selectedPolygon.shapeId, cornerIndex: vertexIndex })}
                          onMouseLeave={() =>
                            props.onSetRawHighlightCorner((prev) =>
                              prev?.shapeId === selectedPolygon.shapeId && prev.cornerIndex === vertexIndex ? null : prev,
                            )
                          }
                          onMouseDown={(event) => props.onHandlePolygonVertexMouseDown(selectedPolygon.shapeId, vertexIndex, event)}
                        />
                      ))}
                        </>
                      )
                    })()
                  ) : null}
                  {props.selectedCuboid2d && !props.drawingLayerActive && props.selectedCuboid2d.usesExplicitQuadPair ? (
                    (() => {
                      const c = props.selectedCuboid2d
                      const b = c.baseStagePoints
                      const t = c.topStagePoints
                      if (b.length < 4 || t.length < 4) return null
                      const handles = [
                        ...b.map((point, vertexIndex) => ({
                          key: `cuboid-v-${c.shapeId}-${vertexIndex}`,
                          cx: point.x,
                          cy: point.y,
                          handleIndex: vertexIndex,
                          r: 4.5,
                        })),
                        ...cuboidFrontEdgeMidMarkers(b).map((m) => ({
                          key: `cuboid-m-${c.shapeId}-${m.handleIndex}`,
                          cx: m.cx,
                          cy: m.cy,
                          handleIndex: m.handleIndex,
                          r: 3.5,
                        })),
                        ...cuboidBackVerticalEdgeHandleMarkers(b, t).map((m) => ({
                          key: `cuboid-bt-${c.shapeId}-${m.handleIndex}`,
                          cx: m.cx,
                          cy: m.cy,
                          handleIndex: m.handleIndex,
                          r: 3.5,
                        })),
                      ]
                      return (
                        <>
                          {handles.map((h) => (
                            <circle
                              key={h.key}
                              cx={h.cx}
                              cy={h.cy}
                              r={h.r}
                              fill={
                                props.rawHighlightCorner?.shapeId === c.shapeId && props.rawHighlightCorner.cornerIndex === h.handleIndex
                                  ? "#34d399"
                                  : c.color
                              }
                              stroke="#ffffff"
                              strokeWidth={1}
                              className="pointer-events-auto cursor-move"
                              onMouseEnter={() => props.onSetRawHighlightCorner({ shapeId: c.shapeId, cornerIndex: h.handleIndex })}
                              onMouseLeave={() =>
                                props.onSetRawHighlightCorner((prev) =>
                                  prev?.shapeId === c.shapeId && prev.cornerIndex === h.handleIndex ? null : prev,
                                )
                              }
                              onMouseDown={(event) => props.onHandlePolygonVertexMouseDown(c.shapeId, h.handleIndex, event)}
                            />
                          ))}
                        </>
                      )
                    })()
                  ) : null}
                </svg>
                {props.renderedRectangles.map((item) => (
                  <RectangleOverlayItem
                    key={item.shapeId}
                    item={item}
                    drawingLayerActive={props.drawingLayerActive}
                    isSelected={props.selectedShapeIndex === item.index}
                    isHovered={props.hoveredShapeIndex === item.index}
                    onMouseEnter={props.onHandleRectangleMouseEnter}
                    onMouseLeave={props.onHandleRectangleMouseLeave}
                    onMouseDown={props.onHandleRectangleMouseDown}
                    onClick={props.onHandleRectangleClick}
                  />
                ))}
                {props.renderedMasks.map((item) => {
                  const isSelected = props.selectedShapeIndex === item.index
                  const isHovered = props.hoveredShapeIndex === item.index
                  return (
                    <div
                      key={`mask-bbox-${item.shapeId}`}
                      className={`${props.drawingLayerActive ? "pointer-events-none" : "pointer-events-auto"} absolute border border-dashed`}
                      style={{
                        left: item.left,
                        top: item.top,
                        width: item.width,
                        height: item.height,
                        borderColor: item.color,
                        borderWidth: isSelected ? 2 : 1,
                        opacity: isSelected || isHovered ? 0.9 : 0.45,
                        backgroundColor: isSelected ? `${item.color}1a` : "transparent",
                      }}
                      onMouseEnter={() => props.onHandleRectangleMouseEnter(item.shapeId)}
                      onMouseLeave={() => props.onHandleRectangleMouseLeave(item.shapeId)}
                      onMouseDown={(event) => props.onHandleMaskMouseDown(item.shapeId, event)}
                      onClick={(event) => {
                        event.stopPropagation()
                        props.onSetSelectedShapeId(item.shapeId)
                      }}
                    />
                  )
                })}
                {props.previewRect ? (
                  <div
                    className="absolute z-10 border-2 border-dashed"
                    style={{
                      left: props.previewRect.left,
                      top: props.previewRect.top,
                      width: props.previewRect.width,
                      height: props.previewRect.height,
                      borderColor: props.pendingRectColor,
                      borderLeftWidth: props.previewRect.clippedLeft ? 0 : 2,
                      borderTopWidth: props.previewRect.clippedTop ? 0 : 2,
                      borderRightWidth: props.previewRect.clippedRight ? 0 : 2,
                      borderBottomWidth: props.previewRect.clippedBottom ? 0 : 2,
                      backgroundColor: `${props.pendingRectColor}33`,
                    }}
                  />
                ) : null}
                {props.polygonDraftStagePoints.length >= 2 ? (
                  <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
                    <polyline
                      points={props.polygonDraftStagePoints.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                      fill="none"
                      stroke={props.pendingRectColor}
                      strokeDasharray="5 4"
                      strokeWidth={2}
                    />
                    {props.polygonDraftStagePoints.slice(0, -1).map((pt, index) => {
                      const isHovered = props.hoveredDraftVertexIndex === index
                      return (
                        <g key={`poly-draft-${index}`}>
                          {isHovered ? (
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r={8}
                              fill={`${props.pendingRectColor}22`}
                              stroke={props.pendingRectColor}
                              strokeWidth={1.5}
                            />
                          ) : null}
                          <circle cx={pt.x} cy={pt.y} r={isHovered ? 5 : 3.5} fill={props.pendingRectColor} stroke="#ffffff" strokeWidth={1} />
                        </g>
                      )
                    })}
                  </svg>
                ) : null}
                {props.canDrawMask && props.maskDraftStagePoints.length >= 1 ? (
                  <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
                    {props.maskDraftStagePoints.length === 1 ? (
                      <circle
                        cx={props.maskDraftStagePoints[0]?.x ?? 0}
                        cy={props.maskDraftStagePoints[0]?.y ?? 0}
                        r={Math.max(1, (props.maskBrushSize * props.imageScale) / 2)}
                        fill={props.maskDrawMode === "eraser" ? "#ef444433" : `${props.pendingRectColor}55`}
                        stroke={props.maskDrawMode === "eraser" ? "#ef4444" : props.pendingRectColor}
                        strokeWidth={1}
                      />
                    ) : (
                      <polyline
                        points={props.maskDraftStagePoints.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                        fill="none"
                        stroke={props.maskDrawMode === "eraser" ? "#ef4444" : props.pendingRectColor}
                        strokeWidth={Math.max(1, props.maskBrushSize * props.imageScale)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.75}
                      />
                    )}
                  </svg>
                ) : null}
                {props.canDrawMask && props.maskCursorStagePoint ? (
                  <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible">
                    <circle
                      cx={props.maskCursorStagePoint.x}
                      cy={props.maskCursorStagePoint.y}
                      r={Math.max(1, (props.maskBrushSize * props.imageScale) / 2)}
                      fill="transparent"
                      stroke={props.maskDrawMode === "eraser" ? "#ef4444" : props.pendingRectColor}
                      strokeWidth={1.5}
                      opacity={0.95}
                    />
                  </svg>
                ) : null}
                {props.canDrawBox3d && props.box3dDraftBaseStagePoints.length === 4 && props.box3dPreviewTopStagePoints.length === 4 ? (
                  <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
                    {(() => {
                      const f = props.box3dDraftBaseStagePoints
                      const k = props.box3dPreviewTopStagePoints
                      const kStr = k.map((pt) => `${pt.x},${pt.y}`).join(" ")
                      const { behind: draftBehind, front: draftFront } = cuboidWireframeEdgeSegmentsLayered(f, k)
                      return (
                        <g>
                          <polygon points={kStr} fill={`${props.pendingRectColor}18`} stroke={props.pendingRectColor} strokeWidth={1.5} strokeDasharray="4 3" />
                          {draftBehind.map(([p1, p2], j) => (
                            <line
                              key={`box3d-draft-b-${j}`}
                              x1={p1.x}
                              y1={p1.y}
                              x2={p2.x}
                              y2={p2.y}
                              stroke={props.pendingRectColor}
                              strokeWidth={1.5}
                              strokeDasharray="4 3"
                            />
                          ))}
                          {draftFront.map(([p1, p2], j) => (
                            <line
                              key={`box3d-draft-f-${j}`}
                              x1={p1.x}
                              y1={p1.y}
                              x2={p2.x}
                              y2={p2.y}
                              stroke="#ffffff"
                              strokeWidth={2.5}
                            />
                          ))}
                        </g>
                      )
                    })()}
                  </svg>
                ) : null}
                {props.selectedRect && !props.drawingLayerActive
                  ? ([
                      { id: "nw" as const, x: props.selectedRect.left, y: props.selectedRect.top },
                      { id: "ne" as const, x: props.selectedRect.left + props.selectedRect.width, y: props.selectedRect.top },
                      { id: "se" as const, x: props.selectedRect.left + props.selectedRect.width, y: props.selectedRect.top + props.selectedRect.height },
                      { id: "sw" as const, x: props.selectedRect.left, y: props.selectedRect.top + props.selectedRect.height },
                    ]).map((handle) => (
                      <button
                        key={handle.id}
                        type="button"
                        className="pointer-events-auto absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-emerald-500"
                        style={{ left: handle.x, top: handle.y, cursor: `${handle.id}-resize` }}
                        onMouseDown={(event) => props.onHandleRectResizeMouseDown(handle.id, event)}
                        aria-label={`调整矩形 ${handle.id}`}
                      />
                    ))
                  : null}
              </div>
              {props.drawingLayerActive ? (
                <div
                  className={`absolute inset-0 z-10 ${props.canDrawMask ? "cursor-none" : "cursor-crosshair"}`}
                  onMouseDown={props.canDrawMask ? props.onCreateMaskDraft : undefined}
                  onMouseMove={
                    props.canDrawMask
                      ? props.onAppendMaskDraftPoint
                      : props.canDrawPolygon
                        ? props.onHandlePolygonDrawMove
                        : props.canDrawBox3d
                          ? props.onHandleBox3dDrawMove
                          : props.canDrawSkeleton
                            ? undefined
                            : props.canDrawKeypoint
                              ? undefined
                              : props.onHandleRectDrawMove
                  }
                  onMouseUp={props.canDrawMask ? props.onCommitMaskStroke : undefined}
                  onMouseLeave={
                    props.canDrawMask
                      ? () => {
                          props.onCommitMaskStroke()
                          props.onClearMaskTransientState()
                        }
                      : undefined
                  }
                  onClick={
                    props.canDrawMask
                      ? undefined
                      : props.canDrawPolygon
                        ? props.onHandlePolygonDrawClick
                        : props.canDrawBox3d
                          ? props.onHandleBox3dDrawClick
                          : props.canDrawSkeleton
                            ? props.onHandleSkeletonDrawClick
                            : props.canDrawKeypoint
                              ? props.onHandleKeypointDrawClick
                              : props.onHandleRectDrawClick
                  }
                  onDoubleClick={props.canDrawMask ? undefined : props.canDrawPolygon ? props.onHandlePolygonDrawDoubleClick : undefined}
                />
              ) : null}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">图片加载失败或不存在</div>
          )}
        </div>
      )}
      <TaskToolPalette {...props.toolPaletteProps} />
      <TaskDrawHint {...props.drawHintProps} />
    </TaskCanvasLayer>
  )
}

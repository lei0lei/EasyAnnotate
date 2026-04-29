/**
 * 模块：project-task-detail/types
 * 职责：定义任务详情页共享类型（模式、渲染结构、拖拽动作）。
 * 边界：仅提供类型声明，不包含运行时逻辑。
 */
export type LeftPanelMode = "labels" | "attributes"
export type LabelsTab = "layers" | "classes"
export type RightToolMode = "select" | "rect" | "rotRect" | "circle" | "polygon" | "text" | "mask" | "keypoint" | "box3d" | "skeleton"

export type Point = { x: number; y: number }
export type ResizeHandle = "nw" | "ne" | "se" | "sw"

export type ShapeDragAction =
  | { kind: "move"; shapeIndex: number; start: Point; originalPoints: number[][]; shapeType?: "rectangle" | "mask" | "point" }
  | { kind: "resize"; shapeIndex: number; handle: ResizeHandle; start: Point; originalPoints: number[][] }

export type PolygonVertexDragAction = {
  shapeIndex: number
  vertexIndex: number
  /** cuboid2d 八点：按下时全点快照，用于角/边调整时保持前面轴对齐与固定前后平移 */
  cuboidVertexStartSnapshot?: number[][]
  /** 后面边上三控制点拖动：按下时指针（图像坐标） */
  cuboidPointerStart?: Point
}

export type PolygonDragAction = {
  shapeIndex: number
  start: Point
  originalPoints: number[][]
  /** cuboid2d：仅拖动后面四点平移；缺省为整体平移 */
  cuboidDragSubset?: "back"
}

export type RenderedRectangle = {
  index: number
  shapeId: string
  label: string
  color: string
  left: number
  top: number
  width: number
  height: number
  clippedLeft: boolean
  clippedTop: boolean
  clippedRight: boolean
  clippedBottom: boolean
}

export type RenderedRotationRect = {
  index: number
  shapeId: string
  label: string
  color: string
  imagePoints: [Point, Point, Point, Point]
  stagePoints: [Point, Point, Point, Point]
  centerImage: Point
  axisUImage: Point
  axisVImage: Point
  center: Point
  topMid: Point
  rotateHandle: Point
  boundLeft: number
  boundTop: number
  boundRight: number
  boundBottom: number
}

export type RenderedPolygon = {
  index: number
  shapeId: string
  label: string
  color: string
  stagePoints: Point[]
}

/** 关键点（X-Any `shape_type: "point"`），单点展示与交互 */
export type RenderedPoint = {
  index: number
  shapeId: string
  label: string
  color: string
  stagePoint: Point
}

/** 骨架（`shape_type: "skeleton"`）：关节 + 边 */
export type RenderedSkeleton = {
  index: number
  shapeId: string
  label: string
  color: string
  stagePoints: Point[]
  /** 顶点下标对，用于画连线 */
  edgeIndexPairs: [number, number][]
  pointLabels: string[]
}

export type RenderedMask = {
  index: number
  shapeId: string
  label: string
  color: string
  stagePoints: Point[]
  stageSegments: Point[][]
  brushSize: number
  left: number
  top: number
  width: number
  height: number
}

/**
 * 单图 3D 框投影：
 * - `usesExplicitQuadPair`: 8 点，前四后四为图像上两个四边形；
 * - 否则为旧格式：底面四点 + height_px 沿 -Y 挤出顶面。
 */
export type RenderedCuboid2d = {
  index: number
  shapeId: string
  label: string
  color: string
  heightPx: number
  usesExplicitQuadPair: boolean
  baseStagePoints: Point[]
  topStagePoints: Point[]
  left: number
  top: number
  width: number
  height: number
}

export type RotationDragAction = {
  shapeIndex: number
  center: Point
  startAngle: number
  originalPoints: number[][]
}

export type RotationTransformAction =
  | { kind: "move"; shapeIndex: number; start: Point; originalPoints: number[][] }
  | {
      kind: "resize"
      shapeIndex: number
      handle: ResizeHandle
      center: Point
      axisU: Point
      axisV: Point
    }

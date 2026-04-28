export type LeftPanelMode = "labels" | "attributes" | "raw"
export type LabelsTab = "layers" | "classes"
export type RightToolMode = "select" | "rect" | "rotRect" | "circle" | "polygon" | "text"

export type Point = { x: number; y: number }
export type ResizeHandle = "nw" | "ne" | "se" | "sw"

export type ShapeDragAction =
  | { kind: "move"; shapeIndex: number; start: Point; originalPoints: number[][] }
  | { kind: "resize"; shapeIndex: number; handle: ResizeHandle; start: Point; originalPoints: number[][] }

export type RenderedRectangle = {
  index: number
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

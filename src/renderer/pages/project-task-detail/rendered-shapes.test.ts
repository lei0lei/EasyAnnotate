import { describe, expect, it } from "vitest"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"
import { buildRenderedRectangles, buildRenderedRotationRects } from "./rendered-shapes"

const createDoc = (shapes: XAnyLabelFile["shapes"]): XAnyLabelFile => ({
  version: "2.5.4",
  flags: {},
  shapes,
  description: null,
  imagePath: "a.png",
  imageData: null,
  imageHeight: 100,
  imageWidth: 100,
})

describe("rendered shapes selectors", () => {
  it("buildRenderedRectangles should filter hidden and clip stage bounds", () => {
    const doc = createDoc([
      {
        label: "car",
        score: null,
        points: [
          [-10, -10],
          [30, -10],
          [30, 20],
          [-10, 20],
        ],
        group_id: null,
        description: null,
        difficult: false,
        shape_type: "rectangle",
        flags: null,
        attributes: {},
        kie_linking: [],
      },
      {
        label: "hidden",
        score: null,
        points: [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
        group_id: null,
        description: null,
        difficult: false,
        shape_type: "rectangle",
        flags: null,
        attributes: {},
        kie_linking: [],
      },
    ])
    const rendered = buildRenderedRectangles({
      annotationDoc: doc,
      hiddenShapeIndexes: [],
      hiddenClassLabels: ["hidden"],
      labelColorMap: new Map([["car", "#123456"]]),
      imageToStage: (point) => point,
      stageWidth: 20,
      stageHeight: 10,
    })
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toMatchObject({
      label: "car",
      color: "#123456",
      left: 0,
      top: 0,
      width: 20,
      height: 10,
      clippedLeft: true,
      clippedTop: true,
      clippedRight: true,
      clippedBottom: true,
    })
  })

  it("buildRenderedRotationRects should project 4 points and handle", () => {
    const doc = createDoc([
      {
        label: "rot",
        score: null,
        points: [
          [0, 0],
          [10, 0],
          [10, 6],
          [0, 6],
        ],
        group_id: null,
        description: null,
        difficult: false,
        shape_type: "rotation",
        flags: null,
        attributes: {},
        kie_linking: [],
      },
    ])
    const rendered = buildRenderedRotationRects({
      annotationDoc: doc,
      hiddenShapeIndexes: [],
      hiddenClassLabels: [],
      labelColorMap: new Map(),
      imageToStage: (point) => ({ x: point.x * 2, y: point.y * 2 }),
    })
    expect(rendered).toHaveLength(1)
    expect(rendered[0].centerImage).toEqual({ x: 5, y: 3 })
    expect(rendered[0].center).toEqual({ x: 10, y: 6 })
    expect(rendered[0].boundLeft).toBe(0)
    expect(rendered[0].boundRight).toBe(20)
    expect(rendered[0].rotateHandle.y).toBeLessThan(rendered[0].topMid.y)
  })
})

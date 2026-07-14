import { describe, expect, it } from "vitest"
import { stripDeletedLabelsFromJsonText } from "./project-tag-annotation-cleanup"

describe("stripDeletedLabelsFromJsonText", () => {
  it("removes shapes with deleted labels and preserves other fields", () => {
    const raw = JSON.stringify(
      {
        version: "2.5.4",
        imageWidth: 640,
        imageHeight: 480,
        imageData: "keep-me",
        shapes: [
          { label: "cat", points: [[0, 0], [1, 1]], shape_type: "rectangle" },
          { label: "dog", points: [[2, 2], [3, 3]], shape_type: "rectangle" },
        ],
      },
      null,
      2,
    )

    const result = stripDeletedLabelsFromJsonText(raw, new Set(["cat"]))
    expect(result.changed).toBe(true)

    const parsed = JSON.parse(result.nextJsonText) as {
      imageData: string
      shapes: Array<{ label: string }>
    }
    expect(parsed.imageData).toBe("keep-me")
    expect(parsed.shapes.map((s) => s.label)).toEqual(["dog"])
  })

  it("returns unchanged when no shapes match deleted labels", () => {
    const raw = JSON.stringify({
      shapes: [{ label: "cat", points: [[0, 0]], shape_type: "point" }],
    })
    const result = stripDeletedLabelsFromJsonText(raw, new Set(["dog"]))
    expect(result.changed).toBe(false)
    expect(result.nextJsonText).toBe(raw)
  })
})

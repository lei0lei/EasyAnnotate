import { describe, expect, it } from "vitest"
import { formatPositionText } from "./use-shape-management"

describe("use-shape-management helpers", () => {
  it("formats point with integer rounding", () => {
    expect(formatPositionText([10.4, 20.6])).toBe("10,21")
  })

  it("falls back to zero pair for invalid points", () => {
    expect(formatPositionText(undefined)).toBe("0,0")
    expect(formatPositionText([1])).toBe("0,0")
  })
})

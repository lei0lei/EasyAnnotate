import { describe, expect, it } from "vitest"
import {
  fileNameFromPath,
  formatBytes,
  guessMimeType,
  normalizeTagColor,
  resolveTaskImagePath,
  rotatePoint,
  roundPointsToInt,
  sanitizeSegment,
} from "./utils"
import type { ProjectItem, TaskFileItem } from "../../lib/projects-api"

describe("project-task-detail utils", () => {
  it("roundPointsToInt should round x/y values", () => {
    expect(
      roundPointsToInt([
        [1.2, 3.8],
        [9.5, 4.4],
      ]),
    ).toEqual([
      [1, 4],
      [10, 4],
    ])
  })

  it("rotatePoint should rotate around center", () => {
    const rotated = rotatePoint({ x: 2, y: 0 }, { x: 0, y: 0 }, Math.PI / 2)
    expect(rotated.x).toBeCloseTo(0, 6)
    expect(rotated.y).toBeCloseTo(2, 6)
  })

  it("resolveTaskImagePath should build task data path", () => {
    const project: ProjectItem = {
      id: "p1",
      name: "demo",
      projectInfo: "",
      projectType: "",
      storageType: "local",
      localPath: "D:\\dataset\\proj",
      remoteIp: "",
      remotePort: "",
      updatedAt: "",
      configFilePath: "D:\\dataset\\proj\\project.yaml",
      tags: [],
    }
    const file: TaskFileItem = {
      id: "f1",
      projectId: "p1",
      taskId: "taskA",
      subset: "train/set",
      filePath: "C:\\tmp\\dog.png",
      createdAt: "",
    }
    expect(resolveTaskImagePath(project, "taskA", file)).toBe("D:\\dataset\\proj\\data\\tasks\\taskA\\train_set\\dog.png")
  })

  it("normalizers should return defaults when invalid", () => {
    expect(normalizeTagColor("not-hex")).toBe("#f59e0b")
    expect(sanitizeSegment("")).toBe("default")
    expect(fileNameFromPath("a/b/c.jpg")).toBe("c.jpg")
  })

  it("formatBytes and guessMimeType should map correctly", () => {
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(guessMimeType("a.JPG")).toBe("image/jpeg")
    expect(guessMimeType("x.unknown")).toBe("application/octet-stream")
  })
})

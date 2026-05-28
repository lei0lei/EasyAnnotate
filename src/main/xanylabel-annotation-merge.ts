import fs from "node:fs"
import path from "node:path"

type XAnyLabelShape = {
  label: string
  score: number | null
  points: number[][]
  group_id: number | null
  description: string | null
  difficult: boolean
  shape_type: string
  flags: Record<string, unknown> | null
  attributes: Record<string, unknown>
  kie_linking: unknown[]
}

type XAnyLabelFile = {
  version: string
  flags: Record<string, unknown>
  shapes: XAnyLabelShape[]
  description: string | null
  imagePath: string
  imageData: string | null
  imageHeight: number
  imageWidth: number
}

const ALLOWED_SHAPE_TYPES = new Set([
  "rectangle",
  "rotation",
  "polygon",
  "point",
  "line",
  "linestrip",
  "circle",
  "cuboid2d",
  "skeleton",
])

function normalizePositiveDimension(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return rounded > 0 ? rounded : fallback
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

function createTemplate(imagePath: string, imageWidth: number, imageHeight: number): XAnyLabelFile {
  return {
    version: "2.5.4",
    flags: {},
    shapes: [],
    description: null,
    imagePath: fileNameFromPath(imagePath),
    imageData: null,
    imageHeight,
    imageWidth,
  }
}

function normalizeShape(input: unknown): XAnyLabelShape | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = input as Partial<XAnyLabelShape>
  if (typeof value.label !== "string") return undefined
  if (!Array.isArray(value.points)) return undefined
  if (typeof value.shape_type !== "string") return undefined
  const shapeType = value.shape_type.trim()
  if (!ALLOWED_SHAPE_TYPES.has(shapeType)) return undefined
  return {
    label: value.label,
    score: typeof value.score === "number" ? value.score : null,
    points: value.points
      .map((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) return undefined
        const x = Number(pt[0])
        const y = Number(pt[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
        return [Math.round(x), Math.round(y)]
      })
      .filter((pt): pt is number[] => !!pt),
    group_id: typeof value.group_id === "number" ? value.group_id : null,
    description: typeof value.description === "string" ? value.description : null,
    difficult: value.difficult === true,
    shape_type: shapeType,
    flags: value.flags && typeof value.flags === "object" ? (value.flags as Record<string, unknown>) : null,
    attributes:
      value.attributes && typeof value.attributes === "object" ? (value.attributes as Record<string, unknown>) : {},
    kie_linking: Array.isArray(value.kie_linking) ? value.kie_linking : [],
  }
}

function loadDoc(jsonPath: string, imagePath: string, imageWidth: number, imageHeight: number): XAnyLabelFile {
  const fallback = createTemplate(imagePath, imageWidth, imageHeight)
  if (!fs.existsSync(jsonPath)) return fallback
  try {
    const raw = fs.readFileSync(jsonPath, "utf8")
    if (!raw.trim()) return fallback
    const parsed = JSON.parse(raw) as Partial<XAnyLabelFile>
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback
    return {
      version: typeof parsed.version === "string" ? parsed.version : fallback.version,
      flags: parsed.flags && typeof parsed.flags === "object" ? (parsed.flags as Record<string, unknown>) : {},
      shapes: Array.isArray(parsed.shapes)
        ? parsed.shapes.map(normalizeShape).filter((item): item is XAnyLabelShape => !!item)
        : [],
      description: typeof parsed.description === "string" || parsed.description === null ? parsed.description : null,
      imagePath:
        typeof parsed.imagePath === "string" && parsed.imagePath.trim() ? parsed.imagePath : fallback.imagePath,
      imageData: typeof parsed.imageData === "string" ? parsed.imageData : null,
      imageHeight: normalizePositiveDimension(parsed.imageHeight, fallback.imageHeight),
      imageWidth: normalizePositiveDimension(parsed.imageWidth, fallback.imageWidth),
    }
  } catch {
    return fallback
  }
}

export function appendShapesToAnnotationJsonFile(payload: {
  jsonPath: string
  imagePath: string
  imageWidth: number
  imageHeight: number
  shapesJson: string
}): { jsonPath: string; errorMessage: string } {
  const { jsonPath, imagePath, imageWidth, imageHeight, shapesJson } = payload
  let incoming: unknown[] = []
  try {
    const parsed = JSON.parse(shapesJson || "[]")
    if (!Array.isArray(parsed)) {
      return { jsonPath: "", errorMessage: "shapes_json 必须是 JSON 数组。" }
    }
    incoming = parsed
  } catch {
    return { jsonPath: "", errorMessage: "shapes_json 解析失败。" }
  }

  const doc = loadDoc(jsonPath, imagePath, imageWidth, imageHeight)
  const appended = incoming.map(normalizeShape).filter((item): item is XAnyLabelShape => !!item)
  doc.shapes = [...doc.shapes, ...appended]
  doc.imageWidth = imageWidth
  doc.imageHeight = imageHeight

  try {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, JSON.stringify(doc), "utf8")
    return { jsonPath, errorMessage: "" }
  } catch (error) {
    return {
      jsonPath: "",
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

type XAnyLabelShapeType =
  | "rectangle"
  | "rotation"
  | "polygon"
  | "point"
  | "mask"
  | "line"
  | "linestrip"
  | "circle"
  /** 单图伪 3D：8 点为前后面各四顶点；或旧格式底面四点 + attributes.height_px 沿 -Y 挤出顶面 */
  | "cuboid2d"
  /** 骨架：points 与项目标签中 skeleton 模板关节顺序一致；attributes.skeleton 存边索引对 */
  | "skeleton"

export type XAnyLabelShape = {
  label: string
  score: number | null
  points: number[][]
  group_id: number | null
  description: string | null
  difficult: boolean
  shape_type: XAnyLabelShapeType
  flags: Record<string, unknown> | null
  attributes: Record<string, unknown>
  kie_linking: unknown[]
}

export type XAnyLabelFile = {
  version: string
  flags: Record<string, unknown>
  shapes: XAnyLabelShape[]
  description: string | null
  imagePath: string
  imageData: string | null
  imageHeight: number
  imageWidth: number
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

export function createXAnyLabelTemplate(payload: {
  imagePath: string
  imageWidth: number
  imageHeight: number
}): XAnyLabelFile {
  return {
    version: "2.5.4",
    flags: {},
    shapes: [],
    description: null,
    imagePath: fileNameFromPath(payload.imagePath),
    imageData: null,
    imageHeight: payload.imageHeight,
    imageWidth: payload.imageWidth,
  }
}

function normalizeShape(input: unknown): XAnyLabelShape | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = input as Partial<XAnyLabelShape>
  if (typeof value.label !== "string") return undefined
  if (!Array.isArray(value.points)) return undefined
  if (typeof value.shape_type !== "string") return undefined
  return {
    label: value.label,
    score: typeof value.score === "number" ? value.score : null,
    points: value.points
      .map((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) return undefined
        const x = Number(pt[0])
        const y = Number(pt[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
        return [x, y]
      })
      .filter((pt): pt is number[] => !!pt),
    group_id: typeof value.group_id === "number" ? value.group_id : null,
    description: typeof value.description === "string" ? value.description : null,
    difficult: value.difficult === true,
    shape_type: value.shape_type as XAnyLabelShape["shape_type"],
    flags: value.flags && typeof value.flags === "object" ? (value.flags as Record<string, unknown>) : null,
    attributes: value.attributes && typeof value.attributes === "object" ? (value.attributes as Record<string, unknown>) : {},
    kie_linking: Array.isArray(value.kie_linking) ? value.kie_linking : [],
  }
}

export function normalizeXAnyLabelDoc(payload: {
  imagePath: string
  imageWidth: number
  imageHeight: number
  rawJsonText: string
}): XAnyLabelFile {
  const fallback = createXAnyLabelTemplate({
    imagePath: payload.imagePath,
    imageWidth: payload.imageWidth,
    imageHeight: payload.imageHeight,
  })
  if (!payload.rawJsonText.trim()) return fallback
  try {
    const parsed = JSON.parse(payload.rawJsonText) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback
    const obj = parsed as Partial<XAnyLabelFile>
    return {
      version: typeof obj.version === "string" ? obj.version : fallback.version,
      flags: obj.flags && typeof obj.flags === "object" ? (obj.flags as Record<string, unknown>) : {},
      shapes: Array.isArray(obj.shapes) ? obj.shapes.map(normalizeShape).filter((item): item is XAnyLabelShape => !!item) : [],
      description: typeof obj.description === "string" || obj.description === null ? obj.description : null,
      imagePath: typeof obj.imagePath === "string" && obj.imagePath.trim() ? obj.imagePath : fallback.imagePath,
      imageData: typeof obj.imageData === "string" ? obj.imageData : null,
      imageHeight: typeof obj.imageHeight === "number" && Number.isFinite(obj.imageHeight) ? obj.imageHeight : fallback.imageHeight,
      imageWidth: typeof obj.imageWidth === "number" && Number.isFinite(obj.imageWidth) ? obj.imageWidth : fallback.imageWidth,
    }
  } catch {
    return fallback
  }
}

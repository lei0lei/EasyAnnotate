import type { XAnyLabelFile, XAnyLabelShape } from "@/lib/xanylabeling-format"

const SHAPE_ID_ATTR_KEY = "__eaShapeId"

export function readShapeStableId(shape: XAnyLabelShape): string | null {
  const value = shape.attributes?.[SHAPE_ID_ATTR_KEY]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function createShapeStableId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function withShapeStableId(shape: XAnyLabelShape, stableId?: string): XAnyLabelShape {
  const current = readShapeStableId(shape)
  if (current) return shape
  return {
    ...shape,
    attributes: {
      ...shape.attributes,
      [SHAPE_ID_ATTR_KEY]: stableId ?? createShapeStableId(),
    },
  }
}

export function ensureDocHasStableShapeIds(doc: XAnyLabelFile | null): XAnyLabelFile | null {
  if (!doc) return doc
  let changed = false
  const nextShapes = doc.shapes.map((shape) => {
    if (readShapeStableId(shape)) return shape
    changed = true
    return withShapeStableId(shape)
  })
  if (!changed) return doc
  return { ...doc, shapes: nextShapes }
}

export function getShapeStableId(shape: XAnyLabelShape, fallbackIndex: number): string {
  return readShapeStableId(shape) ?? `shape-${fallbackIndex}`
}

export function getShapeStableIdAtIndex(doc: XAnyLabelFile | null, index: number | null): string | null {
  if (!doc || index === null || index < 0 || index >= doc.shapes.length) return null
  return getShapeStableId(doc.shapes[index]!, index)
}

export function findShapeIndexByStableId(doc: XAnyLabelFile | null, stableId: string | null): number | null {
  if (!doc || !stableId) return null
  const nextIndex = doc.shapes.findIndex((shape, index) => getShapeStableId(shape, index) === stableId)
  return nextIndex >= 0 ? nextIndex : null
}

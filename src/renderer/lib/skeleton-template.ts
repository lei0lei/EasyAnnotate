/**
 * 模块：lib/skeleton-template
 * 职责：项目级骨架标签模板规格（点 + 边，与 CVAT「Setup skeleton」结构对应）。
 * 边界：存盘为 JSON 子结构；坐标为画板内归一化 0~1，便于在任意图像上比例还原。
 */
export const SKELETON_TEMPLATE_VERSION = 1 as const

export type SkeletonTemplatePoint = {
  id: string
  /** 显示用关节名，如 head、left_ankle */
  label: string
  /** 0~1，相对模板画板 */
  x: number
  y: number
}

export type SkeletonTemplateEdge = {
  from: string
  to: string
}

export type SkeletonTemplateSpec = {
  version: typeof SKELETON_TEMPLATE_VERSION
  points: SkeletonTemplatePoint[]
  edges: SkeletonTemplateEdge[]
}

export function createEmptySkeletonTemplate(): SkeletonTemplateSpec {
  return { version: SKELETON_TEMPLATE_VERSION, points: [], edges: [] }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function normalizeId(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim()
  return fallback
}

function normalizeLabel(raw: unknown, index: number): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 32)
  return `p${index + 1}`
}

export function normalizeSkeletonTemplateSpec(raw: unknown): SkeletonTemplateSpec {
  if (typeof raw !== "object" || raw === null) {
    return createEmptySkeletonTemplate()
  }
  const o = raw as { points?: unknown; edges?: unknown }
  const pointList = Array.isArray(o.points) ? o.points : []
  const points: SkeletonTemplatePoint[] = pointList
    .map((item, index) => {
      if (typeof item !== "object" || item === null) return null
      const p = item as { id?: unknown; label?: unknown; x?: unknown; y?: unknown }
      const id = normalizeId(p.id, `p_${index + 1}_${Date.now()}`)
      return {
        id,
        label: normalizeLabel(p.label, index),
        x: clamp01(Number(p.x)),
        y: clamp01(Number(p.y)),
      }
    })
    .filter((x): x is SkeletonTemplatePoint => x !== null)

  /** 修复重复 id */
  const seen = new Set<string>()
  for (const pt of points) {
    let k = pt.id
    let n = 0
    while (seen.has(k)) {
      n += 1
      k = `${pt.id}_${n}`
    }
    seen.add(k)
    pt.id = k
  }

  const idSet = new Set(points.map((p) => p.id))
  const edgeList = Array.isArray(o.edges) ? o.edges : []
  const edges: SkeletonTemplateEdge[] = []
  const edgeKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`)
  const edgeSeen = new Set<string>()

  for (const item of edgeList) {
    if (typeof item !== "object" || item === null) continue
    const e = item as { from?: unknown; to?: unknown }
    const from = typeof e.from === "string" ? e.from.trim() : ""
    const to = typeof e.to === "string" ? e.to.trim() : ""
    if (!from || !to || from === to) continue
    if (!idSet.has(from) || !idSet.has(to)) continue
    const k = edgeKey(from, to)
    if (edgeSeen.has(k)) continue
    edgeSeen.add(k)
    edges.push({ from, to })
  }

  return { version: SKELETON_TEMPLATE_VERSION, points, edges }
}

export function isPlainProjectTag(
  t: { kind?: string; skeletonTemplate?: unknown },
): t is { name: string; color: string; kind?: "plain" } {
  return t.kind !== "skeleton"
}

export function isSkeletonProjectTag(
  t: { kind?: string; skeletonTemplate?: unknown },
): t is { name: string; color: string; kind: "skeleton"; skeletonTemplate: SkeletonTemplateSpec } {
  return t.kind === "skeleton" && t.skeletonTemplate != null
}

function sortedEdgesForKey(edges: SkeletonTemplateEdge[]): string {
  return [...edges]
    .map((e) => (e.from < e.to ? [e.from, e.to] : [e.to, e.from]) as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    .map((e) => `${e[0]}|${e[1]}`)
    .join("\n")
}

function sortedPointsKey(points: SkeletonTemplatePoint[]): string {
  return [...points]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id}:${p.label}:${p.x}:${p.y}`)
    .join("\n")
}

/** 随 shape 存盘：与 points 同序的边（下标对） */
export type SkeletonInstanceAttrV1 = {
  version: 1
  pointIds: string[]
  /** 每条边连接 points[i] 与 points[j] */
  edges: [number, number][]
}

/**
 * 将模板（0~1 画板）按首次落点摆到图像上：质心对齐 click，按模板外接框比例缩放。
 */
export function placeSkeletonImagePoints(
  template: SkeletonTemplateSpec,
  clickImage: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
): number[][] {
  const pts = template.points
  if (pts.length === 0) return []
  const ax = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const ay = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.01)
  const scale = (0.22 * Math.min(imageWidth, imageHeight)) / ext
  const out: number[][] = []
  for (const p of pts) {
    const ix = clickImage.x + (p.x - ax) * scale
    const iy = clickImage.y + (p.y - ay) * scale
    out.push([
      Math.max(0, Math.min(imageWidth, Math.round(ix))),
      Math.max(0, Math.min(imageHeight, Math.round(iy))),
    ])
  }
  return out
}

export function buildSkeletonInstanceAttributes(template: SkeletonTemplateSpec): { skeleton: SkeletonInstanceAttrV1 } {
  const idToIndex = new Map(template.points.map((p, i) => [p.id, i] as const))
  const edges: [number, number][] = []
  for (const e of template.edges) {
    const a = idToIndex.get(e.from)
    const b = idToIndex.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    edges.push(a < b ? [a, b] : [b, a])
  }
  return {
    skeleton: {
      version: 1,
      pointIds: template.points.map((p) => p.id),
      edges,
    },
  }
}

/** 用于未保存比较 */
export function skeletonTemplateSpecEqual(a: SkeletonTemplateSpec, b: SkeletonTemplateSpec): boolean {
  if (a.points.length !== b.points.length || a.edges.length !== b.edges.length) return false
  if (sortedPointsKey(a.points) !== sortedPointsKey(b.points)) return false
  return sortedEdgesForKey(a.edges) === sortedEdgesForKey(b.edges)
}


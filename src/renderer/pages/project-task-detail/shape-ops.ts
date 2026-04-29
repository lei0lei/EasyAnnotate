/**
 * 模块：project-task-detail/shape-ops
 * 职责：提供 shape 层级重排与索引重映射的纯函数工具。
 * 边界：只处理集合顺序计算，不管理 UI 选中态。
 */
export type LayerReorderMode = "forward" | "backward" | "front" | "back"

export function resolveReorderTargetIndex(shapeIndex: number, total: number, mode: LayerReorderMode): number {
  if (total <= 1) return shapeIndex
  if (mode === "forward") return Math.min(total - 1, shapeIndex + 1)
  if (mode === "backward") return Math.max(0, shapeIndex - 1)
  if (mode === "front") return total - 1
  return 0
}

export function remapIndexAfterReorder(index: number, shapeIndex: number, targetIndex: number): number {
  if (shapeIndex < targetIndex) {
    if (index === shapeIndex) return targetIndex
    if (index > shapeIndex && index <= targetIndex) return index - 1
    return index
  }
  if (index === shapeIndex) return targetIndex
  if (index >= targetIndex && index < shapeIndex) return index + 1
  return index
}

export function reorderItemsByIndex<T>(items: T[], fromIndex: number, targetIndex: number): T[] {
  if (fromIndex === targetIndex || fromIndex < 0 || targetIndex < 0 || fromIndex >= items.length || targetIndex >= items.length) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

export function remapIndexAfterDelete(index: number, deletedIndex: number): number | null {
  if (index === deletedIndex) return null
  if (index > deletedIndex) return index - 1
  return index
}

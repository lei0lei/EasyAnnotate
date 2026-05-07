import { loadAppConfig } from "@/lib/app-config-storage"

/** 应用级快捷键：设置页与标注页等处共用 id / 默认键位 */
export const APP_SHORTCUT_ROWS: { id: string; label: string; defaultBinding: string }[] = [
  { id: "img-prev", label: "上一张", defaultBinding: "A 或 ←" },
  { id: "img-next", label: "下一张", defaultBinding: "D 或 →" },
  { id: "select-tool", label: "切换选择模式", defaultBinding: "Escape" },
  { id: "del", label: "删除选中标注", defaultBinding: "Delete" },
  { id: "undo", label: "撤销", defaultBinding: "Ctrl + Z" },
  { id: "redo", label: "重做", defaultBinding: "Ctrl + Y" },
  { id: "new-annotation", label: "新建标注", defaultBinding: "N" },
]

export function getDefaultShortcutBinding(id: string): string {
  return APP_SHORTCUT_ROWS.find((r) => r.id === id)?.defaultBinding ?? ""
}

/** 用户覆盖优先，否则默认；与设置页「与默认相同则存空串」一致 */
export function getEffectiveShortcutBinding(id: string): string {
  const def = getDefaultShortcutBinding(id)
  const custom = loadAppConfig().shortcuts[id]
  if (typeof custom === "string" && custom.trim()) return custom.trim()
  return def
}

/** 由设置页 draft 生成写入 app-config 的 shortcuts 补丁（与默认相同则空串） */
export function buildShortcutsPersistPatch(draft: Record<string, string>): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const row of APP_SHORTCUT_ROWS) {
    const value = (draft[row.id] ?? "").trim()
    patch[row.id] = value && value !== row.defaultBinding ? value : ""
  }
  return patch
}

/**
 * 模块：main/project-tag-ipc
 * 职责：在 IPC 的 protobuf ProjectTag 与磁盘用的 ProjectTagRecord 之间做字段映射。
 */
import type { ProjectTag } from "./gen/app"
import type { ProjectTagRecord } from "./project-storage"

export function projectTagRecordsToProto(tags: ProjectTagRecord[]): ProjectTag[] {
  return tags.map((t) => {
    if (t.kind === "skeleton" && t.skeletonTemplate) {
      const st = t.skeletonTemplate
      return {
        name: t.name,
        color: t.color,
        kind: "skeleton",
        skeletonTemplate: {
          version: st.version,
          points: st.points.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y })),
          edges: st.edges.map((e) => ({ from: e.from, to: e.to })),
        },
      }
    }
    return {
      name: t.name,
      color: t.color,
      kind: "",
      skeletonTemplate: undefined,
    }
  })
}

export function protoProjectTagsToRecords(tags: ProjectTag[]): ProjectTagRecord[] {
  return tags.map((t) => {
    const kind = typeof t.kind === "string" && t.kind.trim() === "skeleton" ? "skeleton" : "plain"
    if (kind === "skeleton" && t.skeletonTemplate) {
      const st = t.skeletonTemplate
      return {
        name: t.name,
        color: t.color,
        kind: "skeleton",
        skeletonTemplate: {
          version: 1,
          points: st.points.map((p) => ({
            id: p.id,
            label: p.label,
            x: p.x,
            y: p.y,
          })),
          edges: st.edges.map((e) => ({ from: e.from, to: e.to })),
        },
      }
    }
    return { name: t.name, color: t.color, kind: "plain" }
  })
}

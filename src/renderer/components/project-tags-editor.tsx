import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SkeletonTemplateEditorDialog } from "@/components/skeleton-template-editor-dialog"
import type { ProjectTag } from "@/lib/projects-api"
import { createEmptySkeletonTemplate, normalizeSkeletonTemplateSpec, type SkeletonTemplateSpec } from "@/lib/skeleton-template"
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Tag, X, Workflow } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

type ProjectTagsEditorProps = {
  title?: string
  tags: ProjectTag[]
  onChange: (nextTags: ProjectTag[]) => void
  inputPlaceholder?: string
  emptyText?: string
}

const TAG_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"]

function normalizeColor(raw: string): string {
  const value = raw.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(value) ? value : "#22c55e"
}

function toPlainOrSkeletonTag(item: {
  name: string
  color: string
  addKind: "plain" | "skeleton"
}): ProjectTag {
  if (item.addKind === "skeleton") {
    return {
      name: item.name,
      color: item.color,
      kind: "skeleton",
      skeletonTemplate: createEmptySkeletonTemplate(),
    }
  }
  return { name: item.name, color: item.color, kind: "plain" }
}

export function ProjectTagsEditor({
  title = "标签编辑",
  tags,
  onChange,
  inputPlaceholder = "输入名称后回车或点添加",
  emptyText = "暂无标签",
}: ProjectTagsEditorProps) {
  const [newTag, setNewTag] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)
  const [editingTagName, setEditingTagName] = useState<string | null>(null)
  const [editingTagValue, setEditingTagValue] = useState("")
  const [templateFor, setTemplateFor] = useState<ProjectTag | null>(null)

  const initialTemplate = useMemo(() => {
    if (!templateFor || templateFor.kind !== "skeleton" || !templateFor.skeletonTemplate) {
      return createEmptySkeletonTemplate()
    }
    return normalizeSkeletonTemplateSpec(templateFor.skeletonTemplate)
  }, [templateFor])

  function tryAddWithKind(addKind: "plain" | "skeleton", e?: FormEvent) {
    e?.preventDefault()
    const value = newTag.trim()
    if (!value) {
      setFeedback("名称不能为空")
      return
    }
    if (tags.some((item) => item.name === value)) {
      setFeedback("名称已存在")
      return
    }
    const color = TAG_COLORS[tags.length % TAG_COLORS.length]
    onChange([...tags, toPlainOrSkeletonTag({ name: value, color, addKind })])
    setNewTag("")
    setFeedback(null)
  }

  function handleAddTag(e: FormEvent) {
    tryAddWithKind("plain", e)
  }

  function handleAddSkeletonTag() {
    tryAddWithKind("skeleton")
  }

  function handleRemoveTag(tagName: string) {
    onChange(tags.filter((item) => item.name !== tagName))
    setFeedback(null)
    if (editingTagName === tagName) {
      setEditingTagName(null)
      setEditingTagValue("")
    }
    if (templateFor?.name === tagName) setTemplateFor(null)
  }

  function handleColorChange(tagName: string, nextColor: string) {
    const normalized = normalizeColor(nextColor)
    onChange(tags.map((item) => (item.name === tagName ? { ...item, color: normalized } : item)))
  }

  function startEditTag(tagName: string) {
    setEditingTagName(tagName)
    setEditingTagValue(tagName)
    setFeedback(null)
  }

  function cancelEditTag() {
    setEditingTagName(null)
    setEditingTagValue("")
  }

  function saveEditTag(tagName: string) {
    const nextName = editingTagValue.trim()
    if (!nextName) {
      setFeedback("名称不能为空")
      return
    }
    if (nextName !== tagName && tags.some((item) => item.name === nextName)) {
      setFeedback("名称已存在")
      return
    }
    onChange(
      tags.map((item) => (item.name === tagName ? { ...item, name: nextName } : item)),
    )
    if (templateFor?.name === tagName) {
      setTemplateFor((t) => (t ? { ...t, name: nextName } : null))
    }
    setEditingTagName(null)
    setEditingTagValue("")
    setFeedback(null)
  }

  function handleMoveTag(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= tags.length) return
    const next = [...tags]
    const [current] = next.splice(index, 1)
    next.splice(nextIndex, 0, current)
    onChange(next)
  }

  function saveTemplate(next: SkeletonTemplateSpec) {
    if (!templateFor) return
    const n = next.points.length
    if (n < 1) {
      setFeedback("请至少添加一个关节点再保存")
      return
    }
    const normalized = normalizeSkeletonTemplateSpec(next)
    onChange(
      tags.map((t) =>
        t.name === templateFor.name && t.kind === "skeleton" ? { ...t, kind: "skeleton", skeletonTemplate: normalized } : t,
      ),
    )
    setTemplateFor((prev) => (prev ? { ...prev, skeletonTemplate: normalized } : null))
    setFeedback(null)
  }

  function tryRenameFromSkeletonDialog(currentName: string, next: string): boolean {
    const t = next.trim()
    if (!t) {
      setFeedback("名称不能为空")
      return false
    }
    if (t !== currentName && tags.some((x) => x.name === t)) {
      setFeedback("名称已存在")
      return false
    }
    onChange(
      tags.map((item) => (item.name === currentName && item.kind === "skeleton" ? { ...item, name: t } : item)),
    )
    setTemplateFor((prev) => (prev && prev.name === currentName ? { ...prev, name: t } : prev))
    setFeedback(null)
    if (editingTagName === currentName) {
      setEditingTagName(t)
      setEditingTagValue((v) => (v === currentName ? t : v))
    }
    return true
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
        <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={handleAddTag}>
        <Input
          value={newTag}
          onChange={(e) => {
            setNewTag(e.target.value)
            if (feedback) setFeedback(null)
          }}
          placeholder={inputPlaceholder}
          className="w-full sm:w-72"
          spellCheck={false}
        />
        <Button type="submit" variant="outline" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          添加标签
        </Button>
        <Button type="button" variant="outline" className="gap-1.5" onClick={handleAddSkeletonTag}>
          <Workflow className="h-3.5 w-3.5" aria-hidden />
          添加骨干标签
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">{emptyText}</span>
        ) : (
          tags.map((tag, index) => {
            const isSkel = tag.kind === "skeleton"
            return (
              <div
                key={tag.name}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
              >
                <label
                  className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-border bg-background"
                  aria-label={`设置标签 ${tag.name} 颜色`}
                  title={`设置颜色：${tag.name}`}
                >
                  <input
                    type="color"
                    value={normalizeColor(tag.color)}
                    onChange={(e) => handleColorChange(tag.name, e.target.value)}
                    className="h-0 w-0 opacity-0"
                  />
                  <span className="h-3 w-3 rounded-full border border-white/40" style={{ backgroundColor: normalizeColor(tag.color) }} />
                </label>
                {isSkel ? (
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    title="骨架标签"
                    aria-label="骨架标签"
                  >
                    <Workflow className="h-3 w-3 shrink-0" aria-hidden />
                  </span>
                ) : null}
                <div className="inline-flex items-center gap-1">
                  {editingTagName === tag.name && !isSkel ? (
                    <>
                      <Input
                        value={editingTagValue}
                        onChange={(e) => setEditingTagValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            saveEditTag(tag.name)
                          } else if (e.key === "Escape") {
                            e.preventDefault()
                            cancelEditTag()
                          }
                        }}
                        className="h-6 w-28 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
                        spellCheck={false}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-accent"
                        aria-label={`保存名称 ${tag.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          saveEditTag(tag.name)
                        }}
                      >
                        <Check className="h-3 w-3 text-muted-foreground" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-accent"
                        aria-label="取消"
                        onClick={(e) => {
                          e.stopPropagation()
                          cancelEditTag()
                        }}
                      >
                        <X className="h-3 w-3 text-muted-foreground" aria-hidden />
                      </button>
                    </>
                  ) : (
                    <>
                      {tag.name}
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-accent"
                        aria-label={isSkel ? `编辑骨架模板 ${tag.name}` : `编辑名称 ${tag.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isSkel) {
                            setTemplateFor({
                              ...tag,
                              kind: "skeleton",
                              skeletonTemplate: tag.skeletonTemplate ?? createEmptySkeletonTemplate(),
                            })
                          } else {
                            startEditTag(tag.name)
                          }
                        }}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-accent"
                        aria-label={`删除 ${tag.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTag(tag.name)
                        }}
                      >
                        <X className="h-3 w-3 text-muted-foreground" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-accent disabled:opacity-40"
                        aria-label="上移"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMoveTag(index, -1)
                        }}
                      >
                        <ArrowUp className="h-3 w-3 text-muted-foreground" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-accent disabled:opacity-40"
                        aria-label="下移"
                        disabled={index === tags.length - 1}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMoveTag(index, 1)
                        }}
                      >
                        <ArrowDown className="h-3 w-3 text-muted-foreground" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
      {feedback ? <p className="text-xs text-destructive">{feedback}</p> : null}

      <SkeletonTemplateEditorDialog
        open={!!templateFor}
        title={templateFor?.name ?? ""}
        initial={initialTemplate}
        onOpenChange={(open) => {
          if (!open) setTemplateFor(null)
        }}
        onSave={saveTemplate}
        onTagNameChange={
          templateFor
            ? (next) => tryRenameFromSkeletonDialog(templateFor.name, next)
            : undefined
        }
      />
    </div>
  )
}

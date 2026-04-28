import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ProjectTag } from "@/lib/projects-api"
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Tag, X } from "lucide-react"
import { FormEvent, useState } from "react"

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

export function ProjectTagsEditor({
  title = "标签编辑",
  tags,
  onChange,
  inputPlaceholder = "输入标签后回车或点添加",
  emptyText = "暂无标签",
}: ProjectTagsEditorProps) {
  const [newTag, setNewTag] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)
  const [editingTagName, setEditingTagName] = useState<string | null>(null)
  const [editingTagValue, setEditingTagValue] = useState("")

  function handleAddTag(e: FormEvent) {
    e.preventDefault()
    const value = newTag.trim()
    if (!value) {
      setFeedback("标签不能为空")
      return
    }
    if (tags.some((item) => item.name === value)) {
      setFeedback("标签已存在")
      return
    }
    const color = TAG_COLORS[tags.length % TAG_COLORS.length]
    onChange([...tags, { name: value, color }])
    setNewTag("")
    setFeedback(null)
  }

  function handleRemoveTag(tagName: string) {
    onChange(tags.filter((item) => item.name !== tagName))
    setFeedback(null)
    if (editingTagName === tagName) {
      setEditingTagName(null)
      setEditingTagValue("")
    }
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
      setFeedback("标签不能为空")
      return
    }
    if (nextName !== tagName && tags.some((item) => item.name === nextName)) {
      setFeedback("标签已存在")
      return
    }
    onChange(tags.map((item) => (item.name === tagName ? { ...item, name: nextName } : item)))
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

  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
        <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={handleAddTag}>
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
      </form>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">{emptyText}</span>
        ) : (
          tags.map((tag, index) => (
            <div key={tag.name} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent">
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
              <div className="inline-flex items-center gap-1">
                {editingTagName === tag.name ? (
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
                      aria-label={`保存标签 ${tag.name} 名称`}
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
                      aria-label={`取消编辑标签 ${tag.name}`}
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
                      aria-label={`编辑标签 ${tag.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        startEditTag(tag.name)
                      }}
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-accent"
                      aria-label={`删除标签 ${tag.name}`}
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
                      aria-label={`上移标签 ${tag.name}`}
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
                      aria-label={`下移标签 ${tag.name}`}
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
          ))
        )}
      </div>
      {feedback ? <p className="text-xs text-muted-foreground">{feedback}</p> : null}
    </div>
  )
}

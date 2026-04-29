/**
 * 模块：components/skeleton-template-editor-dialog
 * 职责：仿 CVAT Set up skeleton — 在画板内加点、连边，坐标归一化存盘。参考图仅本会话，不写入项目文件。
 */
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createEmptySkeletonTemplate, type SkeletonTemplatePoint, type SkeletonTemplateSpec } from "@/lib/skeleton-template"
import { cn } from "@/lib/utils"
import { Check, ImageOff, Link2, MousePointer2, Pencil, RotateCcw, Save, Trash2, Upload, X } from "lucide-react"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"

const HIT_R = 0.045
const STROKE_W = 0.006
const NODE_R = 0.018

type Tool = "point" | "edge" | "remove"

function newPointId(): string {
  return `pt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
}

type SkeletonTemplateEditorDialogProps = {
  open: boolean
  /** 标签名，显示在窗口顶栏 */
  title: string
  initial: SkeletonTemplateSpec
  onOpenChange: (open: boolean) => void
  onSave: (next: SkeletonTemplateSpec) => void
  /** 顶栏笔状：编辑标签名；返回 true 表示已应用 */
  onTagNameChange?: (next: string) => boolean
}

function removePointAndEdges(spec: SkeletonTemplateSpec, pointId: string): SkeletonTemplateSpec {
  return {
    ...spec,
    points: spec.points.filter((p) => p.id !== pointId),
    edges: spec.edges.filter((e) => e.from !== pointId && e.to !== pointId),
  }
}

function addEdgeIfNew(spec: SkeletonTemplateSpec, from: string, to: string): SkeletonTemplateSpec {
  if (from === to) return spec
  const has = spec.edges.some(
    (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
  )
  if (has) return spec
  return { ...spec, edges: [...spec.edges, { from, to }] }
}

export function SkeletonTemplateEditorDialog({
  open,
  title,
  initial,
  onOpenChange,
  onSave,
  onTagNameChange,
}: SkeletonTemplateEditorDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const fileInputId = useId()
  const [spec, setSpec] = useState<SkeletonTemplateSpec>(initial)
  const [tool, setTool] = useState<Tool>("point")
  const [edgeFrom, setEdgeFrom] = useState<string | null>(null)
  const [bgObjectUrl, setBgObjectUrl] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")
  const [renamingLabel, setRenamingLabel] = useState(false)
  const [labelNameDraft, setLabelNameDraft] = useState("")

  useEffect(() => {
    if (!open) {
      setRenamingLabel(false)
      return
    }
    setSpec(initial)
    setTool("point")
    setEdgeFrom(null)
    setBgObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setEditingId(null)
    setEditingText("")
    setRenamingLabel(false)
  }, [open, initial])

  useEffect(() => {
    if (!open || renamingLabel) return
    setLabelNameDraft(title)
  }, [open, title, renamingLabel])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const edgePairs = useMemo(() => {
    return spec.edges.map((e) => {
      const a = spec.points.find((p) => p.id === e.from)
      const b = spec.points.find((p) => p.id === e.to)
      return a && b ? { a, b, key: `${e.from}|${e.to}` } : null
    })
  }, [spec.edges, spec.points])

  const toNorm = useCallback(
    (clientX: number, clientY: number) => {
      const el = panelRef.current
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      const x = (clientX - r.left) / r.width
      const y = (clientY - r.top) / r.height
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
    },
    [],
  )

  const findPointAt = (nx: number, ny: number): SkeletonTemplatePoint | null => {
    for (const p of spec.points) {
      const dx = p.x - nx
      const dy = p.y - ny
      if (Math.hypot(dx, dy) <= HIT_R) return p
    }
    return null
  }

  const onBoardPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = toNorm(e.clientX, e.clientY)
    if (!p) return
    const hit = findPointAt(p.x, p.y)

    if (tool === "point") {
      if (hit) {
        setEditingId(hit.id)
        setEditingText(hit.label)
        return
      }
      const n = spec.points.length
      setSpec((s) => ({
        ...s,
        points: [
          ...s.points,
          { id: newPointId(), label: `p${n + 1}`, x: p.x, y: p.y },
        ],
      }))
      return
    }

    if (tool === "remove") {
      if (!hit) return
      setSpec((s) => removePointAndEdges(s, hit.id))
      if (edgeFrom === hit.id) setEdgeFrom(null)
      if (editingId === hit.id) {
        setEditingId(null)
        setEditingText("")
      }
      return
    }

    if (tool === "edge") {
      if (!hit) {
        setEdgeFrom(null)
        return
      }
      if (!edgeFrom) {
        setEdgeFrom(hit.id)
        return
      }
      if (edgeFrom === hit.id) {
        setEdgeFrom(null)
        return
      }
      setSpec((s) => addEdgeIfNew(s, edgeFrom, hit.id))
      setEdgeFrom(null)
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f || !f.type.startsWith("image/")) return
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl)
    setBgObjectUrl(URL.createObjectURL(f))
  }

  const clearBg = () => {
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl)
    setBgObjectUrl(null)
  }

  const applyEditLabel = () => {
    if (!editingId) return
    const v = editingText.trim() || "p"
    setSpec((s) => ({
      ...s,
      points: s.points.map((p) => (p.id === editingId ? { ...p, label: v.slice(0, 32) } : p)),
    }))
    setEditingId(null)
  }

  const applyLabelRename = () => {
    if (!onTagNameChange) return
    const next = labelNameDraft.trim()
    if (onTagNameChange(next)) {
      setRenamingLabel(false)
    }
  }

  const cancelLabelRename = () => {
    setLabelNameDraft(title)
    setRenamingLabel(false)
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[20000] flex items-start justify-center overflow-y-auto overflow-x-hidden bg-black/50 px-3 py-4 pb-8 [padding-top:max(1rem,env(safe-area-inset-top,0px))] sm:px-4 sm:py-6 sm:pb-10"
      role="dialog"
      aria-modal="true"
      aria-label="骨架模板编辑"
    >
      <input id={fileInputId} type="file" accept="image/*" className="sr-only" onChange={handleFile} />
      <div className="mb-2 mt-0 inline-grid min-w-0 max-w-3xl shrink-0 [grid-template-columns:minmax(0,min(36rem,calc(100vw-5rem)))_auto] [grid-template-rows:auto_auto] gap-x-1.5 gap-y-3 rounded-lg border border-border bg-background p-3 shadow-lg sm:mb-4 sm:mt-1 sm:gap-x-2 sm:p-4">
        <div className="flex min-w-0 items-center gap-0.5 self-center [grid-column:1] [grid-row:1] pr-1">
          {onTagNameChange && renamingLabel ? (
            <>
              <Input
                className="h-8 min-w-0 flex-1 text-sm"
                value={labelNameDraft}
                onChange={(e) => setLabelNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    applyLabelRename()
                  }
                  if (e.key === "Escape") {
                    e.preventDefault()
                    cancelLabelRename()
                  }
                }}
                maxLength={64}
                autoFocus
                spellCheck={false}
                aria-label="标签名"
              />
              <Button type="button" size="icon" className="h-8 w-8 shrink-0" variant="secondary" onClick={applyLabelRename} aria-label="应用名称">
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                className="h-8 w-8 shrink-0"
                variant="ghost"
                onClick={cancelLabelRename}
                aria-label="取消"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1">
                  <h2 className="min-w-0 truncate text-base font-semibold text-foreground">{title}</h2>
                  {onTagNameChange ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="编辑标签名称"
                      aria-label="编辑标签名称"
                      onClick={() => {
                        setLabelNameDraft(title)
                        setRenamingLabel(true)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                {onTagNameChange ? (
                  <p className="text-[11px] leading-tight text-muted-foreground">点击名称旁的笔形图标可修改该骨架标签的名称</p>
                ) : null}
              </div>
            </>
          )}
        </div>
        <div className="self-start justify-self-end [grid-column:2] [grid-row:1]">
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => onOpenChange(false)} aria-label="关闭">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-w-0 min-h-0 self-start [grid-column:1] [grid-row:2]">
            <div
              ref={panelRef}
              className="relative aspect-square w-full max-w-full cursor-crosshair overflow-hidden rounded-md border border-border bg-muted/30 touch-none"
              onPointerDown={onBoardPointerDown}
              title={tool === "edge" ? (edgeFrom ? "再点击另一点连成边" : "先点起点，再点终点成边") : undefined}
            >
          {bgObjectUrl ? (
            <img src={bgObjectUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-90" draggable={false} />
          ) : null}
          <svg viewBox="0 0 1 1" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
            {edgePairs.map((pair) =>
              pair ? (
                <line
                  key={pair.key}
                  x1={pair.a.x}
                  y1={pair.a.y}
                  x2={pair.b.x}
                  y2={pair.b.y}
                  stroke="currentColor"
                  className="text-foreground/70"
                  strokeWidth={STROKE_W}
                />
              ) : null,
            )}
            {spec.points.map((q) => (
              <g key={q.id}>
                <circle
                  cx={q.x}
                  cy={q.y}
                  r={NODE_R}
                  fill="var(--background)"
                  stroke="currentColor"
                  className={cn(
                    "text-foreground",
                    tool === "edge" && edgeFrom === q.id && "text-emerald-500",
                    editingId === q.id && "text-primary",
                  )}
                  strokeWidth={STROKE_W * 0.5}
                />
                <text
                  x={q.x}
                  y={q.y + NODE_R * 1.1 + 0.04}
                  textAnchor="middle"
                  fontSize={0.055}
                  fill="currentColor"
                  className="text-foreground/90 pointer-events-none"
                  style={{ userSelect: "none" as const }}
                >
                  {q.label}
                </text>
              </g>
            ))}
          </svg>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              关节 {spec.points.length} · 边 {spec.edges.length}
            </p>
        </div>

        <div className="flex w-9 min-w-0 shrink-0 flex-col self-stretch border-l border-border/80 pl-1.5 min-h-0 [grid-column:2] [grid-row:2] min-[400px]:w-10 min-[400px]:pl-2 sm:pl-1.5">
            <div className="flex flex-col items-center gap-0.5 shrink-0" role="toolbar" aria-label="画板工具">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-9 w-9"
                title="上传参考图"
                aria-label="上传参考图"
                onClick={() => document.getElementById(fileInputId)?.click()}
              >
                <Upload className="h-4 w-4" />
              </Button>
              {bgObjectUrl ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  title="清除参考图"
                  aria-label="清除参考图"
                  onClick={clearBg}
                >
                  <ImageOff className="h-4 w-4" />
                </Button>
              ) : null}
              <div className="my-0.5 h-px w-5 self-stretch bg-border" aria-hidden />
              <Button
                type="button"
                size="icon"
                variant={tool === "point" ? "default" : "ghost"}
                className="h-9 w-9"
                title="添加关节点"
                aria-label="添加关节点"
                onClick={() => {
                  setTool("point")
                  setEdgeFrom(null)
                }}
              >
                <MousePointer2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant={tool === "edge" ? "default" : "ghost"}
                className="h-9 w-9"
                title={edgeFrom ? "再点另一点成边" : "连边：先点起点再点终点"}
                aria-label="连边"
                onClick={() => setTool("edge")}
              >
                <Link2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant={tool === "remove" ? "default" : "ghost"}
                className="h-9 w-9"
                title="删除关节点"
                aria-label="删除关节点"
                onClick={() => {
                  setTool("remove")
                  setEdgeFrom(null)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-2 w-full min-w-0 flex-1 shrink" aria-hidden />

            <div
              className="mt-auto flex shrink-0 flex-col items-center justify-end gap-0.5 border-t border-border/80 pt-2"
              role="group"
              aria-label="完成"
            >
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                title="取消不保存"
                aria-label="取消不保存"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                title="清空模板"
                aria-label="清空模板"
                onClick={() => setSpec(createEmptySkeletonTemplate())}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                className="h-9 w-9"
                title="保存"
                aria-label="保存"
                onClick={() => {
                  onSave(spec)
                  onOpenChange(false)
                }}
              >
                <Save className="h-4 w-4" />
              </Button>
            </div>
        </div>

        {editingId ? (
          <div className="col-span-2 row-start-3 flex min-w-0 flex-wrap items-end gap-2 [grid-column:1/-1]">
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-muted-foreground">关节名</span>
              <input
                className="h-8 rounded border border-border bg-background px-2 text-sm"
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyEditLabel()
                  if (e.key === "Escape") {
                    setEditingId(null)
                    setEditingText("")
                  }
                }}
                maxLength={32}
                autoFocus
              />
            </label>
            <Button type="button" size="sm" onClick={applyEditLabel}>
              应用
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingId(null)
                setEditingText("")
              }}
            >
              取消
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}


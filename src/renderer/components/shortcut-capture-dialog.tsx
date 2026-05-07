import { Button } from "@/components/ui/button"
import { formatChordFromKeyboardEvent, isBindingParseable } from "@/lib/keyboard-shortcut-match"
import { cn } from "@/lib/utils"
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"

type ShortcutCaptureDialogProps = {
  open: boolean
  title: string
  initialBinding: string
  onClose: () => void
  onSave: (binding: string) => void
}

export function ShortcutCaptureDialog({
  open,
  title,
  initialBinding,
  onClose,
  onSave,
}: ShortcutCaptureDialogProps) {
  const [pending, setPending] = useState(initialBinding)
  const captureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setPending(initialBinding)
  }, [open, initialBinding])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => captureRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  if (!open) return null

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const chord = formatChordFromKeyboardEvent(event.nativeEvent)
    if (chord) setPending(chord)
  }

  const handleSave = () => {
    const trimmed = pending.trim()
    if (!isBindingParseable(trimmed)) {
      window.alert("当前键位无法识别，请重新按下组合键。")
      return
    }
    onSave(trimmed)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-capture-title"
        className={cn(
          "w-full max-w-md rounded-xl border border-border bg-background p-4 shadow-lg",
          "outline-none ring-2 ring-ring/20",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="shortcut-capture-title" className="text-base font-semibold text-foreground">
          设置快捷键 · {title}
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">点击下方区域后按下要绑定的按键组合。</p>

        <div
          ref={captureRef}
          tabIndex={0}
          className={cn(
            "mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-6 text-center outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
          onKeyDown={handleKeyDownCapture}
        >
          <p className="text-xs text-muted-foreground">当前键位</p>
          <p className="mt-2 font-mono text-sm font-medium text-foreground break-all">{pending || "（未设置）"}</p>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

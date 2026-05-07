/**
 * 将设置里保存的快捷键文案（如 "Ctrl + S"、"Escape"、"A 或 ←"）与 KeyboardEvent 对齐。
 */

export type ParsedChord = {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

/** 拆成「或」/逗号等并列的多种按法，任一命中即可 */
export function splitBindingAlternatives(binding: string): string[] {
  const t = binding.trim()
  if (!t) return []
  return t
    .split(/\s*或\s*|\s*[,;/|]\s*/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeKeyToken(token: string): string | null {
  const k = token.trim().toLowerCase()
  if (!k) return null
  const map: Record<string, string> = {
    esc: "Escape",
    escape: "Escape",
    del: "Delete",
    delete: "Delete",
    backspace: "Backspace",
    enter: "Enter",
    return: "Enter",
    space: " ",
    tab: "Tab",
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    "←": "ArrowLeft",
    "→": "ArrowRight",
    "↑": "ArrowUp",
    "↓": "ArrowDown",
    "=": "=",
    plus: "=",
    "-": "-",
    minus: "-",
    ",": ",",
    comma: ",",
    ".": ".",
    "/": "/",
    "[": "[",
    "]": "]",
  }
  if (map[k]) return map[k]
  if (k.length === 1) return k
  // 允许直接写 Escape、Delete 等
  const cap = token.trim()
  if (/^[A-Z][a-z]+$/.test(cap)) return cap
  const lower = token.trim().toLowerCase()
  const cap2 = lower.charAt(0).toUpperCase() + lower.slice(1)
  if (["Escape", "Delete", "Backspace", "Enter", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(cap2)) {
    return cap2
  }
  return null
}

/** 解析单段 "Ctrl + Shift + A" 或 "Escape" */
export function parseSingleChord(raw: string): ParsedChord | null {
  const t = raw.trim()
  if (!t) return null
  const parts = t.split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean)
  let ctrl = false
  let shift = false
  let alt = false
  let meta = false
  const keyTokens: string[] = []
  for (const p of parts) {
    const pl = p.toLowerCase()
    if (pl === "ctrl" || pl === "control") {
      ctrl = true
      continue
    }
    if (pl === "shift") {
      shift = true
      continue
    }
    if (pl === "alt" || pl === "option") {
      alt = true
      continue
    }
    if (pl === "meta" || pl === "cmd" || pl === "command" || pl === "win") {
      meta = true
      continue
    }
    keyTokens.push(p)
  }
  if (keyTokens.length !== 1) return null
  const nk = normalizeKeyToken(keyTokens[0])
  if (!nk) return null
  return { key: nk, ctrl, shift, alt, meta }
}

function keyMatchesEvent(expected: string, event: KeyboardEvent): boolean {
  const ek = event.key
  if (expected === " ") return ek === " "
  if (expected.length === 1) return ek.length === 1 && ek.toLowerCase() === expected.toLowerCase()
  return ek === expected
}

export function chordMatchesEvent(chord: ParsedChord, event: KeyboardEvent): boolean {
  if (event.ctrlKey !== chord.ctrl) return false
  if (event.shiftKey !== chord.shift) return false
  if (event.altKey !== chord.alt) return false
  if (event.metaKey !== chord.meta) return false
  return keyMatchesEvent(chord.key, event)
}

/** 任一并列写法命中即 true */
export function bindingMatchesEvent(binding: string, event: KeyboardEvent): boolean {
  for (const alt of splitBindingAlternatives(binding)) {
    const chord = parseSingleChord(alt)
    if (chord && chordMatchesEvent(chord, event)) return true
  }
  return false
}

/** 用于校验设置里保存的文案能否被解析（含「A 或 ←」多段） */
export function isBindingParseable(binding: string): boolean {
  const parts = splitBindingAlternatives(binding.trim())
  if (parts.length === 0) return false
  return parts.every((p) => parseSingleChord(p) !== null)
}

/** 输入类元素上不抢快捷键（标注页暂无输入框，为后续预留） */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/**
 * 将一次 keydown 格式化为与 `parseSingleChord` 兼容的串（如 `Ctrl + Shift + A`、`Escape`）。
 * 单独按下修饰键时返回 null。
 */
export function formatChordFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (event.repeat) return null
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push("Ctrl")
  if (event.metaKey) parts.push("Meta")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")

  const k = event.key
  let main: string
  if (k === " ") {
    main = "Space"
  } else if (k.length === 1) {
    main = k.toUpperCase()
  } else {
    main = k
  }

  parts.push(main)
  return parts.join(" + ")
}

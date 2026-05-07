import { describe, expect, it } from "vitest"
import {
  bindingMatchesEvent,
  formatChordFromKeyboardEvent,
  isBindingParseable,
  parseSingleChord,
  splitBindingAlternatives,
} from "@/lib/keyboard-shortcut-match"

function ev(partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">): KeyboardEvent {
  return {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...partial,
  } as KeyboardEvent
}

describe("splitBindingAlternatives", () => {
  it("splits 或 and commas", () => {
    expect(splitBindingAlternatives("A 或 ←")).toEqual(["A", "←"])
    expect(splitBindingAlternatives("a, b")).toEqual(["a", "b"])
  })
})

describe("parseSingleChord", () => {
  it("parses Escape and modifiers", () => {
    expect(parseSingleChord("Escape")).toEqual({ key: "Escape", ctrl: false, shift: false, alt: false, meta: false })
    expect(parseSingleChord("Esc")).toEqual({ key: "Escape", ctrl: false, shift: false, alt: false, meta: false })
    expect(parseSingleChord("Ctrl + S")).toEqual({ key: "s", ctrl: true, shift: false, alt: false, meta: false })
  })
})

describe("bindingMatchesEvent", () => {
  it("matches Delete and Escape", () => {
    expect(bindingMatchesEvent("Delete", ev({ key: "Delete" }))).toBe(true)
    expect(bindingMatchesEvent("Escape", ev({ key: "Escape" }))).toBe(true)
    expect(bindingMatchesEvent("Delete", ev({ key: "Escape" }))).toBe(false)
  })

  it("matches Ctrl+S", () => {
    expect(bindingMatchesEvent("Ctrl + S", ev({ key: "s", ctrlKey: true }))).toBe(true)
    expect(bindingMatchesEvent("Ctrl + S", ev({ key: "s" }))).toBe(false)
  })

  it("matches alternatives", () => {
    expect(bindingMatchesEvent("A 或 ←", ev({ key: "a" }))).toBe(true)
    expect(bindingMatchesEvent("A 或 ←", ev({ key: "ArrowLeft" }))).toBe(true)
  })
})

describe("formatChordFromKeyboardEvent", () => {
  it("formats modifiers and Escape", () => {
    expect(formatChordFromKeyboardEvent(ev({ key: "s", ctrlKey: true }) as KeyboardEvent)).toBe("Ctrl + S")
    expect(formatChordFromKeyboardEvent(ev({ key: "Escape" }) as KeyboardEvent)).toBe("Escape")
  })

  it("returns null for lone modifier", () => {
    expect(formatChordFromKeyboardEvent(ev({ key: "Control" }) as KeyboardEvent)).toBeNull()
  })
})

describe("isBindingParseable", () => {
  it("accepts multi-alternative defaults", () => {
    expect(isBindingParseable("A 或 ←")).toBe(true)
    expect(isBindingParseable("Ctrl + S")).toBe(true)
    expect(isBindingParseable("")).toBe(false)
  })
})

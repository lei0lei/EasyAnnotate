import { STORAGE_KEYS } from "@/lib/storage/keys"

export type WorkflowBoard = {
  id: string
  name: string
  updatedAt: string
}

function safeParse(raw: string | null): WorkflowBoard[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (item): item is WorkflowBoard =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as WorkflowBoard).id === "string" &&
        typeof (item as WorkflowBoard).name === "string" &&
        typeof (item as WorkflowBoard).updatedAt === "string",
    )
  } catch {
    return []
  }
}

export function loadWorkflowBoards(): WorkflowBoard[] {
  try {
    return safeParse(localStorage.getItem(STORAGE_KEYS.workflowBoards))
  } catch {
    return []
  }
}

export function saveWorkflowBoards(boards: WorkflowBoard[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.workflowBoards, JSON.stringify(boards))
  } catch {
    /* ignore */
  }
}

export function getWorkflowBoard(id: string): WorkflowBoard | undefined {
  return loadWorkflowBoards().find((b) => b.id === id)
}

function nextDefaultName(): string {
  const boards = loadWorkflowBoards()
  const prefix = "未命名流程"
  const used = boards
    .map((b) => b.name)
    .filter((n) => n.startsWith(prefix))
    .map((n) => {
      const m = n.slice(prefix.length).trim()
      const num = parseInt(m, 10)
      return Number.isFinite(num) ? num : 0
    })
  const next = (used.length ? Math.max(0, ...used) : 0) + 1
  return `${prefix} ${next}`
}

export function createWorkflowBoard(): WorkflowBoard {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `wf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return {
    id,
    name: nextDefaultName(),
    updatedAt: new Date().toISOString(),
  }
}

export function addWorkflowBoard(board: WorkflowBoard): void {
  const boards = loadWorkflowBoards()
  saveWorkflowBoards([board, ...boards])
}

export function removeWorkflowBoard(id: string): void {
  saveWorkflowBoards(loadWorkflowBoards().filter((b) => b.id !== id))
}

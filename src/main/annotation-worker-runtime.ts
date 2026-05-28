import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

type ImportedShapeRecord = {
  label: string
  score: number | null
  points: number[][]
  group_id: number | null
  description: string | null
  difficult: boolean
  shape_type: "rectangle" | "rotation" | "polygon"
  flags: Record<string, unknown> | null
  attributes: Record<string, unknown>
  kie_linking: unknown[]
}

type AnnotationWorkerTask =
  | {
      kind: "rleToPolygon"
      counts: number[]
      w: number
      h: number
      maxPoints: number
    }
  | {
      kind: "parseYoloTxt"
      txtContent: string
      labels: string[]
      imageWidth: number
      imageHeight: number
    }

const CHILD_SOURCE = `
function decimatePoints(points, maxPoints) {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const out = []
  for (let i = 0; i < points.length; i += step) out.push(points[i])
  return out.length >= 3 ? out : points.slice(0, maxPoints)
}
function simplifyPolygonRdp(points, epsilon) {
  if (points.length < 3) return points
  const eps = Math.max(0, Number(epsilon) || 0)
  const dist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return Math.hypot(px - ax, py - ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)))
    const qx = ax + t * dx
    const qy = ay + t * dy
    return Math.hypot(px - qx, py - qy)
  }
  const rdp = (pts, i0, i1, out) => {
    if (i1 <= i0 + 1) return
    const p0 = pts[i0]
    const p1 = pts[i1]
    if (!p0 || !p1) return
    let im = i0
    let dm = 0
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i]
      if (!p) continue
      const d = dist(p[0], p[1], p0[0], p0[1], p1[0], p1[1])
      if (d > dm) {
        dm = d
        im = i
      }
    }
    if (dm > eps) {
      rdp(pts, i0, im, out)
      out.push(pts[im])
      rdp(pts, im, i1, out)
    }
  }
  const out = [points[0]]
  rdp(points, 0, points.length - 1, out)
  out.push(points[points.length - 1])
  return out
}
const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, -1, -1, -1, 0, 1, 1, 1]
function fg(data, w, h, x, y) {
  return x >= 0 && x < w && y >= 0 && y < h && data[y * w + x] !== 0
}
function decodeRleToBinary(counts, total) {
  const out = new Uint8Array(total)
  let cursor = 0
  let isFg = false
  for (let i = 0; i < counts.length && cursor < total; i += 1) {
    const run = Math.max(0, Math.floor(Number(counts[i])))
    if (!Number.isFinite(run) || run <= 0) {
      isFg = !isFg
      continue
    }
    const end = Math.min(total, cursor + run)
    if (isFg) out.fill(1, cursor, end)
    cursor = end
    isFg = !isFg
  }
  return out
}
function foregroundBBox(data, w, h) {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] === 0) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { minX, minY, maxX, maxY }
}
function binaryMaskOuterContour(data, w, h) {
  let sx = -1
  let sy = -1
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (fg(data, w, h, x, y) && !fg(data, w, h, x, y - 1)) {
        sx = x
        sy = y
        break outer
      }
    }
  }
  if (sx < 0) return []
  const path = []
  let x = sx
  let y = sy
  let enterDir = 7
  const maxSteps = w * h * 8 + 16
  for (let step = 0; step < maxSteps; step++) {
    path.push([x, y])
    const start = (enterDir + 5) % 8
    let found = -1
    for (let i = 0; i < 8; i++) {
      const d = (start + i) % 8
      const nx = x + DX[d]
      const ny = y + DY[d]
      if (fg(data, w, h, nx, ny)) {
        found = d
        break
      }
    }
    if (found < 0) break
    x += DX[found]
    y += DY[found]
    enterDir = found
    if (x === sx && y === sy) break
  }
  if (path.length >= 2) {
    const a = path[0]
    const b = path[path.length - 1]
    if (a && b && a[0] === b[0] && a[1] === b[1]) path.pop()
  }
  return path
}
function rleToPolygon(task) {
  const counts = Array.isArray(task.counts) ? task.counts : []
  const w = Math.floor(Number(task.w))
  const h = Math.floor(Number(task.h))
  const maxPoints = Math.max(3, Math.floor(Number(task.maxPoints) || 120))
  if (!counts.length || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return []
  const total = w * h
  if (!Number.isFinite(total) || total <= 0) return []
  const bin = decodeRleToBinary(counts, total)
  // Diagnostic mode: isolate decode stability first, skip contour extraction/simplification.
  const bb = foregroundBBox(bin, w, h)
  if (!bb) return []
  const poly = [
    [bb.minX, bb.minY],
    [bb.maxX + 1, bb.minY],
    [bb.maxX + 1, bb.maxY + 1],
    [bb.minX, bb.maxY + 1],
  ]
  return decimatePoints(poly, maxPoints)
}
function parseYoloTxt(task) {
  const lines = String(task.txtContent || "").split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean)
  const labels = Array.isArray(task.labels) ? task.labels : []
  const imageWidth = Math.max(1, Number(task.imageWidth) || 1)
  const imageHeight = Math.max(1, Number(task.imageHeight) || 1)
  const out = []
  for (const line of lines) {
    const values = line.split(/\\s+/).map((v) => Number(v))
    if (values.length < 5 || values.some((v) => !Number.isFinite(v))) continue
    const classId = Math.max(0, Math.floor(values[0]))
    const label = labels[classId] || ("class_" + classId)
    const rest = values.slice(1)
    const toPx = (x, y) => [x * imageWidth, y * imageHeight]
    if (rest.length === 4) {
      const [cx, cy, w, h] = rest
      out.push({ label, score: null, points: [[(cx - w / 2) * imageWidth, (cy - h / 2) * imageHeight], [(cx + w / 2) * imageWidth, (cy + h / 2) * imageHeight]], group_id: null, description: null, difficult: false, shape_type: "rectangle", flags: null, attributes: {}, kie_linking: [] })
      continue
    }
    if (rest.length === 8) {
      out.push({ label, score: null, points: [toPx(rest[0], rest[1]), toPx(rest[2], rest[3]), toPx(rest[4], rest[5]), toPx(rest[6], rest[7])], group_id: null, description: null, difficult: false, shape_type: "rotation", flags: null, attributes: {}, kie_linking: [] })
      continue
    }
    if (rest.length >= 6 && rest.length % 2 === 0) {
      const points = []
      for (let i = 0; i < rest.length; i += 2) points.push(toPx(rest[i], rest[i + 1]))
      if (points.length >= 3) out.push({ label, score: null, points, group_id: null, description: null, difficult: false, shape_type: "polygon", flags: null, attributes: {}, kie_linking: [] })
    }
  }
  return out
}
let buf = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buf += chunk
  let idx = buf.indexOf("\\n")
  while (idx >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (line) {
      try {
        const req = JSON.parse(line)
        const task = req.task
        let result
        if (task?.kind === "rleToPolygon") result = rleToPolygon(task)
        else if (task?.kind === "parseYoloTxt") result = parseYoloTxt(task)
        else throw new Error("Unsupported worker task kind")
        process.stdout.write(JSON.stringify({ id: req.id, ok: true, result }) + "\\n")
      } catch (error) {
        process.stdout.write(JSON.stringify({ id: null, ok: false, error: error instanceof Error ? error.message : String(error) }) + "\\n")
      }
    }
    idx = buf.indexOf("\\n")
  }
})
`
type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class PersistentAnnotationWorker {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<number, Pending>()
  private buffer = ""
  private seq = 1

  constructor() {
    this.child = spawn(process.execPath, ["-e", CHILD_SOURCE], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.child.stdout.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk))
    this.child.stderr.setEncoding("utf8")
    this.child.stderr.on("data", () => {
      // stderr is intentionally ignored; failures are surfaced via task responses/timeouts.
    })
    const onDead = (reason: string) => {
      const entries = [...this.pending.values()]
      this.pending.clear()
      for (const p of entries) {
        clearTimeout(p.timer)
        p.reject(new Error(reason))
      }
    }
    this.child.on("error", (err) => onDead(`Worker process error: ${err.message}`))
    this.child.on("close", (code, signal) =>
      onDead(`Worker process closed (code=${code ?? "null"}, signal=${signal ?? "null"})`),
    )
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let idx = this.buffer.indexOf("\n")
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) {
        try {
          const msg = JSON.parse(line) as { id: number | null; ok: boolean; result?: unknown; error?: string }
          if (typeof msg.id !== "number") {
            idx = this.buffer.indexOf("\n")
            continue
          }
          const pending = this.pending.get(msg.id)
          if (!pending) {
            idx = this.buffer.indexOf("\n")
            continue
          }
          this.pending.delete(msg.id)
          clearTimeout(pending.timer)
          if (!msg.ok) pending.reject(new Error(msg.error || "Worker task failed"))
          else pending.resolve(msg.result)
        } catch {
          // ignore malformed line
        }
      }
      idx = this.buffer.indexOf("\n")
    }
  }

  run<TResult>(task: AnnotationWorkerTask, timeoutMs: number): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      const id = this.seq++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Worker timeout after ${timeoutMs}ms`))
      }, Math.max(500, timeoutMs))
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      try {
        this.child.stdin.write(`${JSON.stringify({ id, task })}\n`, "utf8")
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose(): void {
    try {
      this.child.kill()
    } catch {
      // ignore
    }
  }
}

let workerPool: PersistentAnnotationWorker[] | null = null
let workerCursor = 0

function getWorkerPool(): PersistentAnnotationWorker[] {
  if (workerPool) return workerPool
  // Force sequential execution for export diagnostics: one worker only.
  const count = 1
  workerPool = Array.from({ length: count }, () => new PersistentAnnotationWorker())
  const disposeAll = () => {
    if (!workerPool) return
    for (const w of workerPool) w.dispose()
    workerPool = null
  }
  process.once("exit", disposeAll)
  process.once("SIGINT", disposeAll)
  process.once("SIGTERM", disposeAll)
  return workerPool
}

function runWorkerTask<TResult>(task: AnnotationWorkerTask, timeoutMs = 7000): Promise<TResult> {
  const pool = getWorkerPool()
  const worker = pool[workerCursor % pool.length]!
  workerCursor = (workerCursor + 1) % pool.length
  return worker.run<TResult>(task, timeoutMs)
}

export async function rleMaskToPolygonInWorker(
  input: { counts: number[]; w: number; h: number; maxPoints: number },
  timeoutMs = 7000,
): Promise<number[][]> {
  return await runWorkerTask<number[][]>({ kind: "rleToPolygon", ...input }, timeoutMs)
}

export async function parseYoloTxtInWorker(
  input: { txtContent: string; labels: string[]; imageWidth: number; imageHeight: number },
  timeoutMs = 6000,
): Promise<ImportedShapeRecord[]> {
  return await runWorkerTask<ImportedShapeRecord[]>({ kind: "parseYoloTxt", ...input }, timeoutMs)
}

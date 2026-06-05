import fs from "node:fs"
import { runYoloBatchAutoAnnotateInChild, type YoloAutoAnnotateRunRequest } from "./yolo-batch-auto-annotate-runner.js"

const jobId = process.argv[2]?.trim()
const reqPath = process.argv[3]?.trim()
const statePath = process.argv[4]?.trim()
const cancelPath = process.argv[5]?.trim()

if (!jobId || !reqPath || !statePath || !cancelPath) {
  console.error("Usage: yolo-batch-auto-annotate-child <jobId> <request-json> <state-json> <cancel-flag>")
  process.exit(2)
}

function writeState(state: Record<string, unknown>): void {
  try {
    fs.writeFileSync(statePath!, JSON.stringify(state), "utf8")
  } catch {
    /* ignore */
  }
}

try {
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Request file not found: ${reqPath}`)
  }
  const raw = fs.readFileSync(reqPath, "utf8")
  const req = JSON.parse(raw) as YoloAutoAnnotateRunRequest

  await runYoloBatchAutoAnnotateInChild(req, {
    onState: (state) => {
      writeState({ id: jobId, ...state })
    },
    isCancelled: () => {
      try {
        return fs.existsSync(cancelPath!)
      } catch {
        return false
      }
    },
  })
  process.exit(0)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  writeState({
    id: jobId,
    status: "failed",
    done: 0,
    total: 0,
    currentFile: "",
    message: "子进程异常",
    errorMessage: message,
    skippedAlreadyAnnotated: 0,
    skippedLabelMismatch: 0,
    summaryMessage: "",
  })
  console.error(message)
  process.exit(1)
}

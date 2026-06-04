import fs from "node:fs"
import { runDeleteFromChildArgv } from "./task-delete.js"

const jobId = process.argv[2]?.trim()
const reqPath = process.argv[3]?.trim()
if (!jobId || !reqPath) {
  console.error("Usage: task-delete-child <jobId> <request-json-path>")
  process.exit(2)
}

try {
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Delete request file not found: ${reqPath}`)
  }
  await runDeleteFromChildArgv(jobId, reqPath)
  process.exit(0)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}

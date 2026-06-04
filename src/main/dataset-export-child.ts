import fs from "node:fs"
import { runExportFromChildArgv } from "./dataset-export.js"

const jobId = process.argv[2]?.trim()
const reqPath = process.argv[3]?.trim()
if (!jobId || !reqPath) {
  console.error("Usage: dataset-export-child <jobId> <request-json-path>")
  process.exit(2)
}

try {
  if (!fs.existsSync(reqPath)) {
    throw new Error(`Export request file not found: ${reqPath}`)
  }
  await runExportFromChildArgv(jobId, reqPath)
  process.exit(0)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}

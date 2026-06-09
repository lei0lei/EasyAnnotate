import fs from "node:fs"
import { runTensorRtConversionFromChildArgv } from "./tensorrt-conversion-job.js"

const jobId = process.argv[2]?.trim()
const reqPath = process.argv[3]?.trim()
if (!jobId || !reqPath) {
  console.error("Usage: tensorrt-conversion-child <jobId> <request-json-path>")
  process.exit(2)
}

try {
  if (!fs.existsSync(reqPath)) {
    throw new Error(`TensorRT conversion request file not found: ${reqPath}`)
  }
  await runTensorRtConversionFromChildArgv(jobId, reqPath)
  process.exit(0)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}

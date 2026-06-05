import fs from "node:fs"
import path from "node:path"
import { parseImageDimensionsFromHeader } from "./image-dimensions"

function readFileHeader(filePath: string, maxBytes = 256 * 1024): Buffer {
  const fd = fs.openSync(filePath, "r")
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    fs.closeSync(fd)
  }
}

function detectImageFormat(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "PNG"
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "JPEG"
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "WEBP"
  }
  if (buffer.length >= 6 && (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")) {
    return "GIF"
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "BMP"
  }
  if (buffer.length >= 4) {
    const little = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00
    const big = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a
    if (little || big) return "TIFF"
  }
  return "UNKNOWN"
}

export function getLocalImageFileInfo(imagePath: string): {
  exists: boolean
  width: number
  height: number
  errorMessage: string
} {
  const filePath = imagePath.trim()
  if (!filePath) {
    return { exists: false, width: 0, height: 0, errorMessage: "图片路径为空" }
  }
  if (!fs.existsSync(filePath)) {
    return { exists: false, width: 0, height: 0, errorMessage: `图片不存在：${filePath}` }
  }
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return { exists: false, width: 0, height: 0, errorMessage: "路径不是文件" }
    }
    const header = readFileHeader(filePath)
    const format = detectImageFormat(header)
    const { width, height } = parseImageDimensionsFromHeader(header, format)
    return { exists: true, width, height, errorMessage: "" }
  } catch (error) {
    return {
      exists: false,
      width: 0,
      height: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

export function resolveAnnotationJsonPath(imagePath: string): string {
  const parsed = path.parse(imagePath)
  return path.join(parsed.dir, `${parsed.name}.json`)
}

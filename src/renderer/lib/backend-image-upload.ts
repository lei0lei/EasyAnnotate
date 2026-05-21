import { fetchWithTimeout, readFetchError } from "@/lib/backend-http"
import { readImageFile } from "@/lib/projects-api"

function fileNameFromPath(path: string): string {
  const p = path.trim()
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return idx >= 0 ? p.slice(idx + 1) : p
}

function mimeTypeFromPath(path: string): string {
  const lower = path.trim().toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".bmp")) return "image/bmp"
  if (lower.endsWith(".gif")) return "image/gif"
  return "application/octet-stream"
}

export function isHttpImageSource(source: string): boolean {
  const s = source.trim().toLowerCase()
  return s.startsWith("http://") || s.startsWith("https://")
}

export async function postLocalImageAsMultipart(
  url: string,
  imagePath: string,
  payload?: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<Response> {
  const path = imagePath.trim()
  const file = await readImageFile(path)
  if (file.errorMessage) {
    throw new Error(`读取图片失败：${file.errorMessage}`)
  }
  const bytes = file.content
  if (!bytes || bytes.length === 0) {
    throw new Error("读取图片失败：文件为空或无法访问")
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const form = new FormData()
  form.set("image", new Blob([buffer], { type: mimeTypeFromPath(path) }), fileNameFromPath(path) || "image.bin")
  if (payload && Object.keys(payload).length > 0) {
    form.set("payload_json", JSON.stringify(payload))
  }
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
    },
    timeoutMs,
  )
  if (!res.ok) {
    throw new Error(await readFetchError(res))
  }
  return res
}

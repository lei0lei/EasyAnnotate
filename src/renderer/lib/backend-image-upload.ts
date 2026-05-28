import { ipc } from "@/gen/ipc"
import { readFetchError } from "@/lib/backend-http"

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
  const payloadJson = payload && Object.keys(payload).length > 0 ? JSON.stringify(payload) : ""
  const proxied = await ipc.app.ProxyBackendImageUpload({
    url,
    imagePath: path,
    payloadJson,
    timeoutMs,
  })
  if (!proxied.ok) {
    throw new Error(proxied.errorMessage || "上传图片失败")
  }
  const res = new Response(proxied.body, {
    status: proxied.status || 500,
    statusText: proxied.statusText || "",
    headers: proxied.headers,
  })
  if (!res.ok) {
    throw new Error(await readFetchError(res))
  }
  return res
}

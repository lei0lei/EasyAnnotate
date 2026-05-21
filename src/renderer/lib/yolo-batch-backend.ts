import { loadAppConfig } from "@/lib/app-config-storage"
import { apiV1Root, fetchWithTimeout, readFetchError } from "@/lib/backend-http"
import { formatYoloBackendEndpointLabel } from "@/lib/yolo-dataset-upload"

export type YoloBatchBackendContext = {
  mode: "local" | "remote"
  endpointLabel: string
  /** 展示用存储路径（当前连接的后端机器上） */
  storagePath: string
}

export function isYoloBatchRemoteBackend(): boolean {
  return Boolean(loadAppConfig().backend.remoteConnected)
}

export function getYoloBatchLocalBackendDir(): string {
  return loadAppConfig().backend.localBackendDir?.trim() ?? ""
}

/** 本地后端目录下的 model_temp；远程时从 catalog 拉取服务端绝对路径。 */
export async function resolveYoloBatchBackendContext(): Promise<YoloBatchBackendContext> {
  const endpoint = formatYoloBackendEndpointLabel()
  if (endpoint.mode === "remote") {
    try {
      const res = await fetchWithTimeout(`${apiV1Root()}/yolo-batch/catalog`, undefined, 15_000)
      if (!res.ok) throw new Error(await readFetchError(res))
      const catalog = (await res.json()) as { model_temp_dir?: string }
      const dir = catalog.model_temp_dir?.trim()
      return {
        mode: "remote",
        endpointLabel: endpoint.label,
        storagePath: dir || "（远程）external/model_temp",
      }
    } catch {
      return {
        mode: "remote",
        endpointLabel: endpoint.label,
        storagePath: "（远程）external/model_temp",
      }
    }
  }
  const localDir = getYoloBatchLocalBackendDir()
  return {
    mode: "local",
    endpointLabel: endpoint.label,
    storagePath: localDir
      ? `${localDir}/external/model_temp`
      : "（请先在设置中配置本地 backend 目录）/external/model_temp",
  }
}

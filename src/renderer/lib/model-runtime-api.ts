import { loadAppConfig } from "@/lib/app-config-storage"

export type InferenceInfo = {
  method: string
  path: string
  note: string
}

export type RuntimeVariantRow = {
  model_id: string
  /** `registry.json` 里该条目 `relative_path` 的文件名（如 xxx.pt） */
  label: string
  assets_installed: boolean
  asset_ids: string[]
}

export type RuntimeCategoryRow = {
  id: string
  label_zh: string
  label_en: string
  running: boolean
  active_model_id: string | null
  /** 当前运行实例是否使用 GPU（未运行或未返回时为 null/缺失） */
  active_use_gpu?: boolean | null
  variants: RuntimeVariantRow[]
  inference: InferenceInfo | null
}

export type RuntimeCatalogResponse = {
  categories: RuntimeCategoryRow[]
}

export function backendHttpOrigin(): string {
  const { host, port } = loadAppConfig().backend
  const h = host.trim() || "127.0.0.1"
  const p = (port.trim() || "8000").replace(/^:/, "")
  return `http://${h}:${p}`
}

/** 无 registry 文件名时的兜底（一般不触发） */
export function formatBackendModelDisplayName(modelId: string): string {
  const tail = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId
  return tail.replace(/\.(pt|pth|onnx|yaml|yml|json|safetensors)$/i, "").replace(/_/g, " ")
}

function catalogUrl(): string {
  return `${backendHttpOrigin()}/api/v1/model-runtime/catalog`
}

async function readFetchError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return text || res.statusText || "unknown"
}

export async function fetchModelRuntimeCatalog(): Promise<RuntimeCatalogResponse> {
  const url = catalogUrl()
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
    })
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(
      `无法连接 ${url}（${hint}）。请在「设置」中将后端端口改为与 uvicorn 一致：` +
        `start.ps1 默认为 8000；若仍使用旧配置 8080，请求会发到错误端口。`,
    )
  }
  if (!res.ok) {
    throw new Error(`catalog ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json() as Promise<RuntimeCatalogResponse>
}

export async function startModelRuntime(
  categoryId: string,
  modelId: string,
  useGpu: boolean = true,
): Promise<unknown> {
  const url = `${backendHttpOrigin()}/api/v1/model-runtime/${categoryId}/start`
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: modelId, use_gpu: useGpu }),
    })
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接 ${url}（${hint}）`)
  }
  if (!res.ok) {
    throw new Error(`start ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json()
}

export async function stopModelRuntime(categoryId: string): Promise<unknown> {
  const url = `${backendHttpOrigin()}/api/v1/model-runtime/${categoryId}/stop`
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json" },
    })
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接 ${url}（${hint}）`)
  }
  if (!res.ok) {
    throw new Error(`stop ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json()
}

export function predictUrlForModel(modelId: string): string {
  const o = backendHttpOrigin()
  return `${o}/api/v1/models/${modelId}/predict`
}

/** 后端从公网拉取的样例图（各模型 `payload.source` 均支持 HTTPS URL）。 */
export const MODEL_SMOKE_TEST_IMAGE_URL = "https://ultralytics.com/images/bus.jpg"

export async function runModelSmokePredict(modelId: string): Promise<unknown> {
  const url = predictUrlForModel(modelId)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { source: MODEL_SMOKE_TEST_IMAGE_URL } }),
    })
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`无法连接 ${url}（${hint}）`)
  }
  if (!res.ok) {
    throw new Error(`predict ${res.status}: ${await readFetchError(res)}`)
  }
  return res.json()
}

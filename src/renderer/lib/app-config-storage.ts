import { STORAGE_KEYS } from "@/lib/storage/keys"
import { readLocalJson, writeLocalJson } from "@/lib/storage/json-local"

/** 与磁盘上 JSON 结构版本号一致，便于做迁移；升级时加 migrate 逻辑即可 */
const APP_CONFIG_VERSION = 1

export type AppConfig = {
  version: typeof APP_CONFIG_VERSION
  backend: {
    host: string
    port: string
  }
  storagePaths: {
    databaseDir: string
    assetsDir: string
  }
  /** 快捷键 id -> 用户自定义展示串，未设则回退到界面默认表 */
  shortcuts: Partial<Record<string, string>>
}

const DEFAULT: AppConfig = {
  version: APP_CONFIG_VERSION,
  backend: { host: "127.0.0.1", port: "8080" },
  storagePaths: { databaseDir: "", assetsDir: "" },
  shortcuts: {},
}

function isAppConfigV1(d: unknown): d is AppConfig {
  if (typeof d !== "object" || d === null) return false
  const o = d as Record<string, unknown>
  if (o.version !== 1) return false
  const be = o.backend
  if (typeof be !== "object" || be === null) return false
  const b = be as Record<string, unknown>
  if (typeof b.host !== "string" || typeof b.port !== "string") return false
  if (o.storagePaths != null && (typeof o.storagePaths !== "object" || o.storagePaths === null)) return false
  if (o.shortcuts != null && (typeof o.shortcuts !== "object" || o.shortcuts === null || Array.isArray(o.shortcuts))) {
    return false
  }
  return true
}

export function loadAppConfig(): AppConfig {
  const raw = readLocalJson(STORAGE_KEYS.appConfig, isAppConfigV1, DEFAULT)
  const legacyStoragePaths = raw.storagePaths as Partial<AppConfig["storagePaths"]> & {
    imagesDir?: string
    annotationsDir?: string
  }
  return {
    version: APP_CONFIG_VERSION,
    backend: { ...DEFAULT.backend, ...raw.backend },
    storagePaths: {
      ...DEFAULT.storagePaths,
      ...raw.storagePaths,
      assetsDir: legacyStoragePaths.assetsDir ?? legacyStoragePaths.imagesDir ?? legacyStoragePaths.annotationsDir ?? "",
    },
    shortcuts: { ...DEFAULT.shortcuts, ...raw.shortcuts },
  }
}

export function updateAppConfig(patch: {
  backend?: Partial<AppConfig["backend"]>
  storagePaths?: Partial<AppConfig["storagePaths"]>
  shortcuts?: Partial<AppConfig["shortcuts"]>
}): void {
  const cur = loadAppConfig()
  const backend = { ...cur.backend, ...patch.backend }
  const storagePaths = { ...cur.storagePaths, ...patch.storagePaths }
  const shortcuts = { ...cur.shortcuts, ...patch.shortcuts }
  if (patch.shortcuts) {
    for (const k of Object.keys(patch.shortcuts)) {
      const v = patch.shortcuts[k]
      if (v === "" || v === undefined) {
        delete shortcuts[k]
      }
    }
  }
  writeLocalJson(STORAGE_KEYS.appConfig, { ...cur, version: APP_CONFIG_VERSION, backend, storagePaths, shortcuts })
}

export function resetAppConfigToDefaults(): void {
  writeLocalJson(STORAGE_KEYS.appConfig, { ...DEFAULT })
}

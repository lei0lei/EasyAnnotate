import { ipc } from "@/gen/ipc"
import { STORAGE_KEYS } from "@/lib/storage/keys"

/** 与磁盘上 JSON 结构版本号一致，便于做迁移；升级时加 migrate 逻辑即可 */
const APP_CONFIG_VERSION = 2

export type ModelsDefaultPage = "hub" | "auto" | "training"

export type AppConfig = {
  version: typeof APP_CONFIG_VERSION
  backend: {
    host: string
    port: string
    /** 便携 Python backend 根目录（含 start.ps1）；空表示自动查找 */
    localBackendDir: string
  }
  storagePaths: {
    databaseDir: string
    assetsDir: string
    globalConfigDir: string
  }
  pageFlow: {
    workflow: {
      /** 新建流程后自动进入编辑页 */
      openEditorOnCreate: boolean
    }
    models: {
      /** 访问 `/models` 时默认进入的子页面 */
      defaultPage: ModelsDefaultPage
    }
    monitor: {
      /** 新建 monitor 后自动进入编辑页 */
      openEditorOnCreate: boolean
    }
  }
  /** 快捷键 id -> 用户自定义展示串，未设则回退到界面默认表 */
  shortcuts: Partial<Record<string, string>>
}

const DEFAULT: AppConfig = {
  version: APP_CONFIG_VERSION,
  /** 与 backend/start.ps1 中 uvicorn --port 8000 对齐 */
  backend: { host: "127.0.0.1", port: "8000", localBackendDir: "" },
  storagePaths: { databaseDir: "", assetsDir: "", globalConfigDir: "" },
  pageFlow: {
    workflow: { openEditorOnCreate: true },
    models: { defaultPage: "hub" },
    monitor: { openEditorOnCreate: true },
  },
  shortcuts: {},
}

type AppConfigV1 = {
  version: 1
  backend: {
    host: string
    port: string
  }
  storagePaths?: {
    databaseDir?: string
    assetsDir?: string
    imagesDir?: string
    annotationsDir?: string
    globalConfigDir?: string
  }
  shortcuts?: Partial<Record<string, string>>
}

type AppConfigAnyVersion = AppConfig | AppConfigV1

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

function isAppConfigV1(d: unknown): d is AppConfigV1 {
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

function isModelsDefaultPage(v: unknown): v is ModelsDefaultPage {
  return v === "hub" || v === "auto" || v === "training"
}

function isAppConfigV2(d: unknown): d is AppConfig {
  if (!isRecord(d)) return false
  if (d.version !== APP_CONFIG_VERSION) return false
  if (!isRecord(d.backend) || typeof d.backend.host !== "string" || typeof d.backend.port !== "string") return false
  const localBackendDir = d.backend.localBackendDir
  if (localBackendDir !== undefined && typeof localBackendDir !== "string") return false
  if (
    !isRecord(d.storagePaths) ||
    typeof d.storagePaths.databaseDir !== "string" ||
    typeof d.storagePaths.assetsDir !== "string" ||
    typeof d.storagePaths.globalConfigDir !== "string"
  ) {
    return false
  }
  if (
    !isRecord(d.pageFlow) ||
    !isRecord(d.pageFlow.workflow) ||
    typeof d.pageFlow.workflow.openEditorOnCreate !== "boolean" ||
    !isRecord(d.pageFlow.models) ||
    !isModelsDefaultPage(d.pageFlow.models.defaultPage) ||
    !isRecord(d.pageFlow.monitor) ||
    typeof d.pageFlow.monitor.openEditorOnCreate !== "boolean"
  ) {
    return false
  }
  if (!isRecord(d.shortcuts) && d.shortcuts != null) return false
  return true
}

function isAppConfigAnyVersion(d: unknown): d is AppConfigAnyVersion {
  return isAppConfigV2(d) || isAppConfigV1(d)
}

function normalizeAnyToV2(raw: AppConfigAnyVersion): AppConfig {
  const applyLegacyPort = (cfg: AppConfig): AppConfig => {
    const h = cfg.backend.host.trim()
    const p = cfg.backend.port.trim()
    if ((h === "127.0.0.1" || h === "localhost") && p === "8080") {
      return { ...cfg, backend: { ...cfg.backend, port: "8000" } }
    }
    return cfg
  }

  if (raw.version === APP_CONFIG_VERSION) {
    const merged: AppConfig = {
      version: APP_CONFIG_VERSION,
      backend: { ...DEFAULT.backend, ...raw.backend },
      storagePaths: { ...DEFAULT.storagePaths, ...raw.storagePaths },
      pageFlow: {
        workflow: {
          ...DEFAULT.pageFlow.workflow,
          ...raw.pageFlow.workflow,
        },
        models: {
          ...DEFAULT.pageFlow.models,
          ...raw.pageFlow.models,
        },
        monitor: {
          ...DEFAULT.pageFlow.monitor,
          ...raw.pageFlow.monitor,
        },
      },
      shortcuts: { ...DEFAULT.shortcuts, ...raw.shortcuts },
    }
    return applyLegacyPort(merged)
  }

  const legacyStoragePaths = (raw.storagePaths ?? {}) as Partial<AppConfig["storagePaths"]> & {
    imagesDir?: string
    annotationsDir?: string
  }
  const merged: AppConfig = {
    version: APP_CONFIG_VERSION,
    backend: { ...DEFAULT.backend, ...raw.backend },
    storagePaths: {
      ...DEFAULT.storagePaths,
      ...(raw.storagePaths ?? {}),
      assetsDir: legacyStoragePaths.assetsDir ?? legacyStoragePaths.imagesDir ?? legacyStoragePaths.annotationsDir ?? "",
      globalConfigDir: typeof legacyStoragePaths.globalConfigDir === "string" ? legacyStoragePaths.globalConfigDir : "",
    },
    pageFlow: { ...DEFAULT.pageFlow },
    shortcuts: { ...DEFAULT.shortcuts, ...raw.shortcuts },
  }
  return applyLegacyPort(merged)
}

function parseAppConfigJson(jsonText: string): AppConfig | null {
  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!isAppConfigAnyVersion(parsed)) return null
    return normalizeAnyToV2(parsed)
  } catch {
    return null
  }
}

function readLegacyLocalStorage(): AppConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.appConfig)
    if (!raw) return null
    return parseAppConfigJson(raw)
  } catch {
    return null
  }
}

function removeLegacyAppConfigLocalStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.appConfig)
  } catch {
    // ignore
  }
}

/** 启动后由 hydrate 写入；在此之前 loadAppConfig 仅作兜底 */
let memoryConfig: AppConfig | null = null
let hydratePromise: Promise<void> | null = null

function resolveSaveGlobalConfigDir(cfg: AppConfig): string {
  return cfg.storagePaths.globalConfigDir.trim()
}

export function loadAppConfig(): AppConfig {
  if (memoryConfig) return memoryConfig
  return readLegacyLocalStorage() ?? { ...DEFAULT }
}

function persistAppConfigToDisk(cfg: AppConfig): void {
  void ipc.app
    .SaveAppConfigToDisk({
      globalConfigDir: resolveSaveGlobalConfigDir(cfg),
      appConfigJson: JSON.stringify(cfg, null, 2),
    })
    .catch(() => {
      // 写入失败时内存仍为最新；用户可在设置页重试
    })
}

/**
 * 从磁盘加载应用配置（权威），并一次性迁移旧版 localStorage `ea-app-config`。
 * 须在路由渲染前调用一次（见 App.tsx）。
 */
export function hydrateAppConfigFromDisk(): Promise<void> {
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    const defRes = await ipc.app.GetDefaultGlobalConfigDir({})
    const defaultDir = (defRes.path || "").trim()

    const legacy = readLegacyLocalStorage()
    const dirsToTry: string[] = []
    const legacyDir = legacy?.storagePaths.globalConfigDir?.trim()
    if (legacyDir) dirsToTry.push(legacyDir)
    if (defaultDir && !dirsToTry.includes(defaultDir)) dirsToTry.push(defaultDir)

    for (const dir of dirsToTry) {
      const r = await ipc.app.GetAppConfigFromDisk({ globalConfigDir: dir })
      if (r.errorMessage) continue
      if (r.exists && (r.appConfigJson || "").trim()) {
        const parsed = parseAppConfigJson(r.appConfigJson)
        if (parsed) {
          memoryConfig = parsed
          removeLegacyAppConfigLocalStorage()
          return
        }
      }
    }

    if (legacy) {
      memoryConfig = legacy
      const saveDir = resolveSaveGlobalConfigDir(legacy) || defaultDir
      await ipc.app.SaveAppConfigToDisk({
        globalConfigDir: saveDir,
        appConfigJson: JSON.stringify(memoryConfig, null, 2),
      })
      removeLegacyAppConfigLocalStorage()
      return
    }

    memoryConfig = {
      ...DEFAULT,
      storagePaths: { ...DEFAULT.storagePaths, globalConfigDir: defaultDir },
    }
    await ipc.app.SaveAppConfigToDisk({
      globalConfigDir: defaultDir,
      appConfigJson: JSON.stringify(memoryConfig, null, 2),
    })
  })()
  return hydratePromise
}

export function updateAppConfig(patch: {
  backend?: Partial<AppConfig["backend"]>
  storagePaths?: Partial<AppConfig["storagePaths"]>
  shortcuts?: Partial<AppConfig["shortcuts"]>
  pageFlow?: {
    workflow?: Partial<AppConfig["pageFlow"]["workflow"]>
    models?: Partial<AppConfig["pageFlow"]["models"]>
    monitor?: Partial<AppConfig["pageFlow"]["monitor"]>
  }
}): void {
  const cur = loadAppConfig()
  const backend = { ...cur.backend, ...patch.backend }
  const storagePaths = { ...cur.storagePaths, ...patch.storagePaths }
  const pageFlow = {
    workflow: { ...cur.pageFlow.workflow, ...patch.pageFlow?.workflow },
    models: {
      ...cur.pageFlow.models,
      ...patch.pageFlow?.models,
      defaultPage: isModelsDefaultPage(patch.pageFlow?.models?.defaultPage)
        ? patch.pageFlow.models.defaultPage
        : cur.pageFlow.models.defaultPage,
    },
    monitor: { ...cur.pageFlow.monitor, ...patch.pageFlow?.monitor },
  }
  const shortcuts = { ...cur.shortcuts, ...patch.shortcuts }
  if (patch.shortcuts) {
    for (const k of Object.keys(patch.shortcuts)) {
      const v = patch.shortcuts[k]
      if (v === "" || v === undefined) {
        delete shortcuts[k]
      }
    }
  }
  const next: AppConfig = {
    ...cur,
    version: APP_CONFIG_VERSION,
    backend,
    storagePaths,
    pageFlow,
    shortcuts,
  }
  memoryConfig = next
  persistAppConfigToDisk(next)
}

export function resetAppConfigToDefaults(): void {
  memoryConfig = { ...DEFAULT }
  persistAppConfigToDisk(memoryConfig)
}

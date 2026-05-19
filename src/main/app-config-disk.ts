import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const APP_NAME = "EasyAnnotate"
const CONFIG_FILE_NAME = "app-config.json"

export function getDefaultGlobalConfigDir(): string {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    return path.join(base, APP_NAME, "config")
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME, "config")
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdg, APP_NAME.toLowerCase(), "config")
}

export function getDefaultDatabaseDir(): string {
  if (process.platform === "win32") {
    const base = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Documents") : path.join(os.homedir(), "Documents")
    return path.join(base, APP_NAME, "database")
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Documents", APP_NAME, "database")
  }
  return path.join(os.homedir(), APP_NAME.toLowerCase(), "database")
}

function resolveConfigDir(globalConfigDir: string): string {
  const trimmed = globalConfigDir.trim()
  return trimmed ? trimmed : getDefaultGlobalConfigDir()
}

export function saveAppConfigToDisk(globalConfigDir: string, appConfigJson: string): void {
  const configDir = resolveConfigDir(globalConfigDir)
  fs.mkdirSync(configDir, { recursive: true })
  const filePath = path.join(configDir, CONFIG_FILE_NAME)
  fs.writeFileSync(filePath, appConfigJson, "utf8")
}

export function readAppConfigFromDisk(globalConfigDir: string): { jsonText: string; exists: boolean } {
  const configDir = resolveConfigDir(globalConfigDir)
  const filePath = path.join(configDir, CONFIG_FILE_NAME)
  try {
    if (!fs.existsSync(filePath)) {
      return { jsonText: "", exists: false }
    }
    return { jsonText: fs.readFileSync(filePath, "utf8"), exists: true }
  } catch {
    return { jsonText: "", exists: false }
  }
}

function copyDirRecursive(src: string, dest: string): number {
  if (!fs.existsSync(src)) return 0
  fs.mkdirSync(dest, { recursive: true })
  let count = 0
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
      count += 1
    }
  }
  return count
}

/**
 * Patch `globalConfigDir` inside an existing `app-config.json`.
 * If the file doesn't exist or isn't valid JSON, create a minimal one.
 */
function patchConfigDirInFile(configFilePath: string, newGlobalConfigDir: string): void {
  let data: Record<string, unknown> = {}
  try {
    if (fs.existsSync(configFilePath)) {
      const raw = fs.readFileSync(configFilePath, "utf8")
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>
    }
  } catch {
    // start from empty
  }
  if (typeof data.storagePaths !== "object" || data.storagePaths === null) {
    data.storagePaths = {}
  }
  ;(data.storagePaths as Record<string, unknown>).globalConfigDir = newGlobalConfigDir
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true })
  fs.writeFileSync(configFilePath, JSON.stringify(data, null, 2), "utf8")
}

/**
 * Copy all contents from oldDir to newDir (recursive).
 * After copying:
 * - The `app-config.json` in newDir is patched to reflect the new path.
 * - The default dir's `app-config.json` is also updated to point to the new path
 *   so that `hydrateAppConfigFromDisk` can find it on next launch.
 * - The default dir's config and data are never deleted.
 */
export function migrateGlobalConfigDir(
  oldDir: string,
  newDir: string,
): { success: boolean; errorMessage: string; copiedCount: number } {
  const resolvedOld = resolveConfigDir(oldDir)
  const resolvedNew = newDir.trim()
  if (!resolvedNew) {
    return { success: false, errorMessage: "目标路径不能为空。", copiedCount: 0 }
  }
  const normOld = path.resolve(resolvedOld)
  const normNew = path.resolve(resolvedNew)
  if (normOld === normNew) {
    return { success: true, errorMessage: "", copiedCount: 0 }
  }
  try {
    let copiedCount = 0
    if (fs.existsSync(resolvedOld)) {
      copiedCount = copyDirRecursive(resolvedOld, resolvedNew)
    } else {
      fs.mkdirSync(resolvedNew, { recursive: true })
    }
    patchConfigDirInFile(path.join(resolvedNew, CONFIG_FILE_NAME), resolvedNew)

    const defaultDir = getDefaultGlobalConfigDir()
    const defaultConfigFile = path.join(defaultDir, CONFIG_FILE_NAME)
    patchConfigDirInFile(defaultConfigFile, resolvedNew)

    return { success: true, errorMessage: "", copiedCount }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, errorMessage: `迁移失败：${msg}`, copiedCount: 0 }
  }
}

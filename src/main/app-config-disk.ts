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

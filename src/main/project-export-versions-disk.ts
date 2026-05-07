/**
 * 项目导出页 Version 列表：globalConfigDir/project-export-versions/<projectId>.json
 */
import fs from "node:fs"
import path from "node:path"
import { getDefaultGlobalConfigDir } from "./app-config-disk"

function resolveGlobalConfigDir(globalConfigDir: string): string {
  const dir = globalConfigDir.trim()
  return dir || getDefaultGlobalConfigDir()
}

function sanitizeFileSegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "default"
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
}

const SUBDIR = "project-export-versions"

function filePath(globalConfigDir: string, projectId: string): string {
  return path.join(resolveGlobalConfigDir(globalConfigDir), SUBDIR, `${sanitizeFileSegment(projectId)}.json`)
}

function assertValidDocJson(jsonText: string): void {
  let data: unknown
  try {
    data = JSON.parse(jsonText) as unknown
  } catch {
    throw new Error("导出版本 JSON 无法解析。")
  }
  if (typeof data !== "object" || data === null) {
    throw new Error("导出版本 JSON 格式无效。")
  }
  const o = data as { version?: unknown; items?: unknown }
  if (o.version !== 1 || !Array.isArray(o.items)) {
    throw new Error("导出版本 JSON 结构无效（需 version:1 与 items 数组）。")
  }
}

export function readProjectExportVersionsJson(globalConfigDir: string, projectId: string): { jsonText: string; exists: boolean } {
  const fp = filePath(globalConfigDir, projectId)
  try {
    if (!fs.existsSync(fp)) {
      return { jsonText: "", exists: false }
    }
    const jsonText = fs.readFileSync(fp, "utf8")
    return { jsonText, exists: true }
  } catch {
    return { jsonText: "", exists: false }
  }
}

export function writeProjectExportVersionsJson(globalConfigDir: string, projectId: string, jsonText: string): void {
  assertValidDocJson(jsonText)
  const fp = filePath(globalConfigDir, projectId)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, jsonText, "utf8")
}

export function deleteProjectExportVersionsFile(globalConfigDir: string, projectId: string): void {
  try {
    const fp = filePath(globalConfigDir, projectId)
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp)
    }
  } catch {
    // ignore
  }
}

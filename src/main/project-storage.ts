import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { getDefaultGlobalConfigDir } from "./app-config-disk"

export type ProjectRecord = {
  id: string
  name: string
  projectInfo: string
  projectType: string
  storageType: "local" | "remote"
  localPath: string
  remoteIp: string
  remotePort: string
  updatedAt: string
  configFilePath: string
  tags: ProjectTagRecord[]
}

export type ProjectTagRecord = {
  name: string
  color: string
}

type ProjectIndexFile = {
  version: 1
  projects: ProjectRecord[]
}

const INDEX_FILE_NAME = "projects-index.json"
const LOCAL_PROJECT_CONFIG_FILE_NAME = "easyannotate.project.json"

function resolveGlobalConfigDir(globalConfigDir: string): string {
  const dir = globalConfigDir.trim()
  return dir || getDefaultGlobalConfigDir()
}

function indexFilePath(globalConfigDir: string): string {
  return path.join(resolveGlobalConfigDir(globalConfigDir), INDEX_FILE_NAME)
}

function readProjectIndex(globalConfigDir: string): ProjectIndexFile {
  const filePath = indexFilePath(globalConfigDir)
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const data = JSON.parse(raw) as unknown
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { version?: unknown }).version === 1 &&
      Array.isArray((data as { projects?: unknown }).projects)
    ) {
      const parsed = data as ProjectIndexFile
      return {
        version: 1,
        projects: parsed.projects
          .map(normalizeProjectRecord)
          .filter((item): item is ProjectRecord => item !== undefined),
      }
    }
    return { version: 1, projects: [] }
  } catch {
    return { version: 1, projects: [] }
  }
}

function normalizeProjectRecord(raw: unknown): ProjectRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const item = raw as Partial<ProjectRecord> & { tags?: unknown }
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.projectInfo !== "string" ||
    typeof item.projectType !== "string" ||
    (item.storageType !== "local" && item.storageType !== "remote") ||
    typeof item.localPath !== "string" ||
    typeof item.remoteIp !== "string" ||
    typeof item.remotePort !== "string" ||
    typeof item.updatedAt !== "string" ||
    typeof item.configFilePath !== "string"
  ) {
    return undefined
  }
  return {
    id: item.id,
    name: item.name,
    projectInfo: item.projectInfo,
    projectType: item.projectType,
    storageType: item.storageType,
    localPath: item.localPath,
    remoteIp: item.remoteIp,
    remotePort: item.remotePort,
    updatedAt: item.updatedAt,
    configFilePath: item.configFilePath,
    tags: normalizeTags(item.tags),
  }
}

function normalizeColor(raw: unknown): string {
  if (typeof raw !== "string") return "#22c55e"
  const value = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  return "#22c55e"
}

function normalizeTags(raw: unknown): ProjectTagRecord[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tags: ProjectTagRecord[] = []
  for (const item of raw) {
    if (typeof item === "string") {
      const value = item.trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      tags.push({ name: value, color: "#22c55e" })
      continue
    }
    if (typeof item !== "object" || item === null) continue
    const tag = item as { name?: unknown; color?: unknown }
    const name = typeof tag.name === "string" ? tag.name.trim() : ""
    if (!name || seen.has(name)) continue
    seen.add(name)
    tags.push({
      name,
      color: normalizeColor(tag.color),
    })
  }
  return tags
}

function writeProjectIndex(globalConfigDir: string, next: ProjectIndexFile): void {
  const filePath = indexFilePath(globalConfigDir)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8")
}

function assertLocalPathEmpty(localPath: string): void {
  const target = localPath.trim()
  if (!target) throw new Error("请选择本地路径。")
  const stat = fs.statSync(target)
  if (!stat.isDirectory()) throw new Error("所选路径不是目录，请重新选择项目路径。")
  const files = fs.readdirSync(target)
  if (files.length > 0) throw new Error("目录不为空，请重新选择项目路径。")
}

export function createProject(input: {
  globalConfigDir: string
  name: string
  projectInfo: string
  projectType: string
  storageType: "local" | "remote"
  localPath: string
  remoteIp: string
  remotePort: string
  tags: ProjectTagRecord[]
}): ProjectRecord {
  const id = randomUUID()
  const updatedAt = new Date().toISOString()
  const projectName = input.name.trim()
  const globalDir = resolveGlobalConfigDir(input.globalConfigDir)
  fs.mkdirSync(globalDir, { recursive: true })

  let configFilePath = ""
  if (input.storageType === "local") {
    assertLocalPathEmpty(input.localPath)
    const targetPath = input.localPath.trim()
    configFilePath = path.join(targetPath, LOCAL_PROJECT_CONFIG_FILE_NAME)
  } else {
    const remoteConfigDir = path.join(globalDir, "projects")
    fs.mkdirSync(remoteConfigDir, { recursive: true })
    configFilePath = path.join(remoteConfigDir, `${id}.project.json`)
  }

  const record: ProjectRecord = {
    id,
    name: projectName,
    projectInfo: input.projectInfo.trim(),
    projectType: input.projectType.trim(),
    storageType: input.storageType,
    localPath: input.storageType === "local" ? input.localPath.trim() : "",
    remoteIp: input.storageType === "remote" ? input.remoteIp.trim() : "",
    remotePort: input.storageType === "remote" ? input.remotePort.trim() : "",
    updatedAt,
    configFilePath,
    tags: normalizeTags(input.tags),
  }

  const projectConfig = {
    version: 1,
    createdAt: updatedAt,
    ...record,
    extraConfig: {},
  }
  fs.writeFileSync(configFilePath, JSON.stringify(projectConfig, null, 2), "utf8")

  const index = readProjectIndex(globalDir)
  writeProjectIndex(globalDir, {
    version: 1,
    projects: [record, ...index.projects],
  })
  return record
}

export function listProjects(globalConfigDir: string): ProjectRecord[] {
  const index = readProjectIndex(globalConfigDir)
  return [...index.projects].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function getProject(globalConfigDir: string, id: string): ProjectRecord | undefined {
  return listProjects(globalConfigDir).find((p) => p.id === id)
}

export function updateProject(input: {
  globalConfigDir: string
  id: string
  name: string
  projectInfo: string
  tags: ProjectTagRecord[]
}): ProjectRecord | undefined {
  const index = readProjectIndex(input.globalConfigDir)
  const target = index.projects.find((item) => item.id === input.id)
  if (!target) return undefined

  const nextRecord: ProjectRecord = {
    ...target,
    name: input.name.trim(),
    projectInfo: input.projectInfo.trim(),
    tags: normalizeTags(input.tags),
    updatedAt: new Date().toISOString(),
  }

  const nextProjects = index.projects.map((item) => (item.id === input.id ? nextRecord : item))
  writeProjectIndex(input.globalConfigDir, {
    version: 1,
    projects: nextProjects,
  })

  const projectConfig = {
    version: 1,
    ...nextRecord,
    extraConfig: {},
  }
  fs.writeFileSync(nextRecord.configFilePath, JSON.stringify(projectConfig, null, 2), "utf8")
  return nextRecord
}

export function deleteProject(globalConfigDir: string, id: string): boolean {
  const index = readProjectIndex(globalConfigDir)
  const target = index.projects.find((item) => item.id === id)
  if (!target) return false

  const nextProjects = index.projects.filter((item) => item.id !== id)
  writeProjectIndex(globalConfigDir, {
    version: 1,
    projects: nextProjects,
  })

  try {
    if (target.configFilePath && fs.existsSync(target.configFilePath)) {
      fs.unlinkSync(target.configFilePath)
    }
  } catch {
    // Ignore config cleanup failures to avoid blocking deletion from index.
  }

  return true
}

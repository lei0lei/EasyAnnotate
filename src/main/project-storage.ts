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
      return data as ProjectIndexFile
    }
    return { version: 1, projects: [] }
  } catch {
    return { version: 1, projects: [] }
  }
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

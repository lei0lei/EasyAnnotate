import { ipc } from "@/gen/ipc"
import { loadAppConfig } from "@/lib/app-config-storage"

export type ProjectItem = {
  id: string
  name: string
  projectInfo: string
  projectType: string
  storageType: string
  localPath: string
  remoteIp: string
  remotePort: string
  updatedAt: string
  configFilePath: string
}

function globalConfigDir(): string {
  return loadAppConfig().storagePaths.globalConfigDir
}

function mapProject(project: {
  id: string
  name: string
  projectInfo: string
  projectType: string
  storageType: string
  localPath: string
  remoteIp: string
  remotePort: string
  updatedAt: string
  configFilePath: string
}): ProjectItem {
  return {
    id: project.id,
    name: project.name,
    projectInfo: project.projectInfo,
    projectType: project.projectType,
    storageType: project.storageType,
    localPath: project.localPath,
    remoteIp: project.remoteIp,
    remotePort: project.remotePort,
    updatedAt: project.updatedAt,
    configFilePath: project.configFilePath,
  }
}

export async function createProject(payload: {
  name: string
  projectInfo: string
  projectType: string
  storageType: string
  localPath: string
  remoteIp: string
  remotePort: string
}): Promise<{ project?: ProjectItem; errorMessage: string }> {
  const response = await ipc.app.CreateProject({
    globalConfigDir: globalConfigDir(),
    ...payload,
  })
  if (response.errorMessage) {
    return { errorMessage: response.errorMessage }
  }
  return { project: mapProject(response.project), errorMessage: "" }
}

export async function listProjects(): Promise<ProjectItem[]> {
  const response = await ipc.app.ListProjects({
    globalConfigDir: globalConfigDir(),
  })
  return response.projects.map(mapProject)
}

export async function getProject(id: string): Promise<ProjectItem | undefined> {
  const response = await ipc.app.GetProject({
    globalConfigDir: globalConfigDir(),
    id,
  })
  if (!response.found) return undefined
  return mapProject(response.project)
}

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const CHILD_WORKERS_DIR_NAME = "child-workers"
const PACKAGED_NODE_DIR_NAME = "node"

export type ChildProcessLaunch = {
  command: string
  args: string[]
  cwd: string
  mode: "packaged" | "dev"
}

export type ChildProcessLaunchResult = {
  launch: ChildProcessLaunch | null
  reason: string
}

function findDevProjectRoot(): string | null {
  const seeds = new Set<string>([process.cwd()])
  try {
    seeds.add(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    /* ignore */
  }
  for (const seed of seeds) {
    let dir = path.resolve(seed)
    for (let depth = 0; depth < 12; depth += 1) {
      const pkgPath = path.join(dir, "package.json")
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string }
          if (pkg.name === "easy-annotate") return dir
        } catch {
          /* ignore invalid package.json */
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

/** 安装版/便携版：EasyAnnotate.exe 同级的 resources/ 目录（不依赖 @mobrowser/api，避免打进子进程 bundle） */
function resolvePackagedResourcesDir(): string | null {
  const resourcesDir = path.join(path.dirname(process.execPath), "resources")
  if (fs.existsSync(path.join(resourcesDir, "app.bin")) || fs.existsSync(path.join(resourcesDir, "mobrowser.app.id"))) {
    return resourcesDir
  }
  return null
}

function isPackagedRuntime(): boolean {
  return resolvePackagedResourcesDir() !== null
}

function packagedNodeExecutable(appResourcesDir: string): string {
  if (process.platform === "win32") {
    return path.join(appResourcesDir, PACKAGED_NODE_DIR_NAME, "node.exe")
  }
  return path.join(appResourcesDir, PACKAGED_NODE_DIR_NAME, "node")
}

function resolveSystemNodeExecutable(): string | null {
  const execBase = path.basename(process.execPath).toLowerCase()
  if (execBase === "node.exe" || execBase === "node") {
    return process.execPath
  }

  for (const envCandidate of [process.env.NODE_EXE, process.env.npm_node_execpath]) {
    const trimmed = (envCandidate || "").trim()
    if (trimmed && fs.existsSync(trimmed)) return trimmed
  }

  if (process.platform === "win32") {
    try {
      const output = execFileSync("where.exe", ["node"], { encoding: "utf8", windowsHide: true }).trim()
      const candidate = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (candidate && fs.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
    const programFiles = process.env.ProgramFiles || "C:\\Program Files"
    const winCandidates = [
      path.join(programFiles, "nodejs", "node.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
    ]
    for (const candidate of winCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  } else {
    try {
      const output = execFileSync("which", ["node"], { encoding: "utf8" }).trim()
      if (output && fs.existsSync(output)) return output
    } catch {
      /* ignore */
    }
  }
  return null
}

function resolveNodeExecutable(): string | null {
  const packagedResources = resolvePackagedResourcesDir()
  if (packagedResources) {
    const bundled = packagedNodeExecutable(packagedResources)
    if (fs.existsSync(bundled)) return bundled
  }
  return resolveSystemNodeExecutable()
}

function resolveChildWorkersDir(): { dir: string; mode: "packaged" | "dev" } | null {
  const packagedResources = resolvePackagedResourcesDir()
  if (packagedResources) {
    const packagedDir = path.join(packagedResources, CHILD_WORKERS_DIR_NAME)
    if (fs.existsSync(packagedDir)) {
      return { dir: packagedDir, mode: "packaged" }
    }
  }

  const root = findDevProjectRoot()
  if (!root) return null
  const devDir = path.join(root, "out", "main")
  if (!fs.existsSync(devDir)) return null
  return { dir: devDir, mode: "dev" }
}

export function resolveChildScriptLaunch(
  scriptFileName: string,
  scriptArgs: string[],
  options?: { requireAssets?: boolean },
): ChildProcessLaunchResult {
  const nodeExe = resolveNodeExecutable()
  if (!nodeExe) {
    return {
      launch: null,
      reason: isPackagedRuntime()
        ? "未找到内置 Node.js（安装包可能不完整，请重新安装）"
        : "未找到 Node.js（请安装 Node 并加入 PATH，或安装到 Program Files\\nodejs）",
    }
  }

  const workers = resolveChildWorkersDir()
  if (!workers) {
    return {
      launch: null,
      reason: isPackagedRuntime()
        ? "未找到内置子进程脚本（安装包可能不完整，请重新安装）"
        : `未找到项目根目录或 out/main（当前 cwd=${process.cwd()}）`,
    }
  }

  const bundledScript = path.join(workers.dir, scriptFileName)
  if (!fs.existsSync(bundledScript)) {
    return {
      launch: null,
      reason: isPackagedRuntime()
        ? `未找到内置子进程脚本：${scriptFileName}`
        : `未找到 ${bundledScript}，请在项目根目录执行：npx vite build --mode main`,
    }
  }

  if (options?.requireAssets !== false) {
    const assetsDir = path.join(workers.dir, "assets")
    if (!fs.existsSync(assetsDir)) {
      return {
        launch: null,
        reason: isPackagedRuntime()
          ? "缺少内置子进程 assets 目录（安装包可能不完整，请重新安装）"
          : `缺少 ${assetsDir}，请重新执行：npx vite build --mode main`,
      }
    }
  }

  return {
    launch: {
      command: nodeExe,
      args: [bundledScript, ...scriptArgs],
      cwd: workers.dir,
      mode: workers.mode,
    },
    reason: "",
  }
}

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outMainDir = path.join(projectRoot, "out", "main")
const distRoot = path.join(projectRoot, "build", "dist")
const mobrowserConfPath = path.join(projectRoot, "mobrowser.conf.json")

function ensureMainBuild() {
  if (!existsSync(outMainDir)) {
    throw new Error(`缺少 ${outMainDir}，请先执行：npm run build（或 mobrowser build）`)
  }
  const childScripts = readdirSync(outMainDir).filter((name) => name.endsWith("-child.js"))
  if (childScripts.length === 0) {
    throw new Error(`未在 ${outMainDir} 找到 *-child.js，请先执行：npm run build（或 mobrowser build）`)
  }
}

function readAppVersion() {
  const conf = JSON.parse(readFileSync(mobrowserConfPath, "utf8"))
  const version = conf?.app?.version
  if (!version) {
    throw new Error(`无法从 ${mobrowserConfPath} 读取 app.version`)
  }
  return `${version.major}.${version.minor}.${version.patch}`
}

function readAppName() {
  const conf = JSON.parse(readFileSync(mobrowserConfPath, "utf8"))
  const name = conf?.app?.name?.trim()
  if (!name) {
    throw new Error(`无法从 ${mobrowserConfPath} 读取 app.name`)
  }
  return name
}

function resolveVpkExecutable() {
  const sdkDir = process.platform === "win32"
    ? path.join(projectRoot, "node_modules", "@mobrowser", "sdk-win-x64", "bin", "installer", "vpk.exe")
    : process.platform === "darwin"
      ? path.join(projectRoot, "node_modules", "@mobrowser", "sdk-darwin-arm64", "bin", "installer", "vpk")
      : path.join(projectRoot, "node_modules", "@mobrowser", "sdk-linux-x64", "bin", "installer", "vpk")
  if (!existsSync(sdkDir)) {
    return null
  }
  return sdkDir
}

function writeChildWorkersPackageJson(childWorkersDir) {
  writeFileSync(path.join(childWorkersDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8")
}

function copyChildWorkers(targetResourcesDir) {
  const childWorkersDir = path.join(targetResourcesDir, "child-workers")
  rmSync(childWorkersDir, { recursive: true, force: true })
  mkdirSync(childWorkersDir, { recursive: true })

  for (const entry of readdirSync(outMainDir)) {
    const src = path.join(outMainDir, entry)
    if (entry.endsWith("-child.js") || entry.endsWith("-child.js.map")) {
      cpSync(src, path.join(childWorkersDir, entry))
      continue
    }
    if (entry === "assets" && statSync(src).isDirectory()) {
      cpSync(src, path.join(childWorkersDir, "assets"), { recursive: true })
    }
  }
  writeChildWorkersPackageJson(childWorkersDir)
}

function copyBundledNode(targetResourcesDir) {
  const nodeDir = path.join(targetResourcesDir, "node")
  rmSync(nodeDir, { recursive: true, force: true })
  mkdirSync(nodeDir, { recursive: true })

  const nodeFileName = process.platform === "win32" ? "node.exe" : "node"
  const targetNode = path.join(nodeDir, nodeFileName)
  cpSync(process.execPath, targetNode)

  if (process.platform !== "win32") {
    execFileSync("chmod", ["+x", targetNode], { stdio: "ignore" })
  }
}

function stageResourcesDir(targetResourcesDir) {
  mkdirSync(targetResourcesDir, { recursive: true })
  copyChildWorkers(targetResourcesDir)
  copyBundledNode(targetResourcesDir)
}

function repackInstaller(platformDir) {
  const vpk = resolveVpkExecutable()
  if (!vpk) {
    console.warn("[stage-packaged-runtime] 未找到 vpk，跳过安装包重建。")
    return
  }

  const binDir = path.join(distRoot, platformDir, "bin")
  const packDir = path.join(distRoot, platformDir, "pack")
  if (!existsSync(binDir) || !existsSync(packDir)) {
    return
  }

  for (const entry of readdirSync(packDir)) {
    rmSync(path.join(packDir, entry), { recursive: true, force: true })
  }

  const appName = readAppName()
  const version = readAppVersion()
  const mainExe = process.platform === "win32" ? `${appName}.exe` : appName
  const iconPath = path.join(
    projectRoot,
    "assets",
    process.platform === "win32" ? "app.ico" : process.platform === "darwin" ? "app.icns" : "app.png",
  )

  const args = [
    "pack",
    "-o", packDir,
    "-p", binDir,
    "--mainExe", mainExe,
    "-v", version,
    "--exclude", ".*\\.(pdb|lib|exp)",
    "--noPortable",
    "--delta", "BestSpeed",
    "-u", appName,
  ]
  if (existsSync(iconPath)) {
    args.push("-i", iconPath)
  }

  execFileSync(vpk, args, { stdio: "inherit", cwd: projectRoot })
  console.log(`[stage-packaged-runtime] 已重建 ${packDir} 安装包（含 child-workers 与 node）`)
}

function stagePost() {
  ensureMainBuild()

  if (!existsSync(distRoot)) {
    console.warn("[stage-packaged-runtime] 未找到 build/dist，跳过。")
    return
  }

  for (const platformDir of readdirSync(distRoot)) {
    const resourcesDir = path.join(distRoot, platformDir, "bin", "resources")
    if (!existsSync(resourcesDir)) continue

    stageResourcesDir(resourcesDir)
    console.log(`[stage-packaged-runtime] 已写入 ${resourcesDir}/child-workers 与 node/`)
    repackInstaller(platformDir)
  }
}

stagePost()

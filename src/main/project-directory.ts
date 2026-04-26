import fs from "node:fs"

type ProjectDirectoryValidation = {
  isEmpty: boolean
  errorMessage: string
}

export function validateProjectDirectory(inputPath: string): ProjectDirectoryValidation {
  const target = inputPath.trim()
  if (!target) {
    return {
      isEmpty: false,
      errorMessage: "请先选择项目路径。",
    }
  }

  try {
    const stat = fs.statSync(target)
    if (!stat.isDirectory()) {
      return {
        isEmpty: false,
        errorMessage: "所选路径不是目录，请重新选择项目路径。",
      }
    }

    const files = fs.readdirSync(target)
    if (files.length > 0) {
      return {
        isEmpty: false,
        errorMessage: "目录不为空，请重新选择项目路径。",
      }
    }

    return {
      isEmpty: true,
      errorMessage: "",
    }
  } catch (error) {
    return {
      isEmpty: false,
      errorMessage: error instanceof Error ? error.message : "无法访问目录，请重新选择项目路径。",
    }
  }
}

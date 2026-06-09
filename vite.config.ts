import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type UserConfig } from "vite"

export default defineConfig(({ mode }) => {
  if (mode === "main") {
    return defineMainConfig()
  }
  if (mode === "renderer") {
    return defineRendererConfig()
  }
  throw new Error(`Unsupported Vite config mode: ${mode}`)
})

function defineMainConfig(): UserConfig {
  return {
    root: path.resolve(__dirname, "./src/main"),
    ssr: {
      noExternal: true,
    },
    build: {
      target: "node20",
      outDir: path.resolve(__dirname, "./out/main"),
      emptyOutDir: true,
      sourcemap: true,
      ssr: true,
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "./src/main/index.ts"),
          "dataset-export-child": path.resolve(__dirname, "./src/main/dataset-export-child.ts"),
          "task-import-child": path.resolve(__dirname, "./src/main/task-import-child.ts"),
          "task-delete-child": path.resolve(__dirname, "./src/main/task-delete-child.ts"),
          "yolo-dataset-upload-child": path.resolve(__dirname, "./src/main/yolo-dataset-upload-child.ts"),
          "yolo-batch-file-upload-child": path.resolve(__dirname, "./src/main/yolo-batch-file-upload-child.ts"),
          "yolo-batch-auto-annotate-child": path.resolve(__dirname, "./src/main/yolo-batch-auto-annotate-child.ts"),
          "tensorrt-conversion-child": path.resolve(__dirname, "./src/main/tensorrt-conversion-child.ts"),
        },
        external: [
          "mobrowser",
        ],
        output: {
          format: "es",
          entryFileNames: "[name].js",
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src/main"),
      },
    },
    server: {
      forwardConsole: {
        unhandledErrors: true,
        logLevels: ['warn', 'error'],
      },
    },
  }
}


function defineRendererConfig(): UserConfig {
  return {
    root: path.resolve(__dirname, "./src/renderer"),
    plugins: [react()],
    build: {
      outDir: path.resolve(__dirname, "./out/renderer"),
      emptyOutDir: true,
      sourcemap: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src/renderer"),
      },
    },
    server: {
      forwardConsole: {
        unhandledErrors: true,
        logLevels: ['warn', 'error'],
      },
    },
  }
}

# EasyAnnotate

桌面标注工具骨架：基于 [MōBrowser](https://teamdev.com/mobrowser/) 官方 **React + shadcn** 模板，使用 **Vite**、**React 19**、**Tailwind CSS v4**、**React Router 7**（`HashRouter`，便于主进程菜单通过 URL hash 切换页面）。

## 环境

- 推荐 **Node.js** 满足 `@mobrowser/cli` 要求（官方建议 `^22.22.2` 或 `>=24.14.1`）；略低版本可尝试 `npm install --ignore-engines`。
- 首次 `npm run dev` 会从网络拉取 MōBrowser 运行时与文档，需能访问 Google 存储。

## 常用命令

```bash
npm install
```

安装完成后会通过 `postinstall` 自动执行 `gen:proto`，生成 `src/main/gen/` 与 `src/renderer/gen/`（目录在 `.gitignore` 中忽略，克隆后需重新安装依赖以生成）。

手动生成 IPC / Protobuf 的 TypeScript（修改 `src/renderer/proto/*.proto` 后需重新执行）：

```bash
npm run gen
```

若 `npm run gen` 因网络无法下载文档包，可仅用本地工具链生成 proto 代码：

```bash
npm run gen:proto
```

启动桌面开发模式（Vite + MōBrowser）：

```bash
npm run dev
```

打包原生应用：

```bash
npm run build
```

## 项目结构（摘要）

- `src/main/`：主进程（窗口、IPC 注册等）
- `src/renderer/`：渲染进程（React UI、路由、shadcn 组件）
- `src/renderer/proto/`：IPC 的 `.proto` 定义
- `src/main/gen/`、`src/renderer/gen/`：由 `gen` / `gen:proto` 生成，勿手改
- `mobrowser.conf.json`：应用元数据与打包配置

## 界面与菜单

- 主进程 `src/main/app-menu.ts`：系统菜单 **文件 / 编辑 / 帮助**（欢迎使用、退出、关于等）。
- 应用内顶部 **Menubar**（shadcn）：**Project / Models / Settings / Requests**，见 `src/renderer/components/app-menubar.tsx`。
- 路由：`/` 欢迎页；`/project`、`/models`、`/settings`、`/requests` 为各模块占位页（`HashRouter`）。

/**
 * 所有持久化条目的 key 放在一处，避免散落魔法字符串，也方便将来迁到主进程 / 文件。
 *
 * 分层（概念上）:
 * - **应用配置** `ea-app-config`：与安装/本机环境相关、跟随软件的偏好（后端、快捷键、其它全局开关）。
 * - **内容数据** `ea-*` 独立 key：工作流、Monitor 等用户业务实体（列表型 JSON 数组或文档）。
 * - **UI 即时状态** 侧栏折叠、主题等：可继续用 localStorage 独立 key，升级时可并入 `app-config`。
 */
export const STORAGE_KEYS = {
  appConfig: "ea-app-config",
  workflowBoards: "ea-workflow-boards",
  monitors: "ea-monitors",
  exportVersionPrefix: "ea-export-versions",
  sidebarCollapsed: "ea-sidebar-collapsed",
  /** 与 `ThemeProvider` 默认的 storageKey 对齐，便于在代码里搜到 */
  theme: "vite-ui-theme",
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

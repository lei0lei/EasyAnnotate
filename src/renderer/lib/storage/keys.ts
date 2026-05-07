/**
 * 所有持久化条目的 key 放在一处，避免散落魔法字符串，也方便将来迁到主进程 / 文件。
 *
 * 分层（概念上）:
 * - **应用配置** `ea-app-config`：仅旧版迁移前可能残留；当前权威数据为全局目录下 `app-config.json`（见 `hydrateAppConfigFromDisk`）。
 * - **内容数据** `ea-*` 独立 key：工作流、Monitor 等用户业务实体（列表型 JSON 数组或文档）。
 * - **UI 即时状态** 侧栏折叠、主题等：可继续用 localStorage 独立 key，升级时可并入 `app-config`。
 */
export const STORAGE_KEYS = {
  appConfig: "ea-app-config",
  workflowBoards: "ea-workflow-boards",
  monitors: "ea-monitors",
  /** 旧版导出版本仅存于 localStorage 时的 key 前缀；迁移后数据在全局目录 project-export-versions/ */
  exportVersionPrefix: "ea-export-versions",
  sidebarCollapsed: "ea-sidebar-collapsed",
  /** 与 `ThemeProvider` 默认的 storageKey 对齐，便于在代码里搜到 */
  theme: "vite-ui-theme",
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

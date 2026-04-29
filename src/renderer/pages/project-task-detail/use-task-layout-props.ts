import { useMemo } from "react"
import type { TaskHeaderContainerProps } from "@/pages/project-task-detail/header-container"
import type { TaskSidebarContainerProps } from "@/pages/project-task-detail/sidebar-container"

type UseTaskHeaderPropsParams = TaskHeaderContainerProps
type UseTaskSidebarPropsParams = TaskSidebarContainerProps

export function useTaskHeaderProps(params: UseTaskHeaderPropsParams) {
  return useMemo(() => params, [params])
}

export function useTaskSidebarProps(params: UseTaskSidebarPropsParams) {
  return useMemo(() => params, [params])
}

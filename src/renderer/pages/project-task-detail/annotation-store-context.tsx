/**
 * 模块：project-task-detail/annotation-store-context
 * 职责：提供 Annotation Store 的 context 边界，供页面内任意子组件消费统一标注状态。
 * 边界：仅负责 store 透传与读取，不包含业务命令实现。
 */
import { createContext, useContext, type ReactNode } from "react"
import type { TaskAnnotationStore } from "@/pages/project-task-detail/use-task-annotation-state"

const AnnotationStoreContext = createContext<TaskAnnotationStore | null>(null)

export function AnnotationStoreProvider({ value, children }: { value: TaskAnnotationStore; children: ReactNode }) {
  return <AnnotationStoreContext.Provider value={value}>{children}</AnnotationStoreContext.Provider>
}

export function useAnnotationStore() {
  const context = useContext(AnnotationStoreContext)
  if (!context) {
    throw new Error("useAnnotationStore must be used within AnnotationStoreProvider")
  }
  return context
}

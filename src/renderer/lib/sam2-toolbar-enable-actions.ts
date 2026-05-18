import { setSam2AiToolbarEnabled } from "@/lib/sam2-ai-toolbar-prefs"

/**
 * 设置「任务页是否显示 SAM 标注」。
 * 仅切换本地工具栏开关，不停止全局 SAM runtime（实例由「后端模型管理」统一维护）。
 */
export async function applySam2AiToolbarEnabled(next: boolean): Promise<{ ok: boolean; error?: string }> {
  setSam2AiToolbarEnabled(next)
  return { ok: true }
}

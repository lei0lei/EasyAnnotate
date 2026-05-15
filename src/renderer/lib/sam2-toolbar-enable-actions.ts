import { setSam2AiToolbarEnabled } from "@/lib/sam2-ai-toolbar-prefs"
import { stopModelRuntime } from "@/lib/model-runtime-api"

/**
 * 设置「任务页是否显示 SAM2」。
 * 关闭时会先请求后端停止 sam2 运行时，再写入本地开关；失败则不写入并返回错误。
 */
export async function applySam2AiToolbarEnabled(next: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!next) {
    try {
      await stopModelRuntime("sam2")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/stop\s+(404|400)\b/i.test(msg)) {
        return { ok: false, error: msg }
      }
    }
  }
  setSam2AiToolbarEnabled(next)
  return { ok: true }
}

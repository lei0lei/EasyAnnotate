import { setSam2AiToolbarEnabled } from "@/lib/sam2-ai-toolbar-prefs"
import { stopAllSamAnnotationRuntimes } from "@/lib/sam-annotation-runtime"

/**
 * 设置「任务页是否显示 SAM 标注」。
 * 关闭时会先停止全部 SAM 标注 runtime（sam2 / mobile_sam），再写入本地开关。
 */
export async function applySam2AiToolbarEnabled(next: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!next) {
    try {
      await stopAllSamAnnotationRuntimes()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }
  setSam2AiToolbarEnabled(next)
  return { ok: true }
}

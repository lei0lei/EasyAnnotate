import { connectYoloMonitorWs, disconnectYoloMonitorWs } from "@/lib/backend-yolo-monitor-ws"
import { useEffect } from "react"

/** 训练进行中或历史详情页：建立 YOLO 监控 WS，离开时断开。 */
export function useYoloMonitorWsLifecycle(active: boolean) {
  useEffect(() => {
    if (!active) {
      void disconnectYoloMonitorWs()
      return
    }
    void connectYoloMonitorWs().catch(() => {
      // 连接失败时 API 调用会提示 WS 未连接
    })
    return () => {
      void disconnectYoloMonitorWs()
    }
  }, [active])
}

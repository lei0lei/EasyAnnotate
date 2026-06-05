import { connectSamBackendWs, disconnectSamBackendWs } from "@/lib/backend-sam-ws"
import { useEffect } from "react"

/** 任务页内：SAM 运行时已启动则建立 WS，离开页面或 SAM 停止则断开。 */
export function useSamBackendWsLifecycle(samRunning: boolean) {
  useEffect(() => {
    if (!samRunning) {
      void disconnectSamBackendWs()
      return
    }
    void connectSamBackendWs().catch(() => {
      // 连接失败时 prepare/decode 会提示 WS 未连接
    })
    return () => {
      void disconnectSamBackendWs()
    }
  }, [samRunning])
}

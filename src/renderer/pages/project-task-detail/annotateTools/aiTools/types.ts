/**
 * 模块：annotateTools/aiTools/types
 * 职责：画布左侧 AI 工具栏与弹窗的 props 类型。
 */

/** 解码器 prompt：正负点 / 矩形框 */
export type Sam2PromptMode = "point" | "bbox"

/** 解码输出：多边形轮廓 / 分割掩码 / 边界框 */
export type Sam2AutoAnnotationFormat = "polygon" | "mask" | "box"

export type ActiveSamRuntimeInfo = {
  /** 人类可读：族 · 权重 */
  label: string
  running: boolean
}

export type TaskAiToolPaletteProps = {
  /** 项目配置中的非 skeleton 类标签（与普通标注工具一致） */
  plainAnnotationLabels: string[]
  /** 在「自动标注 → SAM2 标注」中开启时，任务页 AI 工具栏才显示 SAM2 */
  sam2ToolbarEnabled: boolean
  sam2DialogOpen: boolean
  onSam2DialogOpenChange: (open: boolean) => void
  sam2SelectedLabel: string
  onSam2SelectedLabelChange: (label: string) => void
  sam2PromptMode: Sam2PromptMode
  onSam2PromptModeChange: (mode: Sam2PromptMode) => void
  sam2OutputFormat: Sam2AutoAnnotationFormat
  onSam2OutputFormatChange: (format: Sam2AutoAnnotationFormat) => void
  /** 多边形顶点倾向：0=少（左），100=多（右） */
  sam2PolygonVertexBias: number
  onSam2PolygonVertexBiasChange: (value: number) => void
  /** 悬停自动发 prompt（点：正点+物体框四角负点；框：以悬停为中心的物体框） */
  sam2AutoPromptEnabled: boolean
  onSam2AutoPromptEnabledChange: (enabled: boolean) => void
  sam2AutoObjectBoxW: number
  onSam2AutoObjectBoxWChange: (value: number) => void
  sam2AutoObjectBoxH: number
  onSam2AutoObjectBoxHChange: (value: number) => void
  /** 0–1，仅当 decoder 导出预测 IoU 时用于过滤 */
  sam2AutoIouThreshold: number
  onSam2AutoIouThresholdChange: (value: number) => void
  /** 0.3–1.5：悬停触发时间倍率 */
  sam2AutoHoverFactor: number
  onSam2AutoHoverFactorChange: (value: number) => void
  /** 0.3–1：SAM 编码/解码相对原图边长倍率（画布仍为原图坐标） */
  sam2InferScale: number
  onSam2InferScaleChange: (value: number) => void
  /** 配置页已启动的 SAM runtime（只读） */
  activeSamRuntime: ActiveSamRuntimeInfo | null
  /** SAM 面板点 OK：进入标注并刷新当前 model_id */
  onSam2Confirm: () => void
}

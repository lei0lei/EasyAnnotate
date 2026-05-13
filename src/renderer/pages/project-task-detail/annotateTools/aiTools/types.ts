/**
 * 模块：annotateTools/aiTools/types
 * 职责：画布左侧 AI 工具栏与弹窗的 props 类型。
 */

export type Sam2AutoAnnotationFormat = "box" | "mask"

export type TaskAiToolPaletteProps = {
  /** 项目配置中的非 skeleton 类标签（与普通标注工具一致） */
  plainAnnotationLabels: string[]
  sam2DialogOpen: boolean
  onSam2DialogOpenChange: (open: boolean) => void
  sam2SelectedLabel: string
  onSam2SelectedLabelChange: (label: string) => void
  sam2OutputFormat: Sam2AutoAnnotationFormat
  onSam2OutputFormatChange: (format: Sam2AutoAnnotationFormat) => void
}

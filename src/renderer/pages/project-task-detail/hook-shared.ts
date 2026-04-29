/**
 * 模块：project-task-detail/hook-shared
 * 职责：集中定义多个 hooks 共享的基础类型（ref、文件信息、高亮角点）。
 * 边界：类型汇总文件，不承载业务逻辑。
 */
import type { MutableRefObject } from "react"
import type { XAnyLabelFile } from "@/lib/xanylabeling-format"

export type ImageSize = { width: number; height: number }

export type ImageFileInfo = {
  exists: boolean
  sizeBytes: number
  format: string
  channelCount: number
  extension: string
  errorMessage: string
}

export type RawHighlightCorner = { shapeId: string; cornerIndex: number } | null

export type AnnotationDocRef = MutableRefObject<XAnyLabelFile | null>

export type StageElementRef = MutableRefObject<HTMLDivElement | null>

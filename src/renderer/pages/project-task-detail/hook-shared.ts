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

export type RawHighlightCorner = { shapeIndex: number; cornerIndex: number } | null

export type AnnotationDocRef = MutableRefObject<XAnyLabelFile | null>

export type StageElementRef = MutableRefObject<HTMLDivElement | null>

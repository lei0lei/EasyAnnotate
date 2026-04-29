/**
 * 模块：project-task-detail/use-task-canvas-state
 * 职责：集中管理画布视图相关状态（加载、缩放、偏移、舞台尺寸与 refs）。
 * 边界：仅提供状态容器，不包含绘制交互与数据同步逻辑。
 */
import { useRef, useState } from "react"

export function useTaskCanvasState() {
  const [imageObjectUrl, setImageObjectUrl] = useState("")
  const [activeImagePath, setActiveImagePath] = useState("")
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [imageLoadError, setImageLoadError] = useState(false)
  const [imageScale, setImageScale] = useState(1)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [imageFileInfo, setImageFileInfo] = useState({
    exists: false,
    sizeBytes: 0,
    format: "",
    channelCount: 0,
    extension: "",
    errorMessage: "",
  })

  const stageRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)

  return {
    imageObjectUrl,
    setImageObjectUrl,
    activeImagePath,
    setActiveImagePath,
    isImageLoading,
    setIsImageLoading,
    imageLoadError,
    setImageLoadError,
    imageScale,
    setImageScale,
    imageOffset,
    setImageOffset,
    isPanning,
    setIsPanning,
    imageNaturalSize,
    setImageNaturalSize,
    stageSize,
    setStageSize,
    imageFileInfo,
    setImageFileInfo,
    stageRef,
    panStartRef,
  }
}

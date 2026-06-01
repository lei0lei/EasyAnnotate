/**
 * 模块：project-task-detail/use-task-bootstrap
 * 职责：处理页面初始化与切图加载（文件拉取、图片加载、临时态重置）。
 * 边界：负责首屏与切换流程，不负责绘制交互细节。
 */
import { useCallback, useEffect, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { getProject, listTaskFiles, readImageFile, type ProjectItem, type TaskFileItem } from "@/lib/projects-api"
import { guessMimeType } from "@/pages/project-task-detail/utils"

type ToolResetAction = { type: "clearRectPoints" } | { type: "resetForNewFile" }

type UseTaskBootstrapParams = {
  projectId?: string
  taskId?: string
  files: TaskFileItem[]
  imagePathCandidates: string[]
  currentFilePath: string
  stageRef: MutableRefObject<HTMLDivElement | null>
  panStartRef: MutableRefObject<{ x: number; y: number; originX: number; originY: number } | null>
  clearToolTransientInteractions: () => void
  dispatchTool: (action: ToolResetAction) => void
  setProject: Dispatch<SetStateAction<ProjectItem | undefined>>
  setError: Dispatch<SetStateAction<string | null>>
  setFiles: Dispatch<SetStateAction<TaskFileItem[]>>
  setCurrentIndex: Dispatch<SetStateAction<number>>
  setImageObjectUrl: Dispatch<SetStateAction<string>>
  setActiveImagePath: Dispatch<SetStateAction<string>>
  setIsImageLoading: Dispatch<SetStateAction<boolean>>
  setImageLoadingHint: Dispatch<SetStateAction<string>>
  setImageLoadError: Dispatch<SetStateAction<boolean>>
  setImageScale: Dispatch<SetStateAction<number>>
  setImageOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  setIsPanning: Dispatch<SetStateAction<boolean>>
  setImageNaturalSize: Dispatch<SetStateAction<{ width: number; height: number }>>
  setSelectedShapeIndex: Dispatch<SetStateAction<number | null>>
  resetDocForNewFile: () => void
  setHiddenShapeIndexes: Dispatch<SetStateAction<number[]>>
  setHiddenClassLabels: Dispatch<SetStateAction<string[]>>
  setLabelsTab: Dispatch<SetStateAction<"layers" | "classes">>
  setStageSize: Dispatch<SetStateAction<{ width: number; height: number }>>
}

export function useTaskBootstrap(params: UseTaskBootstrapParams) {
  const {
    projectId,
    taskId,
    files,
    imagePathCandidates,
    currentFilePath,
    stageRef,
    panStartRef,
    clearToolTransientInteractions,
    dispatchTool,
    setProject,
    setError,
    setFiles,
    setCurrentIndex,
    setImageObjectUrl,
    setActiveImagePath,
    setIsImageLoading,
    setImageLoadingHint,
    setImageLoadError,
    setImageScale,
    setImageOffset,
    setIsPanning,
    setImageNaturalSize,
    setSelectedShapeIndex,
    resetDocForNewFile,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    setLabelsTab,
    setStageSize,
  } = params
  const dispatchToolRef = useRef(dispatchTool)
  const resetDocForNewFileRef = useRef(resetDocForNewFile)
  const clearToolTransientInteractionsRef = useRef(clearToolTransientInteractions)
  const lastResetFilePathRef = useRef<string | null>(null)

  useEffect(() => {
    dispatchToolRef.current = dispatchTool
  }, [dispatchTool])

  useEffect(() => {
    resetDocForNewFileRef.current = resetDocForNewFile
  }, [resetDocForNewFile])

  useEffect(() => {
    clearToolTransientInteractionsRef.current = clearToolTransientInteractions
  }, [clearToolTransientInteractions])

  const reloadTaskFiles = useCallback(async () => {
    if (!projectId || !taskId) return
    setImageLoadingHint("正在读取任务文件列表...")
    const result = await listTaskFiles({ projectId, taskId })
    if (result.errorMessage) {
      setError(result.errorMessage)
      setFiles([])
      setImageLoadingHint(`任务文件读取失败：${result.errorMessage}`)
      return
    }
    setError(null)
    setFiles(result.files)
    setImageLoadingHint(`任务文件已加载 ${result.files.length} 项，准备读取图片`)
  }, [projectId, setError, setFiles, setImageLoadingHint, taskId])

  useEffect(() => {
    let alive = true
    if (!projectId) return
    void getProject(projectId).then((item) => {
      if (!alive) return
      setProject(item)
    })
    return () => {
      alive = false
    }
  }, [projectId, setProject])

  useEffect(() => {
    let alive = true
    if (!projectId || !taskId) return
    setImageLoadingHint("正在读取任务文件列表...")
    void listTaskFiles({ projectId, taskId }).then((result) => {
      if (!alive) return
      if (result.errorMessage) {
        setError(result.errorMessage)
        setFiles([])
        setImageLoadingHint(`任务文件读取失败：${result.errorMessage}`)
        return
      }
      setError(null)
      setFiles(result.files)
      setImageLoadingHint(`任务文件已加载 ${result.files.length} 项，准备读取图片`)
    })
    return () => {
      alive = false
    }
  }, [projectId, setError, setFiles, setImageLoadingHint, taskId])

  useEffect(() => {
    setCurrentIndex((index) => {
      if (files.length === 0) return 0
      return Math.min(index, files.length - 1)
    })
  }, [files, setCurrentIndex])

  const handleImageDecodeError = useCallback(() => {
    // 仍由 bootstrap 的顺序候选读取承担主要回退策略；这里保留接口兼容。
    setImageLoadingHint("浏览器解码失败（<img onError>）")
  }, [setImageLoadingHint])

  useEffect(() => {
    let alive = true
    let objectUrl = ""

    const loadImage = async () => {
      let lastReadError = ""
      if (imagePathCandidates.length === 0) {
        setIsImageLoading(false)
        setImageLoadingHint("未找到可读取的图片路径")
        setImageObjectUrl("")
        setActiveImagePath("")
        setImageLoadError(true)
        return
      }
      setIsImageLoading(true)
      setImageLoadingHint(`准备读取图片候选路径（${imagePathCandidates.length}）...`)
      setImageLoadError(false)
      setImageObjectUrl("")

      for (const [index, candidate] of imagePathCandidates.entries()) {
        setImageLoadingHint(`正在读取候选 ${index + 1}/${imagePathCandidates.length}：${candidate}`)
        const result = await readImageFile(candidate)
        if (!alive) return
        if (result.errorMessage) {
          lastReadError = result.errorMessage
          continue
        }
        if (!result.content || result.content.length === 0) continue
        const bytes = result.content
        setImageLoadingHint("已读取字节，正在创建对象 URL...")
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: guessMimeType(candidate) }))
        setImageLoadingHint("对象 URL 已创建，等待浏览器解码...")
        setImageObjectUrl(objectUrl)
        setActiveImagePath(candidate)
        return
      }

      setIsImageLoading(false)
      setImageLoadingHint(lastReadError ? `所有候选路径读取失败：${lastReadError}` : "所有候选路径读取失败")
      setImageLoadError(true)
      setActiveImagePath("")
    }

    void loadImage()

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [
    imagePathCandidates,
    setActiveImagePath,
    setImageLoadError,
    setImageLoadingHint,
    setImageObjectUrl,
    setIsImageLoading,
  ])

  useEffect(() => {
    if (lastResetFilePathRef.current === currentFilePath) return
    lastResetFilePathRef.current = currentFilePath
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
    setIsPanning(false)
    panStartRef.current = null
    setImageNaturalSize({ width: 0, height: 0 })
    dispatchToolRef.current({ type: "clearRectPoints" })
    setSelectedShapeIndex(null)
    dispatchToolRef.current({ type: "resetForNewFile" })
    resetDocForNewFileRef.current()
    clearToolTransientInteractionsRef.current()
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
    setLabelsTab("layers")
  }, [currentFilePath, panStartRef, setHiddenClassLabels, setHiddenShapeIndexes, setImageNaturalSize, setImageOffset, setImageScale, setIsPanning, setLabelsTab, setSelectedShapeIndex])

  useEffect(() => {
    let observer: ResizeObserver | null = null
    let rafId = 0
    let disposed = false

    const update = () => {
      const target = stageRef.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }

    const attachObserver = () => {
      if (disposed) return
      const target = stageRef.current
      if (!target) {
        rafId = window.requestAnimationFrame(attachObserver)
        return
      }
      update()
      observer = new ResizeObserver(update)
      observer.observe(target)
      window.addEventListener("resize", update)
    }

    attachObserver()

    return () => {
      disposed = true
      if (rafId) window.cancelAnimationFrame(rafId)
      observer?.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [setStageSize, stageRef, currentFilePath])

  return { reloadTaskFiles, handleImageDecodeError }
}
